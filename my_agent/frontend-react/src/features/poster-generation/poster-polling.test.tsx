import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { WorkflowProvider } from '../../state/WorkflowProvider'
import { useWorkflowState } from '../../state/use-workflow'
import { POSTER_POLL_ERROR_MESSAGE } from './poster-api'
import {
  createStepThreeState,
  jsonResponse,
  normalizedSequence,
  PNG_BYTES,
  sequenceDocument,
  TEST_GENERATION_ID,
  TEST_REQUEST_ID,
} from './poster-test-utils'

function Probe() {
  const state = useWorkflowState()
  return (
    <output data-testid="poll-state">
      {JSON.stringify({
        currentStep: state.currentStep,
        status: state.posterGeneration.result?.status,
        pollingError: state.posterGeneration.errors.polling,
        succeededOnce: state.posterGeneration.succeededOnce,
        pendingFingerprint: state.posterGeneration.pendingFingerprint,
        pendingIdempotencyKey: state.posterGeneration.pendingIdempotencyKey,
      })}
    </output>
  )
}

function renderPolling(status = 'queued') {
  const result = normalizedSequence(status)
  return render(
    <WorkflowProvider
      initialState={createStepThreeState({
        result,
        activeGenerationId: result.generationId,
        pendingFingerprint: 'accepted-fingerprint',
        pendingIdempotencyKey: 'accepted-key',
        pendingIntentPhase: 'accepted',
      })}
    >
      <App />
      <Probe />
    </WorkflowProvider>,
  )
}

function generationPollCalls(fetchMock: ReturnType<typeof vi.fn<typeof fetch>>) {
  return fetchMock.mock.calls.filter(
    ([url, init]) =>
      !init?.method &&
      String(url) === `/api/v1/generations/${TEST_GENERATION_ID}`,
  )
}

describe('poster polling controller', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:poll-preview'),
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('waits 2 seconds, never overlaps GETs, and schedules only after settlement', async () => {
    let resolveFirst: (response: Response) => void = () => undefined
    const fetchMock = vi.fn<typeof fetch>().mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolveFirst = resolve
      }),
    )
    fetchMock.mockResolvedValue(jsonResponse(sequenceDocument('queued')))
    vi.stubGlobal('fetch', fetchMock)
    renderPolling()

    await act(() => vi.advanceTimersByTimeAsync(1_999))
    expect(generationPollCalls(fetchMock)).toHaveLength(0)
    await act(() => vi.advanceTimersByTimeAsync(1))
    expect(generationPollCalls(fetchMock)).toHaveLength(1)
    await act(() => vi.advanceTimersByTimeAsync(6_000))
    expect(generationPollCalls(fetchMock)).toHaveLength(1)

    await act(async () => {
      resolveFirst(jsonResponse(sequenceDocument('queued')))
      await Promise.resolve()
    })
    await act(() => vi.advanceTimersByTimeAsync(1_999))
    expect(generationPollCalls(fetchMock)).toHaveLength(1)
    await act(() => vi.advanceTimersByTimeAsync(1))
    expect(generationPollCalls(fetchMock)).toHaveLength(2)
  })

  it('keeps the last snapshot on poll 404 and recovers on the next natural cycle', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse(
          {
            error: {
              code: 'generation_not_found',
              message: '未找到该生成记录。',
              request_id: TEST_REQUEST_ID,
            },
          },
          404,
        ),
      )
      .mockResolvedValueOnce(jsonResponse(sequenceDocument('running')))
    vi.stubGlobal('fetch', fetchMock)
    renderPolling()

    await act(() => vi.advanceTimersByTimeAsync(2_000))
    expect(screen.getByText(POSTER_POLL_ERROR_MESSAGE)).toBeVisible()
    expect(screen.queryByText(new RegExp(TEST_REQUEST_ID))).not.toBeInTheDocument()
    expect(JSON.parse(screen.getByTestId('poll-state').textContent ?? '{}')).toMatchObject({
      status: 'queued',
      pollingError: POSTER_POLL_ERROR_MESSAGE,
    })

    await act(() => vi.advanceTimersByTimeAsync(2_000))
    expect(JSON.parse(screen.getByTestId('poll-state').textContent ?? '{}')).toMatchObject({
      status: 'running',
      pollingError: '',
    })
    expect(generationPollCalls(fetchMock)).toHaveLength(2)
  })

  it('pauses and aborts off Step 3, then resumes on return', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(sequenceDocument('queued')))
    vi.stubGlobal('fetch', fetchMock)
    renderPolling()

    fireEvent.click(screen.getByRole('button', { name: '上一步' }))
    expect(screen.getByRole('heading', { name: '步骤 2：平台与文案' })).toBeVisible()
    await act(() => vi.advanceTimersByTimeAsync(4_000))
    expect(generationPollCalls(fetchMock)).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: '下一步' }))
    expect(screen.getByRole('heading', { name: '步骤 3：生成海报' })).toBeVisible()
    await act(() => vi.advanceTimersByTimeAsync(2_000))
    expect(generationPollCalls(fetchMock)).toHaveLength(1)
  })

  it('safely applied polling completion stops GETs, clears intent, and preserves succeeded-once', async () => {
    const fetchMock = vi.fn<typeof fetch>((url) => {
      if (String(url).includes('/posters/')) {
        return Promise.resolve(
          new Response(PNG_BYTES, {
            status: 200,
            headers: { 'Content-Type': 'image/png' },
          }),
        )
      }
      return Promise.resolve(
        jsonResponse(
          sequenceDocument('completed', ['ready', 'ready', 'ready']),
        ),
      )
    })
    vi.stubGlobal('fetch', fetchMock)
    renderPolling()

    await act(() => vi.advanceTimersByTimeAsync(2_000))
    expect(screen.getByRole('button', { name: '重新生成' })).toBeEnabled()
    expect(JSON.parse(screen.getByTestId('poll-state').textContent ?? '{}')).toMatchObject({
      status: 'completed',
      succeededOnce: true,
      pendingFingerprint: null,
      pendingIdempotencyKey: null,
    })
    await act(() => vi.advanceTimersByTimeAsync(10_000))
    expect(generationPollCalls(fetchMock)).toHaveLength(1)
  })

  it('treats an unknown overall status as nonterminal and keeps polling', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(sequenceDocument('future_status')))
    vi.stubGlobal('fetch', fetchMock)
    renderPolling('future_status')
    await act(() => vi.advanceTimersByTimeAsync(2_000))
    await act(() => vi.advanceTimersByTimeAsync(2_000))
    expect(generationPollCalls(fetchMock)).toHaveLength(2)
    expect(screen.getByText('状态：future_status｜已完成 0 / 3')).toBeVisible()
  })
})

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { WorkflowProvider } from '../../state/WorkflowProvider'
import type { WorkflowState } from '../../state/workflow-types'
import { useWorkflowState } from '../../state/use-workflow'
import { POSTER_PREVIEW_ERROR_MESSAGE } from './poster-api'
import { overallStatusMessages } from './poster-status-copy'
import {
  createStepThreeState,
  jsonResponse,
  normalizedSequence,
  PNG_BYTES,
  TEST_GENERATION_ID,
  TEST_POSTER_IDS,
  TEST_REQUEST_ID,
  ZIP_BYTES,
} from './poster-test-utils'

function StateProbe() {
  const state = useWorkflowState()
  return (
    <output data-testid="poster-state">
      {JSON.stringify({
        currentStep: state.currentStep,
        completedSteps: [...state.completedSteps],
        selectedIndex: state.posterGeneration.selectedIndex,
        selectedPosterId: state.posterGeneration.selectedPosterId,
        completedDraft: state.posterGeneration.completedDraft,
      })}
    </output>
  )
}

function renderState(state: WorkflowState) {
  return render(
    <WorkflowProvider initialState={state}>
      <App />
      <StateProbe />
    </WorkflowProvider>,
  )
}

function binaryResponse(bytes: Uint8Array, contentType: string) {
  const body = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': contentType },
  })
}

describe('poster statuses, selection, and artifacts', () => {
  const canvasContextDescriptor = Object.getOwnPropertyDescriptor(
    HTMLCanvasElement.prototype,
    'getContext',
  )
  let createObjectURL = vi.fn<(blob: Blob) => string>()
  let revokeObjectURL = vi.fn<(url: string) => void>()
  let downloads: Array<{ download: string; href: string }> = []
  let anchorClick: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      value: vi.fn(() => null),
    })
    let index = 0
    createObjectURL = vi.fn(() => {
      index += 1
      return `blob:artifact-${index}`
    })
    revokeObjectURL = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectURL,
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectURL,
    })
    downloads = []
    anchorClick = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        downloads.push({ download: this.download, href: this.href })
      })
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({
        width: 1024,
        height: 1536,
        close: vi.fn(),
      })),
    )
  })

  afterEach(() => {
    anchorClick.mockRestore()
    if (canvasContextDescriptor) {
      Object.defineProperty(
        HTMLCanvasElement.prototype,
        'getContext',
        canvasContextDescriptor,
      )
    }
    vi.unstubAllGlobals()
  })

  it.each([
    ['queued', ['任务排队中…', '正在为您加急生成中，请耐心等待哦~']],
    [
      'running',
      ['正在生成第 2 / 3 张海报…', '正在为您加急生成中，请耐心等待哦~'],
    ],
    ['completed', ['三张海报已全部生成完成']],
    [
      'failed',
      [
        '生成结束（failed），已完成 0 / 3 张',
        '顺序生成失败（provider_timeout）。请检查设置后重新生成。',
      ],
    ],
    [
      'partial_failed',
      [
        '生成结束（partial_failed），已完成 1 / 3 张',
        '顺序生成失败（provider_timeout）。请检查设置后重新生成。',
      ],
    ],
    [
      'interrupted',
      [
        '任务中断，已完成 1 / 3 张',
        '后端在生成过程中重启，任务已中断；已完成的海报仍可下载。',
      ],
    ],
    ['future_status', ['状态：future_status｜已完成 0 / 3']],
  ])('uses exact overall status copy for %s', (status, expected) => {
    const slots =
      status === 'running'
        ? ['ready', 'generating', 'waiting']
        : status === 'completed'
          ? ['ready', 'ready', 'ready']
          : status === 'partial_failed' || status === 'interrupted'
            ? ['ready', 'failed', 'blocked']
            : ['failed', 'blocked', 'blocked']
    expect(overallStatusMessages(normalizedSequence(status, slots))).toEqual(
      expected,
    )
  })

  it('renders waiting, generating, failed, blocked, missing, and unknown as non-ready with no actions', () => {
    const result = normalizedSequence('running', [
      'generating',
      'waiting',
      'blocked',
    ])
    const first = renderState(
      createStepThreeState({ result, activeGenerationId: result.generationId }),
    )
    expect(screen.getByText('正在生成海报 1…')).toBeVisible()
    expect(screen.getByText('等待前一张海报完成')).toBeVisible()
    expect(screen.getByText('因前一张生成失败，本张未开始')).toBeVisible()
    expect(screen.queryByRole('button', { name: '选用此底图' })).not.toBeInTheDocument()
    first.unmount()

    const failed = normalizedSequence('failed', ['failed'])
    const second = renderState(createStepThreeState({ result: failed }))
    expect(
      screen.getByText('本张海报生成失败，未自动重试。（provider_timeout）'),
    ).toBeVisible()
    expect(screen.getAllByText('本张海报生成失败，未自动重试。')).toHaveLength(2)
    second.unmount()

    const unknown = normalizedSequence('running', ['future_slot'])
    renderState(createStepThreeState({ result: unknown }))
    expect(screen.getAllByText('本张海报生成失败，未自动重试。')).toHaveLength(3)
  })

  it('keeps editor entry disabled while generation is still running, even when one poster is ready', async () => {
    const user = userEvent.setup()
    const result = normalizedSequence('running', [
      'ready',
      'generating',
      'waiting',
    ])
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        binaryResponse(PNG_BYTES, 'image/png'),
      ),
    )
    renderState(
      createStepThreeState({
        result,
        activeGenerationId: result.generationId,
      }),
    )

    await user.click(screen.getByRole('button', { name: '选用此底图' }))
    expect(
      screen.getByRole('button', { name: '下一步：文字编辑' }),
    ).toBeDisabled()
    expect(
      screen.getByRole('heading', { name: '步骤 3：生成海报' }),
    ).toBeVisible()
    const state = JSON.parse(screen.getByTestId('poster-state').textContent ?? '{}')
    expect(state.currentStep).toBe(3)
  })

  it.each(['partial_failed', 'interrupted'] as const)(
    'allows a ready poster from %s to enter the real Step 4 editor',
    async (status) => {
      const user = userEvent.setup()
      const result = normalizedSequence(status, ['ready', 'failed', 'blocked'])
      vi.stubGlobal(
        'fetch',
        vi.fn<typeof fetch>().mockImplementation(() =>
          Promise.resolve(binaryResponse(PNG_BYTES, 'image/png')),
        ),
      )
      renderState(
        createStepThreeState({
          result,
          activeGenerationId: result.generationId,
        }),
      )

      expect(
        screen.getByText('请先选用一张底图，再进入文字编辑。'),
      ).toBeVisible()
      await user.click(screen.getByRole('button', { name: '选用此底图' }))
      const next = screen.getByRole('button', { name: '下一步：文字编辑' })
      expect(next).toBeEnabled()
      await user.click(next)
      expect(await screen.findByRole('heading', { name: '步骤 4：文字编辑' })).toBeVisible()
      const state = JSON.parse(screen.getByTestId('poster-state').textContent ?? '{}')
      expect(state.currentStep).toBe(4)
      expect(state.completedSteps).toEqual([1, 2, 3])
      expect(state.completedDraft).toMatchObject({
        generationId: TEST_GENERATION_ID,
        selectedIndex: 0,
        posterId: TEST_POSTER_IDS[0],
        selectedSlot: { status: 'ready' },
      })
      expect(screen.queryByRole('heading', { name: '步骤 3：生成海报' })).not.toBeInTheDocument()
      expect(screen.queryByText(/步骤 5/)).not.toBeInTheDocument()
    },
  )

  it('loads preview separately, caches download bytes, and uses the exact PNG filename', async () => {
    const user = userEvent.setup()
    const result = normalizedSequence('partial_failed', [
      'ready',
      'failed',
      'blocked',
    ])
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(() =>
        Promise.resolve(binaryResponse(PNG_BYTES, 'image/png')),
      )
    vi.stubGlobal('fetch', fetchMock)
    const view = renderState(createStepThreeState({ result }))

    const preview = await screen.findByRole('img', {
      name: '海报 1 无字底预览',
    })
    expect(preview).toHaveAttribute('src', 'blob:artifact-1')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const download = screen.getByRole('button', { name: '下载无字底 PNG' })
    await user.click(download)
    await waitFor(() => expect(downloads).toHaveLength(1))
    expect(downloads[0]).toMatchObject({ download: 'poster-base-1.png' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await user.click(download)
    expect(downloads).toHaveLength(2)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    view.unmount()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:artifact-1')
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:artifact-2')
  })

  it('keeps preview 404 slot-local, hides raw detail, and recovers on retry', async () => {
    const user = userEvent.setup()
    const result = normalizedSequence('partial_failed', [
      'ready',
      'failed',
      'blocked',
    ])
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse(
          {
            error: {
              code: 'poster_not_found',
              message: '未找到该海报。',
              request_id: TEST_REQUEST_ID,
              traceback: 'hidden',
            },
          },
          404,
        ),
      )
      .mockResolvedValueOnce(binaryResponse(PNG_BYTES, 'image/png'))
    vi.stubGlobal('fetch', fetchMock)
    renderState(createStepThreeState({ result }))

    expect(await screen.findByText(POSTER_PREVIEW_ERROR_MESSAGE)).toBeVisible()
    expect(screen.queryByText(new RegExp(TEST_REQUEST_ID))).not.toBeInTheDocument()
    expect(screen.queryByText(/traceback|hidden/)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '重新加载预览' }))
    expect(
      await screen.findByRole('img', { name: '海报 1 无字底预览' }),
    ).toBeVisible()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('shows ZIP only for completed, fetches on click, caches it, and uses exact filename', async () => {
    const user = userEvent.setup()
    const completed = normalizedSequence('completed', ['ready', 'ready', 'ready'])
    const fetchMock = vi.fn<typeof fetch>((input) => {
      if (String(input).endsWith('/download') && !String(input).includes('/posters/')) {
        return Promise.resolve(binaryResponse(ZIP_BYTES, 'application/zip'))
      }
      return Promise.resolve(binaryResponse(PNG_BYTES, 'image/png'))
    })
    vi.stubGlobal('fetch', fetchMock)
    renderState(createStepThreeState({ result: completed }))
    const zip = screen.getByRole('button', { name: '下载全部无字底 ZIP' })
    await user.click(zip)
    await waitFor(() =>
      expect(downloads.some((item) => item.download === 'posters-base.zip')).toBe(
        true,
      ),
    )
    const zipFetchesAfterFirst = fetchMock.mock.calls.filter(([url]) =>
      String(url).endsWith(`/generations/${TEST_GENERATION_ID}/download`),
    ).length
    expect(zipFetchesAfterFirst).toBe(1)
    await user.click(zip)
    expect(
      fetchMock.mock.calls.filter(([url]) =>
        String(url).endsWith(`/generations/${TEST_GENERATION_ID}/download`),
      ),
    ).toHaveLength(1)
  })

  it.each(['queued', 'running', 'failed', 'partial_failed', 'interrupted', 'future'])(
    'does not render ZIP for %s',
    (status) => {
      const result = normalizedSequence(
        status,
        status === 'partial_failed' || status === 'interrupted'
          ? ['ready', 'failed', 'blocked']
          : ['waiting', 'waiting', 'waiting'],
        { zip_download_url: `/api/v1/generations/${TEST_GENERATION_ID}/download` },
      )
      renderState(createStepThreeState({ result }))
      expect(
        screen.queryByRole('button', { name: '下载全部无字底 ZIP' }),
      ).not.toBeInTheDocument()
    },
  )

  it('uses no browser persistence while selecting and completing Step 3', async () => {
    const user = userEvent.setup()
    const localSet = vi.spyOn(Storage.prototype, 'setItem')
    const result = normalizedSequence('partial_failed', [
      'ready',
      'failed',
      'blocked',
    ])
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        binaryResponse(PNG_BYTES, 'image/png'),
      ),
    )
    renderState(createStepThreeState({ result }))
    await user.click(screen.getByRole('button', { name: '选用此底图' }))
    await user.click(screen.getByRole('button', { name: '下一步：文字编辑' }))
    expect(localSet).not.toHaveBeenCalled()
    localSet.mockRestore()
  })
})

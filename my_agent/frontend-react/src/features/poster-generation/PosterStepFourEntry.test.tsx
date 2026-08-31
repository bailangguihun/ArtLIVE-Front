import { forwardRef, useImperativeHandle } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { WorkflowProvider } from '../../state/WorkflowProvider'
import { workflowReducer } from '../../state/workflow-reducer'
import { useWorkflowDispatch, useWorkflowState } from '../../state/use-workflow'
import type { WorkflowState } from '../../state/workflow-types'
import { sha256Blob } from '../poster-editor/poster-signature'
import { createStepThreeState, normalizedSequence, TEST_POSTER_IDS } from './poster-test-utils'

vi.mock('../poster-editor/PosterEditorCanvas', () => ({
  PosterEditorCanvas: forwardRef(function MockCanvas(
    props: { snapshot: { layout: unknown } },
    ref,
  ) {
    useImperativeHandle(ref, () => ({ materializeLayout: () => props.snapshot.layout }))
    return <div data-testid="mock-step-four-canvas" />
  }),
}))

function binaryResponse(bytes: Uint8Array, status = 200) {
  return new Response(bytes.slice().buffer, {
    status,
    headers: { 'Content-Type': status === 200 ? 'image/png' : 'application/json' },
  })
}

function validPng(marker: number) {
  return new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, marker])
}

function selectedStepThree(status: 'completed' | 'partial_failed' | 'interrupted' = 'partial_failed'): WorkflowState {
  const result = normalizedSequence(
    status,
    status === 'completed' ? ['ready', 'ready', 'ready'] : ['ready', 'failed', 'blocked'],
  )
  let state = createStepThreeState({ result })
  state = workflowReducer(state, { type: 'SELECT_POSTER_SLOT', index: 0 })
  const previewBlob = new Blob([new Uint8Array([137, 80, 78, 71, 99])], { type: 'image/png' })
  return {
    ...state,
    posterGeneration: {
      ...state.posterGeneration,
      posterBinaries: {
        [TEST_POSTER_IDS[0]]: {
          preview: { status: 'ready' as const, blob: previewBlob, objectUrl: 'blob:cached-preview', error: '' },
          download: { status: 'idle' as const, blob: null, objectUrl: null, error: '' },
        },
      },
    },
  }
}

function StateProbe({ expectedBlob }: { expectedBlob?: Blob }) {
  const state = useWorkflowState()
  const active = state.posterEditor.active
  const activeResource = active ? state.posterEditor.resources[active.baseBlobId] : null
  return (
    <output data-testid="entry-state">
      {JSON.stringify({
        currentStep: state.currentStep,
        selectedIndex: state.posterGeneration.selectedIndex,
        selectedPosterId: state.posterGeneration.selectedPosterId,
        entryBusy: state.posterEditor.operations.entryBusy,
        active: active ? { posterId: active.posterId, sha256: active.baseBlobSha256 } : null,
        exactCachedBlob: expectedBlob ? activeResource?.blob === expectedBlob : null,
      })}
    </output>
  )
}

function ResourceMutation() {
  const state = useWorkflowState()
  const dispatch = useWorkflowDispatch()
  return (
    <button
      onClick={() => {
        if (state.posterGeneration.selectedPosterId) {
          dispatch({ type: 'RESET_POSTER_BINARY', kind: 'download', posterId: state.posterGeneration.selectedPosterId })
        }
      }}
      type="button"
    >
      测试资源变更
    </button>
  )
}

function renderEntry(state: WorkflowState, expectedBlob?: Blob, resourceMutation = false) {
  return render(
    <WorkflowProvider initialState={state}>
      <App />
      <StateProbe expectedBlob={expectedBlob} />
      {resourceMutation ? <ResourceMutation /> : null}
    </WorkflowProvider>,
  )
}

function readState() {
  return JSON.parse(screen.getByTestId('entry-state').textContent ?? '{}') as {
    currentStep: number
    selectedIndex: number | null
    selectedPosterId: string | null
    entryBusy: boolean
    active: null | { posterId: string; sha256: string }
    exactCachedBlob: boolean | null
  }
}

describe('real Step 3 -> Step 4 authoritative entry seam', () => {
  beforeEach(() => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 1024, height: 1536, close: vi.fn() })))
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:download-cache') })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
  })

  it('uses download bytes rather than a successful preview Blob', async () => {
    const user = userEvent.setup()
    const downloadBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 7])
    const expectedSha = await sha256Blob(new Blob([downloadBytes], { type: 'image/png' }))
    vi.stubGlobal('fetch', vi.fn(async () => binaryResponse(downloadBytes)))
    renderEntry(selectedStepThree())
    await user.click(screen.getByRole('button', { name: '下一步：文字编辑' }))
    expect(await screen.findByRole('heading', { name: '步骤 4：文字编辑' })).toBeVisible()
    expect(readState().active?.sha256).toBe(expectedSha)
    expect(readState().active?.sha256).not.toBe(await sha256Blob(new Blob([new Uint8Array([137, 80, 78, 71, 99])], { type: 'image/png' })))
  })

  it('reuses the exact cached authoritative download Blob without a GET', async () => {
    const user = userEvent.setup()
    const state = selectedStepThree()
    const cachedBlob = new Blob([new Uint8Array([137, 80, 78, 71, 4])], { type: 'image/png' })
    const posterId = state.posterGeneration.selectedPosterId!
    state.posterGeneration.posterBinaries[posterId].download = { status: 'ready', blob: cachedBlob, objectUrl: 'blob:cached-download', error: '' }
    const fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetchMock)
    renderEntry(state, cachedBlob)
    await user.click(screen.getByRole('button', { name: '下一步：文字编辑' }))
    await screen.findByRole('heading', { name: '步骤 4：文字编辑' })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(readState().exactCachedBlob).toBe(true)
  })

  it('acquires admission synchronously and deduplicates a rapid double click', async () => {
    const user = userEvent.setup()
    let resolveFetch!: (response: Response) => void
    const fetchMock = vi.fn<typeof fetch>(() => new Promise((resolve) => { resolveFetch = resolve }))
    vi.stubGlobal('fetch', fetchMock)
    renderEntry(selectedStepThree())
    await user.dblClick(screen.getByRole('button', { name: '下一步：文字编辑' }))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    resolveFetch(binaryResponse(validPng(5)))
    expect(await screen.findByRole('heading', { name: '步骤 4：文字编辑' })).toBeVisible()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('discards a stale transition when selection changes during download', async () => {
    const user = userEvent.setup()
    let resolveFetch!: (response: Response) => void
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(() => new Promise((resolve) => { resolveFetch = resolve })))
    renderEntry(selectedStepThree('completed'))
    await user.click(screen.getByRole('button', { name: '下一步：文字编辑' }))
    await user.click(screen.getAllByRole('button', { name: '选用此底图' })[1])
    resolveFetch(binaryResponse(validPng(6)))
    await waitFor(() => expect(readState().selectedIndex).toBe(1))
    expect(readState().currentStep).toBe(3)
    expect(readState().active).toBeNull()
    expect(readState().entryBusy).toBe(false)
  })

  it('discards a stale transition when resource revision changes during download', async () => {
    const user = userEvent.setup()
    let resolveFetch!: (response: Response) => void
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(() => new Promise((resolve) => { resolveFetch = resolve })))
    renderEntry(selectedStepThree(), undefined, true)
    await user.click(screen.getByRole('button', { name: '下一步：文字编辑' }))
    await user.click(screen.getByRole('button', { name: '测试资源变更' }))
    resolveFetch(binaryResponse(validPng(7)))
    await waitFor(() => expect(screen.getByRole('heading', { name: '步骤 3：生成海报' })).toBeVisible())
    expect(readState().active).toBeNull()
    expect(readState().entryBusy).toBe(false)
  })

  it('keeps Previous available and prevents a stale transition after navigation away', async () => {
    const user = userEvent.setup()
    let resolveFetch!: (response: Response) => void
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(() => new Promise((resolve) => { resolveFetch = resolve })))
    renderEntry(selectedStepThree())
    await user.click(screen.getByRole('button', { name: '下一步：文字编辑' }))
    const previous = screen.getByRole('button', { name: '上一步' })
    expect(previous).toBeEnabled()
    await user.click(previous)
    expect(screen.getByRole('heading', { name: '步骤 2：平台与文案' })).toBeVisible()
    resolveFetch(binaryResponse(validPng(8)))
    await waitFor(() => expect(readState().currentStep).toBe(2))
    expect(readState().active).toBeNull()
    expect(readState().entryBusy).toBe(false)
  })

  it('does not let preview success mask authoritative download failure', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', vi.fn(async () => binaryResponse(new Uint8Array([1]), 500)))
    renderEntry(selectedStepThree())
    await user.click(screen.getByRole('button', { name: '下一步：文字编辑' }))
    expect(await screen.findByText('无法下载本张无字底海报。')).toBeVisible()
    expect(readState().currentStep).toBe(3)
    expect(readState().active).toBeNull()
  })

  it('fails closed for abnormal direct entry and never mounts a fake editor', () => {
    const missing = selectedStepThree()
    missing.currentStep = 4
    missing.posterGeneration.result = null
    missing.posterGeneration.selectedIndex = null
    missing.posterGeneration.selectedPosterId = null
    renderEntry(missing)
    expect(screen.getByText('暂无可用底图，请等待至少一张海报生成完成。')).toBeVisible()
    expect(screen.queryByTestId('mock-step-four-canvas')).not.toBeInTheDocument()
    expect(screen.queryByText('选择底图')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '上一步' })).toBeEnabled()
  })
})

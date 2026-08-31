import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkflowProvider } from '../../state/WorkflowProvider'
import { useWorkflowState } from '../../state/use-workflow'
import { workflowReducer } from '../../state/workflow-reducer'
import type { DetailOwnerIdentity, DetailResource } from '../../types/detail-editor'
import type { WorkflowState } from '../../state/workflow-types'
import {
  createBasicAuthority,
  createConfirmedPoster,
  createDetailOwner,
  createPosterCopySnapshot,
  createPosterProjectInput,
  createPresentAdviceAuthority,
  posterRefFromConfirmedPoster,
} from '../../state/workflow-v2/workflow-v2-authorities'
import type { AdviceResult } from '../../state/workflow-v2/workflow-v2-types'
import { createV2DetailProject } from './v2-detail-adapter'
import { confirmStepFour, confirmedSnapshot, createStepFourState } from '../poster-editor/poster-editor-test-utils'
import { DetailEditorStep } from './DetailEditorStep'

const mocks = vi.hoisted(() => ({
  compose: vi.fn(async () => new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' })),
  validateExport: vi.fn(async () => ({ bytes: new Uint8Array([137, 80, 78, 71]), width: 750, height: 1334, sha256: 'f'.repeat(64) })),
  validatePng: vi.fn(async () => ({ bytes: new Uint8Array([137, 80, 78, 71]), width: 1024, height: 1536, sha256: 'c'.repeat(64) })),
  cutout: vi.fn(),
}))

vi.mock('./detail-renderer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./detail-renderer')>()
  return { ...actual, composeDetailPng: mocks.compose }
})

vi.mock('./detail-resources', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./detail-resources')>()
  return { ...actual, validateDetailExport: mocks.validateExport, validatePngBlob: mocks.validatePng }
})

vi.mock('./detail-cutout-api', () => ({ requestDetailCutout: mocks.cutout }))

vi.mock('./DetailEditorCanvas', () => ({
  DetailEditorCanvas: (props: {
    onRenderError: (message: string) => void
    onRenderSuccess: () => void
    page: { id: string }
  }) => (
    <div data-page-id={props.page.id}>
      <canvas aria-label="详情页画布" role="img" />
      <button onClick={() => props.onRenderError('详情页编辑器加载失败，请重试。')} type="button">模拟画布失败</button>
      <button onClick={props.onRenderSuccess} type="button">模拟画布恢复</button>
    </div>
  ),
}))

function entryFrom(state: WorkflowState) {
  const confirmed = state.posterEditor.confirmedPoster!
  const owner: DetailOwnerIdentity = {
    generationId: confirmed.generationId,
    posterId: confirmed.posterId,
    inputSignatureSha256: confirmed.inputSignatureSha256,
    pngBlobSha256: confirmed.pngBlobSha256,
  }
  const posterResource: DetailResource = {
    id: 'poster-final', kind: 'poster-final', name: '定稿海报', blob: confirmed.pngBlob,
    sha256: confirmed.pngBlobSha256, mimeType: 'image/png', width: 1024, height: 1536,
  }
  return { owner, posterResource }
}

function initialState() {
  const confirmed = confirmStepFour(createStepFourState())
  const completed = workflowReducer(confirmed, { type: 'COMPLETE_STEP_FOUR' })
  return workflowReducer(completed, { type: 'COMPLETE_STEP_FOUR', entry: entryFrom(completed) })
}

const hash = (character: string) => character.repeat(64)
const advice: AdviceResult = {
  category_id: 'fmcg', category_name: '快消品', confidence: 'low',
  matched_keywords: [], reason: 'fixture', score: 0,
  strategy: { id: 'fmcg', name: '策略', examples: '示例', traits: ['特点'], tactics: ['建议'], one_liner: '方向' },
  source: 'desktop_ai_different_product_marketing_strategies',
}

async function v2DetailState() {
  let legacyState = createStepFourState()
  const legacy = confirmedSnapshot(legacyState)
  const basic = await createBasicAuthority({
    productInfo: '测试商品', productShortName: '', creativeNote: '',
    platform: 'xiaohongshu', style: 'premium',
    productImage: { byteSha256: hash('1'), mimeType: 'image/png', byteSize: 64 },
  })
  const authority = await createPresentAdviceAuthority({
    api_version: 'v1', advice_version: 'catalog-v1', status: 'present',
    input_signature_sha256: basic.text.adviceInputSignatureSha256,
    advice_signature_sha256: hash('2'), advice,
  }, basic)
  const project = await createPosterProjectInput({
    projectId: 'poster-owned-detail-fixture', basic, advice: authority, copySource: 'poster_owned',
  })
  const snapshot = await createPosterCopySnapshot({
    fields: { body: '海报专用文案', title: '', headline: '', subline: '' },
    platform: basic.settings.platform, style: basic.settings.style, sourceMode: 'poster_owned',
  })
  const poster = await createConfirmedPoster({
    project, generationId: legacy.generationId, posterId: legacy.posterId, slot: legacy.slot,
    baseBlobSha256: legacy.baseBlobSha256, layoutSha256: legacy.layoutSha256,
    upstreamSha256: legacy.upstreamSha256,
    compositionInputSignatureSha256: legacy.inputSignatureSha256,
    pngBlobSha256: legacy.pngBlobSha256, confirmedRevision: legacy.confirmedRevision,
    resourceRevision: 1, copySnapshot: snapshot,
  })
  legacyState = confirmStepFour(legacyState, legacy)
  const detailProject = createV2DetailProject(await createDetailOwner(posterRefFromConfirmedPoster(poster)))
  const ready: WorkflowState = {
    ...legacyState,
    workflowV2: {
      ...legacyState.workflowV2,
      phase: 'active', view: 'poster', resumeView: 'poster', epoch: 1,
      basicAuthority: basic, adviceAuthority: authority, posterProject: poster.project, confirmedPoster: poster,
    },
  }
  return {
    basic,
    authority,
    poster,
    state: workflowReducer(ready, {
      type: 'COMMIT_V2_DETAIL_ENTRY',
      project: detailProject,
      legacyOwner: {
        generationId: legacy.generationId, posterId: legacy.posterId,
        inputSignatureSha256: legacy.inputSignatureSha256, pngBlobSha256: legacy.pngBlobSha256,
      },
      posterResource: {
        id: 'poster-final', kind: 'poster-final', name: 'confirmed-poster', blob: legacy.pngBlob,
        sha256: legacy.pngBlobSha256, mimeType: 'image/png', width: 1024, height: 1536,
      },
    }),
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => { resolve = nextResolve; reject = nextReject })
  return { promise, resolve, reject }
}

let observed: WorkflowState | null = null

function StateProbe() {
  const state = useWorkflowState()
  useEffect(() => { observed = state }, [state])
  return (
    <output
      data-completion={state.detailEditor.completion ? 'true' : 'false'}
      data-confirmed={state.detailEditor.confirmedDetails ? 'true' : 'false'}
      data-image-busy={state.detailEditor.operations.imageBusy ? 'true' : 'false'}
      data-pages={state.detailEditor.pages.length}
      data-step={state.currentStep}
      data-view={state.workflowV2.phase === 'active' ? state.workflowV2.view : 'none'}
      data-testid="detail-state"
    />
  )
}

function V2DetailHost() {
  const state = useWorkflowState()
  return state.workflowV2.phase === 'active' && state.workflowV2.view === 'detail'
    ? <DetailEditorStep />
    : <output data-testid="v2-destination">{state.workflowV2.phase === 'active' ? state.workflowV2.view : 'none'}</output>
}

function renderV2Step(state: WorkflowState) {
  return render(
    <WorkflowProvider initialState={state}>
      <V2DetailHost />
      <StateProbe />
    </WorkflowProvider>,
  )
}

function renderStep(state = initialState()) {
  return render(
    <WorkflowProvider initialState={state}>
      <DetailEditorStep />
      <StateProbe />
    </WorkflowProvider>,
  )
}

describe('Step 5 visible integration', () => {
  beforeEach(() => {
    observed = null
    mocks.compose.mockClear()
    mocks.validateExport.mockClear()
    mocks.validatePng.mockClear()
    mocks.cutout.mockReset()
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => `blob:detail-${Math.random()}`) })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
  })

  afterEach(() => vi.restoreAllMocks())

  it('renders semantic Step 5 controls, exact catalog labels and one-page boundaries', async () => {
    const user = userEvent.setup()
    renderStep()
    expect(screen.getByRole('heading', { level: 1, name: '步骤 5：详情页制作' })).toBeVisible()
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['底图', '文字', '图形', '图片'])
    expect(screen.getByRole('button', { name: '上一张' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '下一张' })).toBeDisabled()
    await user.click(screen.getByRole('tab', { name: '底图' }))
    expect(screen.getAllByRole('button', { name: /^(01|02|03|04|05|06|07|08|09|10|11|12|13|14|15|16|17|18|19|20)(已选|选用)$/ })).toHaveLength(20)
    expect(screen.getByRole('button', { name: '01已选' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('adds inherited pages, preserves stable page one, and enforces navigation bounds', async () => {
    const user = userEvent.setup()
    renderStep()
    const firstId = observed?.detailEditor.pages[0].id
    await user.click(screen.getByRole('button', { name: '添加页数' }))
    expect(screen.getByText('2 / 2')).toBeVisible()
    expect(observed?.detailEditor.pages).toHaveLength(2)
    expect(observed?.detailEditor.pages[0].id).toBe(firstId)
    expect(observed?.detailEditor.pages[1]).toMatchObject({ layers: [], compositionRevision: 0, currentExport: null, activeProductId: 'poster-final' })
    expect(screen.getByRole('button', { name: '下一张' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: '上一张' }))
    expect(screen.getByText('1 / 2')).toBeVisible()
    expect(screen.getByRole('button', { name: '上一张' })).toBeDisabled()
  })

  it('disables an empty confirmation and shows the exact missing-other-page error after a partial export', async () => {
    const user = userEvent.setup()
    renderStep()
    expect(screen.getByRole('button', { name: '确认保存详情页' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: '同步导出' }))
    await screen.findByText('本页已同步导出（rev 0）')
    await user.click(screen.getByRole('button', { name: '添加页数' }))
    await user.click(screen.getByRole('button', { name: '确认保存详情页' }))
    expect(screen.getByRole('alert')).toHaveTextContent('保存失败：第 2 页还没有同步导出。请打开这些页稍等自动导出完成后再确认保存。')
  })

  it('synchronizes all pages, confirms atomically, and Next enters Step 6', async () => {
    const user = userEvent.setup()
    renderStep()
    await user.click(screen.getByRole('button', { name: '同步导出' }))
    await screen.findByText('本页已同步导出（rev 0）')
    await user.click(screen.getByRole('button', { name: '添加页数' }))
    await user.click(screen.getByRole('button', { name: '同步导出' }))
    await screen.findByText('本页已同步导出（rev 0）')
    const next = screen.getByRole('button', { name: '下一步：营销策略' })
    expect(next).toBeDisabled()
    await user.click(screen.getByRole('button', { name: '确认保存详情页' }))
    await screen.findByText('已确认保存详情页（共 2 页），可以进入下一步。')
    expect(next).toBeEnabled()
    expect(observed?.detailEditor.confirmedDetails?.firstPngBlob).toBe(observed?.detailEditor.confirmedDetails?.pageExports[0].pngBlob)
    await user.click(next)
    expect(screen.getByTestId('detail-state')).toHaveAttribute('data-step', '6')
    expect(screen.getByTestId('detail-state')).toHaveAttribute('data-completion', 'true')
    expect(observed?.marketingStrategyStep.completion).toBeNull()
  })

  it('deduplicates export and confirmation double activation with transaction locks', async () => {
    const user = userEvent.setup()
    let release!: () => void
    mocks.compose.mockImplementationOnce(() => new Promise<Blob>((resolve) => { release = () => resolve(new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' })) }))
    renderStep()
    await user.dblClick(screen.getByRole('button', { name: '同步导出' }))
    expect(mocks.compose).toHaveBeenCalledOnce()
    await act(async () => release())
    await screen.findByText('本页已同步导出（rev 0）')
    await user.dblClick(screen.getByRole('button', { name: '确认保存详情页' }))
    await screen.findByText('已确认保存详情页（共 1 页），可以进入下一步。')
    expect(observed?.detailEditor.confirmedDetails?.pageExports).toHaveLength(1)
  })

  it('owns and revokes resource object URLs and exposes safe renderer retry', async () => {
    const user = userEvent.setup()
    const view = renderStep()
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalledTimes(1))
    await user.click(screen.getByRole('button', { name: '模拟画布失败' }))
    expect(screen.getByRole('alert')).toHaveTextContent('详情页编辑器加载失败，请重试。')
    expect(screen.getByRole('button', { name: '重试加载编辑器' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: '重试加载编辑器' }))
    expect(screen.getByRole('img', { name: '详情页画布' })).toBeVisible()
    const createdUrls = vi.mocked(URL.createObjectURL).mock.results.map((result) => result.value)
    view.unmount()
    const revokedUrls = vi.mocked(URL.revokeObjectURL).mock.calls.map(([url]) => url)
    for (const url of createdUrls) expect(revokedUrls).toContain(url)
  })

  it('keeps the V2 Workspace return enabled during cutout, aborts it on mouse leave, and preserves authority', async () => {
    const user = userEvent.setup()
    const fixture = await v2DetailState()
    const held = deferred<Blob>()
    let observedSignal: AbortSignal | undefined
    mocks.cutout.mockImplementationOnce((_blob: Blob, signal?: AbortSignal) => {
      observedSignal = signal
      signal?.addEventListener('abort', () => held.reject(new DOMException('aborted', 'AbortError')), { once: true })
      return held.promise
    })
    renderV2Step(fixture.state)

    await user.click(screen.getByRole('tab', { name: '图片' }))
    await user.click(screen.getAllByRole('button', { name: '去除背景' })[0])
    await waitFor(() => expect(mocks.cutout).toHaveBeenCalledOnce())
    const returnButton = screen.getByRole('button', { name: '返回创作工作台' })
    expect(returnButton).toBeEnabled()
    expect(screen.getByTestId('detail-state')).toHaveAttribute('data-image-busy', 'true')

    await user.click(returnButton)
    expect(await screen.findByTestId('v2-destination')).toHaveTextContent('workspace')
    expect(observedSignal?.aborted).toBe(true)
    expect(observed?.detailEditor.operations.imageBusy).toBe(false)
    expect(observed?.detailEditor.resources).toEqual(fixture.state.detailEditor.resources)
    expect(observed?.detailEditor.pages).toEqual(fixture.state.detailEditor.pages)
    expect(observed?.workflowV2.basicAuthority).toBe(fixture.basic)
    expect(observed?.workflowV2.adviceAuthority).toBe(fixture.authority)
    expect(observed?.workflowV2.confirmedPoster).toBe(fixture.poster)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('allows keyboard Workspace return and ignores a non-cooperative late cutout success without creating a resource URL', async () => {
    const user = userEvent.setup()
    const fixture = await v2DetailState()
    const held = deferred<Blob>()
    mocks.cutout.mockImplementationOnce(() => held.promise)
    renderV2Step(fixture.state)

    await user.click(screen.getByRole('tab', { name: '图片' }))
    await user.click(screen.getAllByRole('button', { name: '去除背景' })[0])
    await waitFor(() => expect(mocks.cutout).toHaveBeenCalledOnce())
    const createdBefore = vi.mocked(URL.createObjectURL).mock.calls.length
    const returnButton = screen.getByRole('button', { name: '返回创作工作台' })
    returnButton.focus()
    await user.keyboard('{Enter}')
    expect(await screen.findByTestId('v2-destination')).toHaveTextContent('workspace')

    await act(async () => held.resolve(new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' })))
    expect(observed?.detailEditor.resources).toEqual(fixture.state.detailEditor.resources)
    expect(observed?.detailEditor.pages).toEqual(fixture.state.detailEditor.pages)
    expect(observed?.detailEditor.operations.imageStatus).toBe('')
    expect(vi.mocked(URL.createObjectURL)).toHaveBeenCalledTimes(createdBefore)
  })

  it('ignores a non-cooperative late cutout failure after leaving Detail', async () => {
    const user = userEvent.setup()
    const fixture = await v2DetailState()
    const held = deferred<Blob>()
    mocks.cutout.mockImplementationOnce(() => held.promise)
    renderV2Step(fixture.state)

    await user.click(screen.getByRole('tab', { name: '图片' }))
    await user.click(screen.getAllByRole('button', { name: '去除背景' })[0])
    await waitFor(() => expect(mocks.cutout).toHaveBeenCalledOnce())
    await user.click(screen.getByRole('button', { name: '返回创作工作台' }))
    expect(await screen.findByTestId('v2-destination')).toHaveTextContent('workspace')

    await act(async () => held.reject(new Error('fixture failure')))
    expect(observed?.detailEditor.operations.imageStatus).toBe('')
    expect(observed?.detailEditor.resources).toEqual(fixture.state.detailEditor.resources)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

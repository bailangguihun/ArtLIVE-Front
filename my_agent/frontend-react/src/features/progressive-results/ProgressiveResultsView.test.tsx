import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  copyRefFromConfirmedCopy,
  createBasicAuthority,
  createConfirmedCopy,
  createConfirmedDetail,
  createConfirmedPoster,
  createCopyInputAuthority,
  createDetailOwner,
  createPosterCopySnapshot,
  createPosterProjectInput,
  createPresentAdviceAuthority,
  posterRefFromConfirmedPoster,
} from '../../state/workflow-v2/workflow-v2-authorities'
import type { AdviceResult } from '../../state/workflow-v2/workflow-v2-types'
import { WorkflowDispatchContext, WorkflowStateContext } from '../../state/workflow-context'
import { WorkflowProvider } from '../../state/WorkflowProvider'
import { createInitialWorkflowState, workflowReducer } from '../../state/workflow-reducer'
import type { WorkflowState } from '../../state/workflow-types'
import { createV2DetailProject } from '../detail-editor/v2-detail-adapter'
import { confirmedSnapshot, confirmStepFour, createStepFourState } from '../poster-editor/poster-editor-test-utils'
import * as progressiveResultsModel from './progressive-results-model'
import { ProgressiveResultsView } from './ProgressiveResultsView'

const hash = (character: string) => character.repeat(64)
const adviceResult: AdviceResult = {
  category_id: 'fmcg', category_name: '快速消费品', confidence: 'low',
  matched_keywords: [], reason: 'fixture', score: 0,
  strategy: { id: 'fmcg', name: '策略', examples: '示例', traits: ['清晰'], tactics: ['说明'], one_liner: '方向' },
  source: 'desktop_ai_different_product_marketing_strategies',
}

async function posterResultsState(options: { withCopy?: boolean; copyBody?: string } = {}) {
  let state = createStepFourState()
  const legacy = confirmedSnapshot(state)
  state = confirmStepFour(state, legacy)
  const basic = await createBasicAuthority({
    productInfo: '测试商品', productShortName: '商品', creativeNote: '说明',
    platform: 'xiaohongshu', style: 'premium',
    productImage: { byteSha256: hash('1'), mimeType: 'image/png', byteSize: 64 },
  })
  const advice = await createPresentAdviceAuthority({
    api_version: 'v1', advice_version: 'catalog-v1', status: 'present',
    input_signature_sha256: basic.text.adviceInputSignatureSha256,
    advice_signature_sha256: hash('2'), advice: adviceResult,
  }, basic)
  const copy = options.withCopy ? await createConfirmedCopy({
    copyInput: await createCopyInputAuthority(basic, advice),
    revision: 1,
    source: { kind: 'selected', selectedIndex: 0, candidateSignatureSha256: hash('3') },
    fields: {
      body: options.copyBody ?? '当前推广文案',
      title: '标题',
      headline: '主标题',
      subline: '副标题',
    },
  }) : null
  const project = await createPosterProjectInput({
    projectId: options.withCopy ? 'copy-owned-results' : 'poster-owned-results',
    basic,
    advice,
    copySource: options.withCopy ? 'confirmed_copy' : 'poster_owned',
    copyRef: copy ? copyRefFromConfirmedCopy(copy) : undefined,
  })
  const snapshot = await createPosterCopySnapshot({
    fields: copy
      ? { body: copy.body, title: copy.title, headline: copy.headline, subline: copy.subline }
      : { body: '海报专用快照', title: '海报标题', headline: '', subline: '' },
    platform: basic.settings.platform,
    style: basic.settings.style,
    sourceMode: project.copySource,
    sourceCopyRef: project.copyRef ?? undefined,
  })
  const poster = await createConfirmedPoster({
    project, generationId: legacy.generationId, posterId: legacy.posterId, slot: legacy.slot,
    baseBlobSha256: legacy.baseBlobSha256, layoutSha256: legacy.layoutSha256,
    upstreamSha256: legacy.upstreamSha256,
    compositionInputSignatureSha256: legacy.inputSignatureSha256,
    pngBlobSha256: legacy.pngBlobSha256, confirmedRevision: legacy.confirmedRevision,
    resourceRevision: 1, copySnapshot: snapshot,
  })
  return {
    ...state,
    workflowV2: {
      ...state.workflowV2,
      phase: 'active' as const, view: 'results' as const, resumeView: 'results' as const, epoch: 1,
      basicAuthority: basic, adviceAuthority: advice, confirmedCopy: copy,
      posterProject: project, confirmedPoster: poster,
    },
  }
}

async function copyResultsState(body: string): Promise<WorkflowState> {
  const state = createInitialWorkflowState()
  const basic = await createBasicAuthority({
    productInfo: '测试商品', productShortName: '商品', creativeNote: '说明',
    platform: 'xiaohongshu', style: 'premium',
    productImage: { byteSha256: hash('1'), mimeType: 'image/png', byteSize: 64 },
  })
  const advice = await createPresentAdviceAuthority({
    api_version: 'v1', advice_version: 'catalog-v1', status: 'present',
    input_signature_sha256: basic.text.adviceInputSignatureSha256,
    advice_signature_sha256: hash('2'), advice: adviceResult,
  }, basic)
  const copy = await createConfirmedCopy({
    copyInput: await createCopyInputAuthority(basic, advice),
    revision: 1,
    source: { kind: 'selected', selectedIndex: 0, candidateSignatureSha256: hash('3') },
    fields: { body, title: '标题', headline: '主标题', subline: '副标题' },
  })
  return {
    ...state,
    workflowV2: {
      ...state.workflowV2,
      phase: 'active', view: 'results', resumeView: 'results', epoch: 0,
      basicAuthority: basic, adviceAuthority: advice, confirmedCopy: copy,
    },
  }
}

async function allCurrentResultsState(copyBody = '当前推广文案'): Promise<WorkflowState> {
  const posterState = await posterResultsState({ withCopy: true, copyBody })
  const poster = posterState.workflowV2.confirmedPoster!
  const posterRef = posterRefFromConfirmedPoster(poster)
  const owner = await createDetailOwner(posterRef)
  const project = createV2DetailProject(owner)
  const legacy = posterState.posterEditor.confirmedPoster!
  const entered = workflowReducer(posterState, {
    type: 'COMMIT_V2_DETAIL_ENTRY',
    project,
    legacyOwner: {
      generationId: legacy.generationId,
      posterId: legacy.posterId,
      inputSignatureSha256: legacy.inputSignatureSha256,
      pngBlobSha256: legacy.pngBlobSha256,
    },
    posterResource: {
      id: 'poster-final', kind: 'poster-final', name: 'confirmed-poster',
      blob: legacy.pngBlob, sha256: legacy.pngBlobSha256,
      mimeType: 'image/png', width: 1024, height: 1536,
    },
  })
  const page = entered.detailEditor.pages[0]
  const detailBlob = new Blob([new Uint8Array([4, 5, 6, 7])], { type: 'image/png' })
  const exported = {
    pageId: page.id,
    revision: page.compositionRevision,
    signatureSha256: hash('9'),
    pngBlob: detailBlob,
    pngBlobSha256: hash('a'),
    width: 750 as const,
    height: 1334 as const,
  }
  const detail = await createConfirmedDetail({
    detailId: project.detailId,
    posterRef,
    detailRevision: 1,
    resourceRevision: 1,
    pageSignatureSha256: [exported.signatureSha256],
    pngBlobSha256: [exported.pngBlobSha256],
    groupSignatureSha256: hash('b'),
  })
  return {
    ...entered,
    detailEditor: {
      ...entered.detailEditor,
      pages: [{ ...page, currentExport: exported }],
      confirmedDetails: {
        owner: entered.detailEditor.owner!,
        pageExports: [exported],
        pngBlobs: [detailBlob],
        firstPngBlob: detailBlob,
        groupSignatureSha256: hash('b'),
        confirmedResourceRevision: 1,
      },
    },
    workflowV2: {
      ...entered.workflowV2,
      phase: 'active', view: 'results', resumeView: 'results', epoch: 0,
      confirmedDetail: detail,
      currentDetailOutputSignatureSha256: detail.outputSignatureSha256,
    },
  }
}

function renderWithContexts(state: WorkflowState, dispatch = vi.fn()) {
  return {
    dispatch,
    ...render(
      <WorkflowStateContext.Provider value={state}>
        <WorkflowDispatchContext.Provider value={dispatch}>
          <ProgressiveResultsView />
        </WorkflowDispatchContext.Provider>
      </WorkflowStateContext.Provider>,
    ),
  }
}

function installObjectUrlCapture() {
  const blobByUrl = new Map<string, Blob>()
  const revoked: string[] = []
  const downloads: Array<{ fileName: string; blob: Blob | undefined }> = []
  let sequence = 0
  vi.stubGlobal('URL', {
    createObjectURL: vi.fn((blob: Blob) => {
      const value = `blob:round5-${++sequence}`
      blobByUrl.set(value, blob)
      return value
    }),
    revokeObjectURL: vi.fn((value: string) => { revoked.push(value) }),
  })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function captureDownload(this: HTMLAnchorElement) {
    const href = this.getAttribute('href') ?? ''
    downloads.push({ fileName: this.download, blob: blobByUrl.get(href) })
  })
  return { blobByUrl, revoked, downloads }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('ProgressiveResultsView', () => {
  it('focuses Results, labels the Poster Frozen Copy Snapshot separately, and balances preview/download object URLs in StrictMode', async () => {
    const state = await posterResultsState()
    const user = userEvent.setup()
    const capture = installObjectUrlCapture()
    vi.stubGlobal('fetch', vi.fn())
    const rendered = render(
      <StrictMode>
        <WorkflowProvider initialState={state}><ProgressiveResultsView /></WorkflowProvider>
      </StrictMode>,
    )
    const heading = await screen.findByRole('heading', { name: '创作成果' })
    await waitFor(() => expect(document.activeElement).toBe(heading))
    expect(screen.getByRole('heading', { name: '海报文案快照' })).toBeVisible()
    expect(screen.getByText('这是海报溯源快照，不是“最终文案”。')).toBeVisible()
    expect(screen.queryByRole('heading', { name: '推广文案' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '下载海报' }))
    expect(capture.downloads).toEqual([{
      fileName: 'confirmed-poster.png',
      blob: state.posterEditor.confirmedPoster?.pngBlob,
    }])
    expect(capture.downloads[0].blob?.type).toBe('image/png')
    expect(globalThis.fetch).not.toHaveBeenCalled()
    rendered.unmount()
    for (const value of capture.blobByUrl.keys()) {
      expect(capture.revoked.filter((item) => item === value)).toHaveLength(1)
    }
  })

  it('renders the existing empty state and returns to Workspace without inventing disabled artifact actions', async () => {
    const state = createInitialWorkflowState()
    const active: WorkflowState = {
      ...state,
      workflowV2: {
        ...state.workflowV2,
        phase: 'active', view: 'results', resumeView: 'results', epoch: 0,
      },
    }
    const user = userEvent.setup()
    const { dispatch } = renderWithContexts(active)

    expect(screen.getByLabelText('成果当前不可用')).toBeVisible()
    expect(screen.queryByRole('button', { name: /下载/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '返回创作工作台' }))
    expect(dispatch).toHaveBeenCalledWith({ type: 'RETURN_FROM_V2_RESULTS' })
  })

  it('preserves exact Unicode and whitespace in the current Copy DOM and downloaded UTF-8 Blob', async () => {
    const body = '首行  保留\r\n\r\n末行尾随两个空格  '
    const state = await copyResultsState(body)
    const capture = installObjectUrlCapture()
    const user = userEvent.setup()
    renderWithContexts(state)

    expect(document.querySelector('.progressive-results__copy')?.textContent).toBe(body)
    await user.click(screen.getByRole('button', { name: '下载文案' }))
    expect(capture.downloads).toHaveLength(1)
    expect(capture.downloads[0].fileName).toBe('confirmed-promotional-copy.txt')
    expect(capture.downloads[0].blob?.type).toBe('text/plain;charset=utf-8')
    expect(await capture.downloads[0].blob?.text()).toBe(body)
    expect(Array.from(new Uint8Array(await capture.downloads[0].blob!.arrayBuffer()))).toEqual(
      Array.from(new TextEncoder().encode(body)),
    )
    for (const value of capture.blobByUrl.keys()) {
      expect(capture.revoked.filter((item) => item === value)).toHaveLength(1)
    }
  })

  it('keeps all-current card order, preview Blob identity, metadata, and download Blob identity', async () => {
    const state = await allCurrentResultsState()
    const capture = installObjectUrlCapture()
    const user = userEvent.setup()
    const rendered = renderWithContexts(state)
    const posterBlob = state.posterEditor.confirmedPoster!.pngBlob
    const detailBlob = state.detailEditor.confirmedDetails!.pageExports[0].pngBlob

    expect(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)).toEqual([
      '海报设计', '推广文案', '详情页',
    ])
    expect(screen.getByText('3 项创作成果 · 全部当前确认成果已收集。')).toBeVisible()
    expect(screen.getByText('已确认海报设计 · 1024 × 1536')).toBeVisible()
    expect(screen.getByText('详情页 1 · 750 × 1334')).toBeVisible()
    expect([...capture.blobByUrl.values()]).toEqual(expect.arrayContaining([posterBlob, detailBlob]))

    await user.click(screen.getByRole('button', { name: '下载海报' }))
    await user.click(screen.getByRole('button', { name: '下载文案' }))
    await user.click(screen.getByRole('button', { name: '按顺序下载详情页' }))
    expect(capture.downloads.map((item) => ({ fileName: item.fileName, blob: item.blob }))).toEqual([
      { fileName: 'confirmed-poster.png', blob: posterBlob },
      { fileName: 'confirmed-promotional-copy.txt', blob: expect.any(Blob) },
      { fileName: 'confirmed-detail-1.png', blob: detailBlob },
    ])
    rendered.unmount()
    for (const value of capture.blobByUrl.keys()) {
      expect(capture.revoked.filter((item) => item === value)).toHaveLength(1)
    }
  })

  it('excludes one stale Detail and then all stale artifacts instead of rendering stale cards', async () => {
    const state = await allCurrentResultsState()
    const capture = installObjectUrlCapture()
    const oneStale: WorkflowState = {
      ...state,
      workflowV2: {
        ...state.workflowV2,
        currentDetailOutputSignatureSha256: hash('f'),
      },
    }
    const first = renderWithContexts(oneStale)
    expect(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)).toEqual([
      '海报设计', '推广文案',
    ])
    expect(screen.queryByRole('heading', { name: '详情页' })).not.toBeInTheDocument()
    expect(screen.queryByText(/已不再属于当前创作/)).not.toBeInTheDocument()
    first.unmount()
    const objectUrlCount = capture.blobByUrl.size

    const differentBasic = await createBasicAuthority({
      productInfo: '另一商品', productShortName: '另一商品', creativeNote: '不同说明',
      platform: 'douyin', style: 'vibrant',
      productImage: { byteSha256: hash('e'), mimeType: 'image/png', byteSize: 32 },
    })
    const allStale: WorkflowState = {
      ...state,
      workflowV2: { ...state.workflowV2, basicAuthority: differentBasic },
    }
    renderWithContexts(allStale)
    expect(screen.getByLabelText('成果当前不可用')).toBeVisible()
    expect(screen.queryByRole('button', { name: /下载/ })).not.toBeInTheDocument()
    expect(capture.blobByUrl.size).toBe(objectUrlCount)
  })

  it('uses the existing warning status and refuses a download when currentness changes at click time', async () => {
    const state = await copyResultsState('点击竞争条件文案')
    const unavailableState = createInitialWorkflowState()
    const actualSelect = progressiveResultsModel.selectCurrentProgressiveResultsView
    const currentView = actualSelect(state)
    const unavailableView = actualSelect(unavailableState)
    vi.spyOn(progressiveResultsModel, 'selectCurrentProgressiveResultsView')
      .mockReturnValueOnce(currentView)
      .mockReturnValue(unavailableView)
    const capture = installObjectUrlCapture()
    const user = userEvent.setup()
    renderWithContexts(state)

    await user.click(screen.getByRole('button', { name: '下载文案' }))
    expect(capture.downloads).toHaveLength(0)
    expect(screen.getByRole('status')).toHaveTextContent(
      '该成果已不再属于当前创作，未执行下载。请返回工作台查看当前状态。',
    )
  })
})

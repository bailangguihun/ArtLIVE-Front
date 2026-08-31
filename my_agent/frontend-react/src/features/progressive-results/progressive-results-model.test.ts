import { describe, expect, it } from 'vitest'
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
import type { AdviceResult, ConfirmedCopy } from '../../state/workflow-v2/workflow-v2-types'
import { createInitialWorkflowState, workflowReducer } from '../../state/workflow-reducer'
import type { WorkflowState } from '../../state/workflow-types'
import { confirmedSnapshot, confirmStepFour, createStepFourState } from '../poster-editor/poster-editor-test-utils'
import { createV2DetailProject } from '../detail-editor/v2-detail-adapter'
import { selectCurrentProgressiveResultsView } from './progressive-results-model'

const hash = (character: string) => character.repeat(64)
const adviceResult: AdviceResult = {
  category_id: 'fmcg', category_name: '快速消费品', confidence: 'low',
  matched_keywords: [], reason: 'fixture', score: 0,
  strategy: { id: 'fmcg', name: '策略', examples: '示例', traits: ['清晰'], tactics: ['说明'], one_liner: '方向' },
  source: 'desktop_ai_different_product_marketing_strategies',
}

async function confirmedCopy(
  basic: Awaited<ReturnType<typeof createBasicAuthority>>,
  advice: Awaited<ReturnType<typeof createPresentAdviceAuthority>>,
): Promise<ConfirmedCopy> {
  return createConfirmedCopy({
    copyInput: await createCopyInputAuthority(basic, advice),
    revision: 1,
    source: { kind: 'selected', selectedIndex: 0, candidateSignatureSha256: hash('3') },
    fields: { body: '当前推广文案', title: '标题', headline: '主标题', subline: '副标题' },
  })
}

async function currentPosterState(options: { withCopy?: boolean } = {}): Promise<WorkflowState> {
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
  const copy = options.withCopy ? await confirmedCopy(basic, advice) : null
  const project = await createPosterProjectInput({
    projectId: options.withCopy ? 'copy-project' : 'poster-owned-project',
    basic, advice, copySource: options.withCopy ? 'confirmed_copy' : 'poster_owned',
    copyRef: copy ? copyRefFromConfirmedCopy(copy) : undefined,
  })
  const snapshot = await createPosterCopySnapshot({
    fields: copy
      ? { body: copy.body, title: copy.title, headline: copy.headline, subline: copy.subline }
      : { body: '海报专用快照', title: '海报标题', headline: '', subline: '' },
    platform: basic.settings.platform, style: basic.settings.style,
    sourceMode: project.copySource, sourceCopyRef: project.copyRef ?? undefined,
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
      phase: 'active', view: 'workspace', resumeView: 'workspace', epoch: 1,
      basicAuthority: basic, adviceAuthority: advice, confirmedCopy: copy,
      posterProject: project, confirmedPoster: poster,
    },
  }
}

async function currentDetailState(): Promise<WorkflowState> {
  const posterState = await currentPosterState()
  const poster = posterState.workflowV2.confirmedPoster!
  const ref = posterRefFromConfirmedPoster(poster)
  const owner = await createDetailOwner(ref)
  const project = createV2DetailProject(owner)
  const legacy = posterState.posterEditor.confirmedPoster!
  const entered = workflowReducer(posterState, {
    type: 'COMMIT_V2_DETAIL_ENTRY',
    project,
    legacyOwner: {
      generationId: legacy.generationId, posterId: legacy.posterId,
      inputSignatureSha256: legacy.inputSignatureSha256, pngBlobSha256: legacy.pngBlobSha256,
    },
    posterResource: {
      id: 'poster-final', kind: 'poster-final', name: 'confirmed-poster', blob: legacy.pngBlob,
      sha256: legacy.pngBlobSha256, mimeType: 'image/png', width: 1024, height: 1536,
    },
  })
  const page = entered.detailEditor.pages[0]
  const exported = {
    pageId: page.id, revision: page.compositionRevision, signatureSha256: hash('9'),
    pngBlob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
    pngBlobSha256: hash('a'), width: 750 as const, height: 1334 as const,
  }
  const detail = await createConfirmedDetail({
    detailId: project.detailId, posterRef: ref, detailRevision: 1, resourceRevision: 1,
    pageSignatureSha256: [exported.signatureSha256], pngBlobSha256: [exported.pngBlobSha256],
    groupSignatureSha256: hash('b'),
  })
  return {
    ...entered,
    detailEditor: {
      ...entered.detailEditor,
      pages: [{ ...page, currentExport: exported }],
      confirmedDetails: {
        owner: entered.detailEditor.owner!, pageExports: [exported], pngBlobs: [exported.pngBlob],
        firstPngBlob: exported.pngBlob, groupSignatureSha256: hash('b'), confirmedResourceRevision: 1,
      },
    },
    workflowV2: {
      ...entered.workflowV2,
      confirmedDetail: detail, currentDetailOutputSignatureSha256: detail.outputSignatureSha256,
      view: 'workspace', resumeView: 'workspace',
    },
  }
}

describe('current Progressive Results adapter', () => {
  it('keeps poster-owned Poster and its frozen copy snapshot distinct from Promotional Copy', async () => {
    const state = await currentPosterState()
    const view = selectCurrentProgressiveResultsView(state)
    expect(view.selection.mode).toBe('poster_only')
    expect(view.selection.promotionalCopy).toBeNull()
    expect(view.poster).not.toBeNull()
    expect(view.selection.posterCopySnapshots[0].label).toBe('Poster Frozen Copy Snapshot')
    expect(view.artifactCount).toBe(1)
  })

  it('admits exact ordered confirmed Detail exports only with the matching current PosterRef', async () => {
    const state = await currentDetailState()
    const view = selectCurrentProgressiveResultsView(state)
    expect(view.selection.mode).toBe('poster_and_detail')
    expect(view.details.map((asset) => asset.ordinal)).toEqual([1])
    expect(view.details.map((asset) => asset.sha256)).toEqual(
      state.workflowV2.confirmedDetail?.pngBlobSha256,
    )
    const stale = {
      ...state,
      workflowV2: { ...state.workflowV2, currentDetailOutputSignatureSha256: hash('f') },
    }
    expect(selectCurrentProgressiveResultsView(stale).selection.mode).toBe('poster_only')
  })

  it('fails closed when a rendered blob no longer matches the V2 authority', async () => {
    const state = await currentPosterState({ withCopy: true })
    const invalid = {
      ...state,
      posterEditor: {
        ...state.posterEditor,
        confirmedPoster: {
          ...state.posterEditor.confirmedPoster!,
          pngBlobSha256: hash('f'),
        },
      },
    }
    expect(selectCurrentProgressiveResultsView(state).selection.mode).toBe('copy_and_poster')
    expect(selectCurrentProgressiveResultsView(invalid).selection.mode).toBe('copy_only')
  })

  it('does not reinterpret legacy terminal state as V2 Results authority', () => {
    expect(selectCurrentProgressiveResultsView(createInitialWorkflowState()).selection.mode).toBe('none')
  })
})

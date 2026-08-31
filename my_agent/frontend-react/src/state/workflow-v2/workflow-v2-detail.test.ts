import { describe, expect, it } from 'vitest'
import {
  createBasicAuthority,
  createConfirmedCopy,
  createConfirmedDetail,
  createConfirmedPoster,
  createDetailOwner,
  createCopyInputAuthority,
  createPosterCopySnapshot,
  createPosterProjectInput,
  createPresentAdviceAuthority,
  copyRefFromConfirmedCopy,
  posterRefFromConfirmedPoster,
} from './workflow-v2-authorities'
import { selectDetailModuleStatus } from './workflow-v2-selectors'
import { workflowReducer } from '../workflow-reducer'
import {
  confirmStepFour,
  confirmedSnapshot,
  createStepFourState,
} from '../../features/poster-editor/poster-editor-test-utils'
import { createV2DetailProject } from '../../features/detail-editor/v2-detail-adapter'
import type { AdviceResult } from './workflow-v2-types'

const hash = (character: string) => character.repeat(64)
const advice: AdviceResult = {
  category_id: 'fmcg', category_name: '快消品', confidence: 'low',
  matched_keywords: [], reason: 'fallback', score: 0,
  strategy: { id: 'fmcg', name: '策略', examples: '示例', traits: ['特点'], tactics: ['建议'], one_liner: '方向' },
  source: 'desktop_ai_different_product_marketing_strategies',
}

async function fixture(copySource: 'poster_owned' | 'confirmed_copy' = 'poster_owned') {
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
  const confirmedCopy = copySource === 'confirmed_copy'
    ? await createConfirmedCopy({
        copyInput: await createCopyInputAuthority(basic, authority),
        revision: 1,
        source: {
          kind: 'generated',
          requestFingerprintSha256: hash('c'),
          variantSignatureSha256: hash('d'),
          selectedVariantIndex: 0,
        },
        fields: { body: '已确认宣传文案', title: '', headline: '', subline: '' },
      })
    : null
  const copyRef = confirmedCopy ? copyRefFromConfirmedCopy(confirmedCopy) : undefined
  const project = await createPosterProjectInput({
    projectId: `poster-${copySource}`,
    basic,
    advice: authority,
    copySource,
    copyRef,
  })
  const snapshot = await createPosterCopySnapshot({
    fields: confirmedCopy
      ? { body: confirmedCopy.body, title: confirmedCopy.title, headline: confirmedCopy.headline, subline: confirmedCopy.subline }
      : { body: '海报专用文案', title: '', headline: '', subline: '' },
    platform: basic.settings.platform, style: basic.settings.style,
    sourceMode: copySource,
    sourceCopyRef: copyRef,
  })
  const poster = await createConfirmedPoster({
    project, generationId: 'g', posterId: 'p', slot: 1,
    baseBlobSha256: hash('3'), layoutSha256: hash('4'), upstreamSha256: hash('5'),
    compositionInputSignatureSha256: hash('6'), pngBlobSha256: hash('7'),
    confirmedRevision: 1, resourceRevision: 1, copySnapshot: snapshot,
  })
  return { basic, authority, poster }
}

describe('Workflow V2 Detail selector ownership', () => {
  it('unlocks only for one exact current PosterRef and supports Poster-owned copy', async () => {
    const { poster } = await fixture('poster_owned')
    const ready = selectDetailModuleStatus({
      currentPoster: poster, confirmedDetail: null,
      currentDetailOutputSignatureSha256: null, operation: { kind: 'idle' },
    })
    expect(ready).toMatchObject({ status: 'ready', reasonCode: 'inputs_current' })

    const ref = posterRefFromConfirmedPoster(poster)
    const detail = await createConfirmedDetail({
      detailId: 'detail', posterRef: ref, detailRevision: 0, resourceRevision: 1,
      pageSignatureSha256: [hash('8')], pngBlobSha256: [hash('9')], groupSignatureSha256: hash('a'),
    })
    const completed = selectDetailModuleStatus({
      currentPoster: poster, confirmedDetail: detail,
      currentDetailOutputSignatureSha256: detail.outputSignatureSha256,
      operation: { kind: 'idle' },
    })
    expect(completed.status).toBe('completed')
  })

  it('fails closed when the Detail owner references another confirmed Poster revision', async () => {
    const { poster } = await fixture()
    const detail = await createConfirmedDetail({
      detailId: 'detail', posterRef: { ...posterRefFromConfirmedPoster(poster), confirmedRevision: 9 },
      detailRevision: 0, resourceRevision: 1,
      pageSignatureSha256: [hash('8')], pngBlobSha256: [hash('9')], groupSignatureSha256: hash('a'),
    })
    const result = selectDetailModuleStatus({
      currentPoster: poster, confirmedDetail: detail,
      currentDetailOutputSignatureSha256: detail.outputSignatureSha256,
      operation: { kind: 'idle' },
    })
    expect(result).toMatchObject({ status: 'stale', reasonCode: 'poster_reference_stale' })
  })

  it('unlocks Detail for a current confirmed-Copy Poster without weakening its exact PosterRef', async () => {
    const { poster } = await fixture('confirmed_copy')
    const result = selectDetailModuleStatus({
      currentPoster: poster,
      confirmedDetail: null,
      currentDetailOutputSignatureSha256: null,
      operation: { kind: 'idle' },
    })
    expect(result).toMatchObject({ status: 'ready', reasonCode: 'inputs_current' })
    expect(poster.project.copySource).toBe('confirmed_copy')
    expect(poster.project.copyRef).not.toBeNull()
  })

  it('admits the legacy final PNG when its composition signature matches the exact PosterRef', async () => {
    const { basic, authority, poster: seedPoster } = await fixture('poster_owned')
    let legacyState = createStepFourState()
    const active = legacyState.posterEditor.active
    expect(active).not.toBeNull()
    const legacy = confirmedSnapshot(legacyState)
    const poster = await createConfirmedPoster({
      project: seedPoster.project,
      generationId: legacy.generationId,
      posterId: legacy.posterId,
      slot: legacy.slot,
      baseBlobSha256: legacy.baseBlobSha256,
      layoutSha256: legacy.layoutSha256,
      upstreamSha256: legacy.upstreamSha256,
      compositionInputSignatureSha256: legacy.inputSignatureSha256,
      pngBlobSha256: legacy.pngBlobSha256,
      confirmedRevision: legacy.confirmedRevision,
      resourceRevision: 1,
      copySnapshot: seedPoster.copySnapshot,
    })
    legacyState = confirmStepFour(legacyState, legacy)
    const owner = await createDetailOwner(posterRefFromConfirmedPoster(poster))
    const project = createV2DetailProject(owner)
    const ready = {
      ...legacyState,
      workflowV2: {
        ...legacyState.workflowV2,
        phase: 'active' as const,
        view: 'poster' as const,
        resumeView: 'poster' as const,
        epoch: 1,
        basicAuthority: basic,
        adviceAuthority: authority,
        posterProject: poster.project,
        confirmedPoster: poster,
      },
    }
    const entered = workflowReducer(ready, {
      type: 'COMMIT_V2_DETAIL_ENTRY',
      project,
      legacyOwner: {
        generationId: legacy.generationId,
        posterId: legacy.posterId,
        inputSignatureSha256: legacy.inputSignatureSha256,
        pngBlobSha256: legacy.pngBlobSha256,
      },
      posterResource: {
        id: 'poster-final',
        kind: 'poster-final',
        name: 'confirmed-poster',
        blob: legacy.pngBlob,
        sha256: legacy.pngBlobSha256,
        mimeType: 'image/png',
        width: 1024,
        height: 1536,
      },
    })

    expect(entered.currentStep).toBe(5)
    expect(entered.workflowV2.view).toBe('detail')
    expect(entered.workflowV2.detailProject?.owner.posterRef.compositionInputSignatureSha256)
      .toBe(legacy.inputSignatureSha256)
  })
})

import { describe, expect, it } from 'vitest'
import {
  copyRefFromConfirmedCopy,
  createBasicAuthority,
  createConfirmedCopy,
  createConfirmedDetail,
  createConfirmedPoster,
  createCopyInputAuthority,
  createPosterCopySnapshot,
  createPosterProjectInput,
  createPresentAdviceAuthority,
  posterRefFromConfirmedPoster,
} from './workflow-v2-authorities'
import {
  selectCopyModuleStatus,
  selectDetailModuleStatus,
  selectPosterModuleStatus,
  selectProgressiveResults,
} from './workflow-v2-selectors'
import type {
  AdviceResult,
  BasicAuthority,
  ConfirmedCopy,
  ConfirmedDetail,
  ConfirmedPoster,
  PresentAdviceAuthority,
} from './workflow-v2-types'

const hash = (character: string) => character.repeat(64)
const idle = { kind: 'idle' as const }

const ADVICE_RESULT: AdviceResult = {
  category_id: 'fmcg',
  category_name: '快消品',
  confidence: 'low',
  matched_keywords: [],
  reason: '未命中明确品类关键词，默认按快消品策略给出参考。',
  score: 0,
  strategy: {
    id: 'fmcg',
    name: '快消品',
    examples: '日常消费品',
    traits: ['高频'],
    tactics: ['明确利益点'],
    one_liner: '快速传递价值。',
  },
  source: 'desktop_ai_different_product_marketing_strategies',
}

async function basic(overrides: Partial<{
  productInfo: string
  platform: 'xiaohongshu' | 'douyin'
  style: 'premium' | 'vibrant'
  imageHash: string | null
}> = {}): Promise<BasicAuthority> {
  const imageHash = overrides.imageHash === undefined ? hash('1') : overrides.imageHash
  return createBasicAuthority({
    productInfo: overrides.productInfo ?? 'Unclassified product',
    productShortName: 'Product',
    creativeNote: 'Launch',
    platform: overrides.platform ?? 'xiaohongshu',
    style: overrides.style ?? 'premium',
    productImage: imageHash
      ? { byteSha256: imageHash, mimeType: 'image/png', byteSize: 256 }
      : null,
  })
}

async function adviceFor(owner: BasicAuthority, signature = hash('2')) {
  return createPresentAdviceAuthority({
    api_version: 'v1', advice_version: 'catalog-v1', status: 'present',
    input_signature_sha256: owner.text.adviceInputSignatureSha256,
    advice_signature_sha256: signature,
    advice: ADVICE_RESULT,
  }, owner)
}

async function copyFor(
  owner: BasicAuthority,
  advice: PresentAdviceAuthority,
  revision = 1,
): Promise<ConfirmedCopy> {
  return createConfirmedCopy({
    copyInput: await createCopyInputAuthority(owner, advice),
    revision,
    source: {
      kind: 'selected', selectedIndex: 0, candidateSignatureSha256: hash('3'),
    },
    fields: {
      body: `Promotional copy revision ${revision}`,
      title: 'Copy title', headline: 'Copy headline', subline: 'Copy subline',
    },
  })
}

async function posterFor(input: {
  owner: BasicAuthority
  advice: PresentAdviceAuthority
  copy?: ConfirmedCopy
  projectId?: string
  revision?: number
}): Promise<ConfirmedPoster> {
  const copyRef = input.copy ? copyRefFromConfirmedCopy(input.copy) : undefined
  const project = await createPosterProjectInput({
    projectId: input.projectId ?? 'project-a',
    basic: input.owner,
    advice: input.advice,
    copyRef,
  })
  const copySnapshot = await createPosterCopySnapshot({
    fields: input.copy
      ? {
          body: input.copy.body,
          title: input.copy.title,
          headline: input.copy.headline,
          subline: input.copy.subline,
        }
      : { body: 'Frozen poster copy', title: 'Poster title', headline: '', subline: '' },
    platform: input.owner.settings.platform,
    style: input.owner.settings.style,
    sourceCopyRef: copyRef,
  })
  return createConfirmedPoster({
    project,
    generationId: 'generation-a',
    posterId: 'poster-a',
    slot: 1,
    baseBlobSha256: hash('4'),
    layoutSha256: hash('5'),
    upstreamSha256: hash('6'),
    compositionInputSignatureSha256: hash('7'),
    pngBlobSha256: hash('8'),
    confirmedRevision: input.revision ?? 1,
    resourceRevision: input.revision ?? 1,
    copySnapshot,
  })
}

async function detailFor(
  poster: ConfirmedPoster,
  detailId = 'detail-a',
): Promise<ConfirmedDetail> {
  return createConfirmedDetail({
    detailId,
    posterRef: posterRefFromConfirmedPoster(poster),
    detailRevision: 1,
    resourceRevision: 1,
    pageSignatureSha256: [hash('9')],
    pngBlobSha256: [hash('a')],
    groupSignatureSha256: hash('b'),
  })
}

describe('derived Copy module status', () => {
  it('derives all six statuses without mutable status state', async () => {
    const owner = await basic()
    const advice = await adviceFor(owner)
    const input = await createCopyInputAuthority(owner, advice)
    const copy = await copyFor(owner, advice)

    expect(selectCopyModuleStatus({
      basic: null, advice: null, input: null, confirmedCopy: null, operation: idle,
    })).toMatchObject({ status: 'locked', reasonCode: 'basic_missing' })
    expect(selectCopyModuleStatus({
      basic: owner, advice, input, confirmedCopy: null, operation: idle,
    })).toMatchObject({ status: 'ready', reasonCode: 'inputs_current' })
    expect(selectCopyModuleStatus({
      basic: owner, advice, input, confirmedCopy: null,
      operation: { kind: 'in_progress', phase: 'copy_request', ownerInputSignatureSha256: input.inputSignatureSha256 },
    })).toMatchObject({ status: 'in_progress', reasonCode: 'request_in_progress' })
    expect(selectCopyModuleStatus({
      basic: owner, advice, input, confirmedCopy: copy, operation: idle,
    })).toMatchObject({ status: 'completed', reasonCode: 'output_current' })

    const changed = await basic({ platform: 'douyin' })
    const changedInput = await createCopyInputAuthority(changed, advice)
    expect(selectCopyModuleStatus({
      basic: changed, advice, input: changedInput, confirmedCopy: copy, operation: idle,
    })).toMatchObject({ status: 'stale', reasonCode: 'output_stale', recoverableDraft: true })
    expect(selectCopyModuleStatus({
      basic: owner, advice, input, confirmedCopy: null,
      operation: { kind: 'failed', phase: 'copy_request', ownerInputSignatureSha256: input.inputSignatureSha256, errorCode: 'safe_error' },
    })).toMatchObject({ status: 'failed', reasonCode: 'operation_failed' })
    expect(selectCopyModuleStatus({
      basic: owner, advice, input, confirmedCopy: null,
      operation: { kind: 'failed', phase: 'copy_request', ownerInputSignatureSha256: hash('f'), errorCode: 'stale_error' },
    })).toMatchObject({ status: 'ready', reasonCode: 'inputs_current' })
  })

  it('uses stable locked/stale reasons and preserves recoverable output knowledge', async () => {
    const owner = await basic()
    const advice = await adviceFor(owner)
    const input = await createCopyInputAuthority(owner, advice)
    const copy = await copyFor(owner, advice)
    expect(selectCopyModuleStatus({
      basic: owner, basicIsCurrent: false, advice, input, confirmedCopy: copy, operation: idle,
    })).toMatchObject({ status: 'locked', reasonCode: 'basic_stale', recoverableDraft: true })
    expect(selectCopyModuleStatus({
      basic: owner, advice: null, input: null, confirmedCopy: copy, operation: idle,
    })).toMatchObject({ status: 'locked', reasonCode: 'advice_missing', recoverableDraft: true })
    const changedText = await basic({ productInfo: 'Changed text' })
    expect(selectCopyModuleStatus({
      basic: changedText, advice, input, confirmedCopy: copy, operation: idle,
    })).toMatchObject({ status: 'stale', reasonCode: 'advice_stale', recoverableDraft: true })
  })
})

describe('derived Poster module status', () => {
  it('derives all six statuses and accepts a project with no CopyRef', async () => {
    const owner = await basic()
    const advice = await adviceFor(owner)
    const project = await createPosterProjectInput({ projectId: 'project-a', basic: owner, advice })
    const poster = await posterFor({ owner, advice })
    const noImage = await basic({ imageHash: null })

    expect(selectPosterModuleStatus({
      basic: noImage, advice, project: null, currentCopy: null,
      confirmedPoster: null, currentPosterRef: null, operation: idle,
    })).toMatchObject({ status: 'locked', reasonCode: 'product_image_missing' })
    expect(selectPosterModuleStatus({
      basic: owner, advice, project, currentCopy: null,
      confirmedPoster: null, currentPosterRef: null, operation: idle,
    })).toMatchObject({ status: 'ready', reasonCode: 'inputs_current' })
    expect(selectPosterModuleStatus({
      basic: owner, advice, project, currentCopy: null, confirmedPoster: null,
      currentPosterRef: null,
      operation: { kind: 'in_progress', phase: 'poster_polling', ownerInputSignatureSha256: project.inputSignatureSha256 },
    })).toMatchObject({ status: 'in_progress', reasonCode: 'request_in_progress' })
    for (const phase of [
      'poster_admission',
      'poster_generation',
      'poster_polling',
      'poster_download',
      'poster_editing',
      'poster_export',
      'poster_confirmation',
    ] as const) {
      expect(selectPosterModuleStatus({
        basic: owner,
        advice,
        project,
        currentCopy: null,
        confirmedPoster: null,
        currentPosterRef: null,
        operation: {
          kind: 'in_progress',
          phase,
          ownerInputSignatureSha256: project.inputSignatureSha256,
        },
      })).toMatchObject({ status: 'in_progress', reasonCode: 'request_in_progress' })
    }
    expect(selectPosterModuleStatus({
      basic: owner, advice, project, currentCopy: null,
      confirmedPoster: poster, currentPosterRef: posterRefFromConfirmedPoster(poster), operation: idle,
    })).toMatchObject({ status: 'completed', reasonCode: 'output_current' })
    expect(selectPosterModuleStatus({
      basic: owner, advice, project, currentCopy: null,
      confirmedPoster: poster, currentPosterRef: null, operation: idle,
    })).toMatchObject({ status: 'stale', reasonCode: 'output_stale' })

    const changedImage = await basic({ imageHash: hash('c') })
    expect(selectPosterModuleStatus({
      basic: changedImage, advice, project, currentCopy: null,
      confirmedPoster: poster, currentPosterRef: posterRefFromConfirmedPoster(poster), operation: idle,
    })).toMatchObject({ status: 'stale', reasonCode: 'owner_mismatch' })
    expect(selectPosterModuleStatus({
      basic: owner, advice, project, currentCopy: null, confirmedPoster: null,
      currentPosterRef: null,
      operation: { kind: 'failed', phase: 'poster_generation', ownerInputSignatureSha256: project.inputSignatureSha256, errorCode: 'safe_error' },
    })).toMatchObject({ status: 'failed', reasonCode: 'operation_failed' })
  })

  it('fails an explicit stale CopyRef closed while leaving no-CopyRef Posters current', async () => {
    const owner = await basic()
    const advice = await adviceFor(owner)
    const copy1 = await copyFor(owner, advice, 1)
    const copy2 = await copyFor(owner, advice, 2)
    const withRef = await posterFor({ owner, advice, copy: copy1 })
    const withoutRef = await posterFor({ owner, advice })
    expect(selectPosterModuleStatus({
      basic: owner, advice, project: withRef.project, currentCopy: copy2,
      confirmedPoster: withRef, currentPosterRef: posterRefFromConfirmedPoster(withRef), operation: idle,
    })).toMatchObject({ status: 'stale', reasonCode: 'copy_reference_stale' })
    expect(selectPosterModuleStatus({
      basic: owner, advice, project: withoutRef.project, currentCopy: copy2,
      confirmedPoster: withoutRef, currentPosterRef: posterRefFromConfirmedPoster(withoutRef), operation: idle,
    })).toMatchObject({ status: 'completed', reasonCode: 'output_current' })
  })

  it('reports capability lock without discarding a recoverable draft', async () => {
    const owner = await basic()
    const advice = await adviceFor(owner)
    const poster = await posterFor({ owner, advice })
    expect(selectPosterModuleStatus({
      basic: owner, advice, project: poster.project, currentCopy: null,
      confirmedPoster: poster, currentPosterRef: posterRefFromConfirmedPoster(poster),
      operation: idle, capabilityAvailable: false,
    })).toMatchObject({
      status: 'locked', reasonCode: 'capability_unavailable', recoverableDraft: true,
    })
  })
})

describe('derived Detail module status', () => {
  it('derives all six statuses from mandatory exact PosterRef ownership', async () => {
    const owner = await basic()
    const advice = await adviceFor(owner)
    const poster = await posterFor({ owner, advice, revision: 1 })
    const detail = await detailFor(poster)
    const posterRef = posterRefFromConfirmedPoster(poster)

    expect(selectDetailModuleStatus({
      currentPoster: null, confirmedDetail: null,
      currentDetailOutputSignatureSha256: null, operation: idle,
    })).toMatchObject({ status: 'locked', reasonCode: 'poster_not_confirmed' })
    expect(selectDetailModuleStatus({
      currentPoster: poster, confirmedDetail: null,
      currentDetailOutputSignatureSha256: null, operation: idle,
    })).toMatchObject({ status: 'ready', reasonCode: 'inputs_current' })
    expect(selectDetailModuleStatus({
      currentPoster: poster, confirmedDetail: null,
      currentDetailOutputSignatureSha256: null,
      operation: { kind: 'in_progress', phase: 'detail_export', ownerInputSignatureSha256: posterRef.outputSignatureSha256 },
    })).toMatchObject({ status: 'in_progress', reasonCode: 'request_in_progress' })
    for (const phase of [
      'detail_editing', 'detail_export', 'detail_confirmation',
    ] as const) {
      expect(selectDetailModuleStatus({
        currentPoster: poster,
        confirmedDetail: null,
        currentDetailOutputSignatureSha256: null,
        operation: {
          kind: 'in_progress',
          phase,
          ownerInputSignatureSha256: posterRef.outputSignatureSha256,
        },
      })).toMatchObject({ status: 'in_progress', reasonCode: 'request_in_progress' })
    }
    expect(selectDetailModuleStatus({
      currentPoster: poster, confirmedDetail: detail,
      currentDetailOutputSignatureSha256: detail.outputSignatureSha256,
      operation: idle,
    })).toMatchObject({ status: 'completed', reasonCode: 'output_current' })
    expect(selectDetailModuleStatus({
      currentPoster: poster, confirmedDetail: detail,
      currentDetailOutputSignatureSha256: null, operation: idle,
    })).toMatchObject({ status: 'stale', reasonCode: 'output_stale' })

    const revisedPoster = await posterFor({ owner, advice, revision: 2 })
    expect(selectDetailModuleStatus({
      currentPoster: revisedPoster, confirmedDetail: detail,
      currentDetailOutputSignatureSha256: detail.outputSignatureSha256,
      operation: idle,
    })).toMatchObject({ status: 'stale', reasonCode: 'poster_reference_stale' })
    expect(selectDetailModuleStatus({
      currentPoster: poster, confirmedDetail: null,
      currentDetailOutputSignatureSha256: null,
      operation: { kind: 'failed', phase: 'detail_confirmation', ownerInputSignatureSha256: posterRef.outputSignatureSha256, errorCode: 'safe_error' },
    })).toMatchObject({ status: 'failed', reasonCode: 'operation_failed' })
  })
})

describe('field-scoped currentness and progressive Results', () => {
  it('keeps Advice and Copy current when only product-image bytes change', async () => {
    const owner = await basic({ imageHash: hash('1') })
    const advice = await adviceFor(owner)
    const copy = await copyFor(owner, advice)
    const poster = await posterFor({ owner, advice, copy })
    const changedImage = await basic({ imageHash: hash('c') })
    const changedCopyInput = await createCopyInputAuthority(changedImage, advice)
    expect(changedCopyInput.inputSignatureSha256).toBe(copy.input.inputSignatureSha256)
    expect(selectCopyModuleStatus({
      basic: changedImage, advice, input: changedCopyInput,
      confirmedCopy: copy, operation: idle,
    })).toMatchObject({ status: 'completed' })
    expect(selectPosterModuleStatus({
      basic: changedImage, advice, project: poster.project,
      currentCopy: copy, confirmedPoster: poster,
      currentPosterRef: posterRefFromConfirmedPoster(poster), operation: idle,
    })).toMatchObject({ status: 'stale' })
  })

  it('supports none, Copy only, Poster only, Copy plus Poster, Poster plus Detail, and all current', async () => {
    const owner = await basic()
    const advice = await adviceFor(owner)
    const copy = await copyFor(owner, advice)
    const posterOnly = await posterFor({ owner, advice })
    const posterWithCopy = await posterFor({ owner, advice, copy })
    const detailOnly = await detailFor(posterOnly)
    const detailAll = await detailFor(posterWithCopy)
    const select = (confirmedCopy: ConfirmedCopy | null, confirmedPosters: ConfirmedPoster[], confirmedDetails: ConfirmedDetail[]) =>
      selectProgressiveResults({
        basic: owner,
        advice,
        confirmedCopy,
        confirmedPosters,
        currentPosterRefs: confirmedPosters.map(posterRefFromConfirmedPoster),
        confirmedDetails,
        currentDetailOutputSignatureSha256: confirmedDetails.map(
          (detail) => detail.outputSignatureSha256,
        ),
      })

    expect(select(null, [], []).mode).toBe('none')
    expect(select(copy, [], []).mode).toBe('copy_only')
    expect(select(null, [posterOnly], []).mode).toBe('poster_only')
    expect(select(copy, [posterWithCopy], []).mode).toBe('copy_and_poster')
    expect(select(null, [posterOnly], [detailOnly]).mode).toBe('poster_and_detail')
    expect(select(copy, [posterWithCopy], [detailAll]).mode).toBe('all_current')
  })

  it('keeps Promotional Copy and the Poster frozen copy snapshot distinct', async () => {
    const owner = await basic()
    const advice = await adviceFor(owner)
    const copy = await copyFor(owner, advice)
    const poster = await posterFor({ owner, advice, copy })
    const result = selectProgressiveResults({
      basic: owner, advice, confirmedCopy: copy,
      confirmedPosters: [poster],
      currentPosterRefs: [posterRefFromConfirmedPoster(poster)],
      confirmedDetails: [], currentDetailOutputSignatureSha256: [],
    })
    expect(result.promotionalCopy).toMatchObject({
      kind: 'promotional_copy', label: 'Promotional Copy',
    })
    expect(result.posterCopySnapshots[0]).toMatchObject({
      kind: 'poster_copy_snapshot', label: 'Poster Frozen Copy Snapshot',
    })
    expect(result.promotionalCopy?.artifactIdentitySha256).not.toBe(
      result.posterCopySnapshots[0].artifactIdentitySha256,
    )
    expect(result.artifacts.map((artifact) => artifact.kind)).toEqual([
      'promotional_copy', 'poster', 'poster_copy_snapshot',
    ])
  })

  it('excludes stale artifacts but preserves current unaffected artifacts', async () => {
    const owner = await basic()
    const advice = await adviceFor(owner)
    const copy = await copyFor(owner, advice)
    const poster = await posterFor({ owner, advice, copy })
    const detail = await detailFor(poster)
    const changedImage = await basic({ imageHash: hash('c') })
    const result = selectProgressiveResults({
      basic: changedImage, advice, confirmedCopy: copy,
      confirmedPosters: [poster],
      currentPosterRefs: [posterRefFromConfirmedPoster(poster)],
      confirmedDetails: [detail],
      currentDetailOutputSignatureSha256: [detail.outputSignatureSha256],
    })
    expect(result.mode).toBe('copy_only')
    expect(result.promotionalCopy).not.toBeNull()
    expect(result.posters).toEqual([])
    expect(result.details).toEqual([])
    expect(result.exclusions).toEqual(expect.arrayContaining([
      { kind: 'poster', id: 'project-a', reason: 'stale' },
      { kind: 'detail', id: 'detail-a', reason: 'stale' },
    ]))
  })

  it('excludes compatible stale drafts whose current confirmation markers were cleared', async () => {
    const owner = await basic()
    const advice = await adviceFor(owner)
    const poster = await posterFor({ owner, advice })
    const detail = await detailFor(poster)
    const result = selectProgressiveResults({
      basic: owner,
      advice,
      confirmedCopy: null,
      confirmedPosters: [poster],
      currentPosterRefs: [],
      confirmedDetails: [detail],
      currentDetailOutputSignatureSha256: [],
    })
    expect(result.mode).toBe('none')
    expect(result.artifacts).toEqual([])
    expect(result.exclusions).toEqual([
      { kind: 'poster', id: 'project-a', reason: 'stale' },
      { kind: 'detail', id: 'detail-a', reason: 'stale' },
    ])
  })

  it('fails mixed Basic, CopyRef, PosterRef, revision, and signature owners closed', async () => {
    const owner = await basic()
    const advice = await adviceFor(owner)
    const copy = await copyFor(owner, advice)
    const poster = await posterFor({ owner, advice, copy })
    const detail = await detailFor(poster)
    const mixedCopy = { ...copy, platform: 'douyin' as const }
    const mixedPoster = {
      ...poster,
      copySnapshot: { ...poster.copySnapshot, sourceCopyRef: null },
    }
    const mixedDetail = {
      ...detail,
      owner: {
        ...detail.owner,
        posterRef: {
          ...detail.owner.posterRef,
          projectIdentitySha256: hash('f'),
        },
      },
    }
    const result = selectProgressiveResults({
      basic: owner,
      advice,
      confirmedCopy: mixedCopy,
      confirmedPosters: [mixedPoster],
      currentPosterRefs: [posterRefFromConfirmedPoster(poster)],
      confirmedDetails: [mixedDetail],
      currentDetailOutputSignatureSha256: [detail.outputSignatureSha256],
    })
    expect(result.mode).toBe('none')
    expect(result.artifacts).toEqual([])
    expect(result.exclusions.map((item) => item.reason)).toEqual([
      'mixed_owner', 'mixed_owner', 'mixed_owner',
    ])

    const signatureOnly = selectProgressiveResults({
      basic: owner,
      advice,
      confirmedCopy: {
        ...copy,
        input: { ...copy.input, inputSignatureSha256: hash('f') },
      },
      confirmedPosters: [{ ...poster, layoutSha256: hash('f') }],
      currentPosterRefs: [posterRefFromConfirmedPoster(poster)],
      confirmedDetails: [{ ...detail, groupSignatureSha256: hash('f') }],
      currentDetailOutputSignatureSha256: [detail.outputSignatureSha256],
    })
    expect(signatureOnly.mode).toBe('none')
    expect(signatureOnly.exclusions.map((item) => item.reason)).toEqual([
      'mixed_owner', 'mixed_owner', 'mixed_owner',
    ])
  })

  it('admits only Details referencing the exact current Poster revision', async () => {
    const owner = await basic()
    const advice = await adviceFor(owner)
    const oldPoster = await posterFor({ owner, advice, revision: 1 })
    const oldDetail = await detailFor(oldPoster)
    const currentPoster = await posterFor({ owner, advice, revision: 2 })
    const result = selectProgressiveResults({
      basic: owner, advice, confirmedCopy: null,
      confirmedPosters: [currentPoster],
      currentPosterRefs: [posterRefFromConfirmedPoster(currentPoster)],
      confirmedDetails: [oldDetail],
      currentDetailOutputSignatureSha256: [oldDetail.outputSignatureSha256],
    })
    expect(result.mode).toBe('poster_only')
    expect(result.details).toEqual([])
    expect(result.exclusions).toContainEqual({
      kind: 'detail', id: 'detail-a', reason: 'stale',
    })
  })
})

import { describe, expect, expectTypeOf, it } from 'vitest'
import { canonicalJson } from './workflow-v2-canonical'
import {
  adviceAuthorityFromRequestOutcome,
  canAcceptAdviceResponse,
  canAcceptAsyncResponse,
  canAcceptCopyResponse,
  canAcceptPosterResponse,
  confirmedCopyMatchesRef,
  confirmedPosterMatchesRef,
  copyRefFromConfirmedCopy,
  createAcknowledgedAbsentAdviceAuthority,
  createBasicAuthority,
  createConfirmedCopy,
  createConfirmedDetail,
  createConfirmedPoster,
  createCopyInputAuthority,
  createPosterCopySnapshot,
  createPosterProjectInput,
  createPresentAdviceAuthority,
  posterRefFromConfirmedPoster,
  sameCopyRef,
  samePosterRef,
} from './workflow-v2-authorities'
import { ASYNC_OWNERSHIP_VERSION } from './workflow-v2-types'
import type {
  AdviceResult,
  AsyncResponseOwnershipClaim,
  BasicAuthority,
  ConfirmedCopy,
  PendingAsyncOwnership,
  PosterRef,
  PresentAdviceAuthority,
} from './workflow-v2-types'

const hash = (character: string) => character.repeat(64)

const ADVICE_RESULT: AdviceResult = {
  category_id: 'digital',
  category_name: '数字产品',
  confidence: 'high',
  matched_keywords: ['API', 'SaaS'],
  reason: '根据关键词命中判定为「数字产品」。',
  score: 8,
  strategy: {
    id: 'digital',
    name: '数字产品',
    examples: 'API / SaaS',
    traits: ['可试用', '可扩展'],
    tactics: ['展示场景', '说明价值'],
    one_liner: '清晰说明数字价值。',
  },
  source: 'desktop_ai_different_product_marketing_strategies',
}

async function basic(overrides: Partial<{
  productInfo: string
  productShortName: string
  creativeNote: string
  platform: 'xiaohongshu' | 'douyin' | 'taobao' | 'pinduoduo'
  style: 'premium' | 'vibrant'
  imageHash: string | null
}> = {}): Promise<BasicAuthority> {
  const imageHash = overrides.imageHash === undefined ? hash('1') : overrides.imageHash
  return createBasicAuthority({
    productInfo: overrides.productInfo ?? 'API SaaS platform',
    productShortName: overrides.productShortName ?? 'Cloud',
    creativeNote: overrides.creativeNote ?? 'Launch',
    platform: overrides.platform ?? 'xiaohongshu',
    style: overrides.style ?? 'premium',
    productImage: imageHash
      ? { byteSha256: imageHash, mimeType: 'image/png', byteSize: 128 }
      : null,
  })
}

async function adviceFor(
  owner: BasicAuthority,
  adviceSignature = hash('2'),
): Promise<PresentAdviceAuthority> {
  return createPresentAdviceAuthority({
    api_version: 'v1',
    advice_version: 'catalog-v1',
    status: 'present',
    input_signature_sha256: owner.text.adviceInputSignatureSha256,
    advice_signature_sha256: adviceSignature,
    advice: ADVICE_RESULT,
  }, owner)
}

async function copyFor(
  owner: BasicAuthority,
  advice: PresentAdviceAuthority,
  revision = 1,
  body = 'Final promotional body',
): Promise<ConfirmedCopy> {
  const copyInput = await createCopyInputAuthority(owner, advice)
  return createConfirmedCopy({
    copyInput,
    revision,
    source: {
      kind: 'generated',
      requestFingerprintSha256: hash('3'),
      selectedVariantIndex: 0,
      variantSignatureSha256: hash('4'),
    },
    fields: { body, title: 'Title', headline: 'Headline', subline: 'Subline' },
  })
}

async function posterFor(
  owner: BasicAuthority,
  advice: PresentAdviceAuthority,
  copy: ConfirmedCopy | null,
  projectId = 'poster-project-a',
  confirmedRevision = 2,
) {
  const copyRef = copy ? copyRefFromConfirmedCopy(copy) : undefined
  const project = await createPosterProjectInput({
    projectId,
    basic: owner,
    advice,
    copyRef,
  })
  const snapshot = await createPosterCopySnapshot({
    fields: copy
      ? { body: copy.body, title: copy.title, headline: copy.headline, subline: copy.subline }
      : { body: 'Poster body', title: 'Poster title', headline: '', subline: '' },
    platform: owner.settings.platform,
    style: owner.settings.style,
    sourceCopyRef: copyRef,
  })
  return createConfirmedPoster({
    project,
    generationId: 'generation-a',
    posterId: 'poster-a',
    slot: 1,
    baseBlobSha256: hash('5'),
    layoutSha256: hash('6'),
    upstreamSha256: hash('7'),
    compositionInputSignatureSha256: hash('8'),
    pngBlobSha256: hash('9'),
    confirmedRevision,
    resourceRevision: 3,
    copySnapshot: snapshot,
  })
}

describe('Advice and Confirmed Copy authority contracts', () => {
  it('models a present Round 1 Advice result and an acknowledged absence separately', async () => {
    const owner = await basic()
    const present = await adviceFor(owner)
    const absent = await createAcknowledgedAbsentAdviceAuthority(owner)
    expect(present).toMatchObject({
      authorityVersion: 'workflow-v2-advice-authority-v1',
      kind: 'present',
      adviceVersion: 'catalog-v1',
      inputSignatureSha256: owner.text.adviceInputSignatureSha256,
      adviceSignatureSha256: hash('2'),
      advice: ADVICE_RESULT,
    })
    expect(present.ownerSignatureSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(absent).toMatchObject({
      kind: 'acknowledged_absent',
      absentReason: 'user_acknowledged_absence',
      inputSignatureSha256: owner.text.adviceInputSignatureSha256,
    })
    expect(absent.ownerSignatureSha256).not.toBe(present.ownerSignatureSha256)
    const absentCopyInput = await createCopyInputAuthority(owner, absent)
    const absentPosterInput = await createPosterProjectInput({
      projectId: 'absent-advice-project', basic: owner, advice: absent,
    })
    expect(absentCopyInput.adviceOwner.kind).toBe('acknowledged_absent')
    expect(absentPosterInput.adviceOwner.kind).toBe('acknowledged_absent')
  })

  it('never turns a failed Advice request into authority', async () => {
    const owner = await basic()
    const present = await adviceFor(owner)
    expect(adviceAuthorityFromRequestOutcome({ kind: 'failed', errorCode: 'offline' })).toBeNull()
    expect(adviceAuthorityFromRequestOutcome({ kind: 'succeeded', authority: present })).toBe(present)
  })

  it('creates stable Confirmed Copy output identity and exact immutable CopyRefs', async () => {
    const owner = await basic()
    const advice = await adviceFor(owner)
    const first = await copyFor(owner, advice)
    const repeated = await copyFor(owner, advice)
    const edited = await copyFor(owner, advice, 2, 'Edited final body')
    expect(repeated).toEqual(first)
    expect(first.outputSignatureSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(edited.outputSignatureSha256).not.toBe(first.outputSignatureSha256)

    const copyRef = copyRefFromConfirmedCopy(first)
    expect(confirmedCopyMatchesRef(first, copyRef)).toBe(true)
    expect(sameCopyRef(copyRef, { ...copyRef, revision: copyRef.revision + 1 })).toBe(false)
    expect(confirmedCopyMatchesRef(first, { ...copyRef, revision: 99 })).toBe(false)
    expect(copyRef).toMatchObject({
      revision: 1,
      inputSignatureSha256: first.input.inputSignatureSha256,
      outputSignatureSha256: first.outputSignatureSha256,
      basicOwner: first.input.basicOwner,
      adviceOwner: first.input.adviceOwner,
    })
  })
})

describe('Poster project, PosterRef, and Detail ownership', () => {
  it('keeps CopyRef genuinely optional and explicit while changing identity when supplied', async () => {
    const owner = await basic()
    const advice = await adviceFor(owner)
    const copy = await copyFor(owner, advice)
    const withoutCopy = await createPosterProjectInput({ projectId: 'project', basic: owner, advice })
    const withCopy = await createPosterProjectInput({
      projectId: 'project', basic: owner, advice, copyRef: copyRefFromConfirmedCopy(copy),
    })
    expect(withoutCopy.copyRef).toBeNull()
    expect(withCopy.copyRef).not.toBeNull()
    expect(withCopy.projectIdentitySha256).toBe(withoutCopy.projectIdentitySha256)
    expect(withCopy.inputSignatureSha256).not.toBe(withoutCopy.inputSignatureSha256)
  })

  it('treats the selected style template as a stable semantic Poster input', async () => {
    const owner = await basic()
    const advice = await adviceFor(owner)
    const smartMatch = await createPosterProjectInput({
      projectId: 'project',
      basic: owner,
      advice,
      styleTemplateId: null,
    })
    const repeatedSmartMatch = await createPosterProjectInput({
      projectId: 'project',
      basic: owner,
      advice,
      styleTemplateId: null,
    })
    const paperDoodleGrid = await createPosterProjectInput({
      projectId: 'project',
      basic: owner,
      advice,
      styleTemplateId: 'paper_doodle_grid',
    })
    expect(smartMatch.styleTemplateId).toBeNull()
    expect(repeatedSmartMatch.inputSignatureSha256)
      .toBe(smartMatch.inputSignatureSha256)
    expect(paperDoodleGrid.styleTemplateId).toBe('paper_doodle_grid')
    expect(paperDoodleGrid.projectIdentitySha256)
      .toBe(smartMatch.projectIdentitySha256)
    expect(paperDoodleGrid.inputSignatureSha256)
      .not.toBe(smartMatch.inputSignatureSha256)
    expect(canonicalJson(paperDoodleGrid)).toContain('styleTemplateId')
  })

  it('changes Poster input identity for an exact Copy revision or image-byte change', async () => {
    const owner = await basic()
    const advice = await adviceFor(owner)
    const copy1 = await copyFor(owner, advice, 1)
    const copy2 = await copyFor(owner, advice, 2)
    const project1 = await createPosterProjectInput({
      projectId: 'project', basic: owner, advice, copyRef: copyRefFromConfirmedCopy(copy1),
    })
    const project2 = await createPosterProjectInput({
      projectId: 'project', basic: owner, advice, copyRef: copyRefFromConfirmedCopy(copy2),
    })
    expect(project2.inputSignatureSha256).not.toBe(project1.inputSignatureSha256)

    const changedImage = await basic({ imageHash: hash('a') })
    const imageProject = await createPosterProjectInput({
      projectId: 'project', basic: changedImage, advice,
    })
    const noCopyProject = await createPosterProjectInput({ projectId: 'project', basic: owner, advice })
    expect(imageProject.inputSignatureSha256).not.toBe(noCopyProject.inputSignatureSha256)
    expect(canonicalJson(imageProject)).not.toMatch(/filename|objectUrl|previewUrl|blob:/i)

    const replacementAdvice = await adviceFor(owner, hash('b'))
    const replacementProject = await createPosterProjectInput({
      projectId: 'project', basic: owner, advice: replacementAdvice,
    })
    expect(replacementProject.inputSignatureSha256).not.toBe(
      noCopyProject.inputSignatureSha256,
    )
    expect((await createCopyInputAuthority(owner, replacementAdvice)).inputSignatureSha256).not.toBe(
      copy1.input.inputSignatureSha256,
    )
  })

  it('rejects a CopyRef that mixes Basic or Advice owners', async () => {
    const ownerA = await basic()
    const adviceA = await adviceFor(ownerA)
    const ownerB = await basic({ productInfo: 'Different product' })
    const adviceB = await adviceFor(ownerB, hash('a'))
    const copyB = await copyFor(ownerB, adviceB)
    await expect(createPosterProjectInput({
      projectId: 'mixed',
      basic: ownerA,
      advice: adviceA,
      copyRef: copyRefFromConfirmedCopy(copyB),
    })).rejects.toThrow(/mixed Basic or Advice owner/)
  })

  it('binds PosterRef to every exact confirmed output field and requires it for Detail', async () => {
    const owner = await basic()
    const advice = await adviceFor(owner)
    const copy = await copyFor(owner, advice)
    const poster = await posterFor(owner, advice, copy)
    const posterRef = posterRefFromConfirmedPoster(poster)
    expect(confirmedPosterMatchesRef(poster, posterRef)).toBe(true)
    expect(samePosterRef(posterRef, { ...posterRef, confirmedRevision: 99 })).toBe(false)
    expect(confirmedPosterMatchesRef(poster, { ...posterRef, pngBlobSha256: hash('a') })).toBe(false)

    const detail = await createConfirmedDetail({
      detailId: 'detail-a',
      posterRef,
      detailRevision: 4,
      resourceRevision: 2,
      pageSignatureSha256: [hash('a')],
      pngBlobSha256: [hash('b')],
      groupSignatureSha256: hash('c'),
    })
    expect(detail.owner.posterRef).toEqual(posterRef)
    expect(detail.outputSignatureSha256).toMatch(/^[a-f0-9]{64}$/)
    expectTypeOf<
      Parameters<typeof createConfirmedDetail>[0]['posterRef']
    >().toEqualTypeOf<PosterRef>()
  })
})

function claim(pending: PendingAsyncOwnership): AsyncResponseOwnershipClaim {
  return {
    module: pending.module,
    workflowEpoch: pending.workflowEpoch,
    requestId: pending.requestId,
    pendingFingerprintSha256: pending.pendingFingerprintSha256,
    ownerInputSignatureSha256: pending.ownerInputSignatureSha256,
    revision: pending.revision,
    referenceSignatureSha256: pending.referenceSignatureSha256,
  }
}

describe('stale asynchronous response ownership guards', () => {
  const requestA: PendingAsyncOwnership = {
    version: ASYNC_OWNERSHIP_VERSION,
    module: 'advice',
    workflowEpoch: 7,
    requestId: 'request-a',
    pendingFingerprintSha256: hash('a'),
    ownerInputSignatureSha256: hash('b'),
    revision: null,
    referenceSignatureSha256: null,
  }

  it('rejects request A after Basic changes and request B becomes current', () => {
    const requestB = {
      ...requestA,
      requestId: 'request-b',
      pendingFingerprintSha256: hash('c'),
      ownerInputSignatureSha256: hash('d'),
    }
    expect(canAcceptAdviceResponse(requestA, requestB, claim(requestA))).toBe(false)
    expect(canAcceptAdviceResponse(requestB, requestB, claim(requestB))).toBe(true)
  })

  it('rejects responses after reset and after explicit reference replacement', () => {
    expect(canAcceptAsyncResponse(requestA, null, claim(requestA))).toBe(false)
    const posterA = { ...requestA, module: 'poster' as const, referenceSignatureSha256: hash('1') }
    const posterB = { ...posterA, referenceSignatureSha256: hash('2') }
    expect(canAcceptPosterResponse(posterA, posterB, claim(posterA))).toBe(false)
  })

  it('rejects matching request IDs with wrong fingerprints and matching fingerprints with wrong owners', () => {
    expect(canAcceptAsyncResponse(requestA, requestA, {
      ...claim(requestA), pendingFingerprintSha256: hash('e'),
    })).toBe(false)
    expect(canAcceptAsyncResponse(requestA, requestA, {
      ...claim(requestA), ownerInputSignatureSha256: hash('f'),
    })).toBe(false)
  })

  it('rejects mixed module, revision, epoch, and reference owners', () => {
    const copyPending = {
      ...requestA,
      module: 'copy' as const,
      revision: 3,
      referenceSignatureSha256: hash('3'),
    }
    expect(canAcceptCopyResponse(copyPending, copyPending, claim(copyPending))).toBe(true)
    expect(canAcceptCopyResponse(copyPending, copyPending, {
      ...claim(copyPending), revision: 4,
    })).toBe(false)
    expect(canAcceptCopyResponse(copyPending, copyPending, {
      ...claim(copyPending), workflowEpoch: 8,
    })).toBe(false)
    expect(canAcceptAdviceResponse(copyPending, copyPending, claim(copyPending))).toBe(false)
  })
})

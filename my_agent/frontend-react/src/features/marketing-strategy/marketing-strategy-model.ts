import { sameDetailOwner } from '../detail-editor/detail-defaults'
import { canonicalJson } from '../poster-editor/poster-signature'
import {
  PLATFORM_OPTIONS,
  type CopyStrategyOwner,
  type MarketingStrategy,
  type PlatformId,
} from '../../types/platform-copy'
import {
  MARKETING_STRATEGY_VIEW_VERSION,
  type AbsentStrategyOwner,
  type PosterStrategyOwner,
  type Step5AuthoritySnapshot,
  type Step6Completion,
  type Step6PlatformView,
  type Step6StrategyView,
  type Step6ViewModel,
  type StrategyDisplayBlock,
  type StrategySourceOwner,
  type UnboundStrategyOwner,
} from '../../types/marketing-strategy'
import type { WorkflowState } from '../../state/workflow-types'

const ABSENT_OWNER: AbsentStrategyOwner = {
  sourceKind: 'none',
}

const UNBOUND_OWNER = (candidateSourceKind: 'copy' | 'poster'): UnboundStrategyOwner => ({
  sourceKind: 'unbound',
  candidateSourceKind,
})

const SHA256_CONSTANTS = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
  0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
  0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
  0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
] as const

function rotateRight(value: number, amount: number) {
  return (value >>> amount) | (value << (32 - amount))
}

export function sha256TextSync(value: string) {
  const source = new TextEncoder().encode(value)
  const paddedLength = Math.ceil((source.length + 9) / 64) * 64
  const padded = new Uint8Array(paddedLength)
  padded.set(source)
  padded[source.length] = 0x80
  const bitLength = source.length * 8
  const view = new DataView(padded.buffer)
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000), false)
  view.setUint32(paddedLength - 4, bitLength >>> 0, false)

  const hash = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ])
  const words = new Uint32Array(64)

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(offset + index * 4, false)
    }
    for (let index = 16; index < 64; index += 1) {
      const left = words[index - 15]
      const right = words[index - 2]
      const sigma0 = rotateRight(left, 7) ^ rotateRight(left, 18) ^ (left >>> 3)
      const sigma1 = rotateRight(right, 17) ^ rotateRight(right, 19) ^ (right >>> 10)
      words[index] = (words[index - 16] + sigma0 + words[index - 7] + sigma1) >>> 0
    }

    let [a, b, c, d, e, f, g, h] = hash
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25)
      const choose = (e & f) ^ (~e & g)
      const temporary1 = (h + sum1 + choose + SHA256_CONSTANTS[index] + words[index]) >>> 0
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22)
      const majority = (a & b) ^ (a & c) ^ (b & c)
      const temporary2 = (sum0 + majority) >>> 0
      h = g
      g = f
      f = e
      e = (d + temporary1) >>> 0
      d = c
      c = b
      b = a
      a = (temporary1 + temporary2) >>> 0
    }
    hash[0] = (hash[0] + a) >>> 0
    hash[1] = (hash[1] + b) >>> 0
    hash[2] = (hash[2] + c) >>> 0
    hash[3] = (hash[3] + d) >>> 0
    hash[4] = (hash[4] + e) >>> 0
    hash[5] = (hash[5] + f) >>> 0
    hash[6] = (hash[6] + g) >>> 0
    hash[7] = (hash[7] + h) >>> 0
  }

  return Array.from(hash, (word) => word.toString(16).padStart(8, '0')).join('')
}

function semanticSignature(kind: string, value: unknown) {
  return sha256TextSync(`${kind}:${canonicalJson(value)}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function normalizedText(value: unknown, field: string, malformed: Set<string>) {
  if (value === undefined || value === null || value === '') return ''
  if (typeof value !== 'string') {
    malformed.add(field)
    return ''
  }
  return value
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function normalizedList(value: unknown, field: string, malformed: Set<string>) {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) {
    malformed.add(field)
    return []
  }
  const items: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') {
      malformed.add(field)
      continue
    }
    const normalized = normalizedText(item, field, malformed)
    if (normalized) items.push(normalized)
  }
  return items
}

export interface NormalizedStrategyContent {
  status: 'present' | 'absent' | 'malformed'
  blocks: StrategyDisplayBlock[]
  malformedFields: string[]
  signatureSha256: string
}

export function normalizeMarketingStrategy(value: unknown): NormalizedStrategyContent {
  if (
    value === null ||
    value === undefined ||
    value === '' ||
    (typeof value === 'string' && value.trim() === '') ||
    (Array.isArray(value) && value.length === 0)
  ) {
    return {
      status: 'absent',
      blocks: [],
      malformedFields: [],
      signatureSha256: semanticSignature('strategy', { status: 'absent' }),
    }
  }
  if (!isRecord(value)) {
    return {
      status: 'malformed',
      blocks: [],
      malformedFields: ['$'],
      signatureSha256: semanticSignature('strategy', { status: 'malformed' }),
    }
  }
  if (Object.keys(value).length === 0) {
    return {
      status: 'absent',
      blocks: [],
      malformedFields: [],
      signatureSha256: semanticSignature('strategy', { status: 'absent' }),
    }
  }

  const malformed = new Set<string>()
  const hasNestedStrategy = Object.prototype.hasOwnProperty.call(value, 'strategy')
  const nested = isRecord(value.strategy) ? value.strategy : null
  if (hasNestedStrategy && value.strategy !== null && value.strategy !== undefined && !nested) {
    malformed.add('strategy')
  }
  const detail = nested ?? value
  const categoryName =
    normalizedText(value.category_name, 'category_name', malformed) ||
    normalizedText(detail.name, nested ? 'strategy.name' : 'name', malformed)
  const confidence = normalizedText(value.confidence, 'confidence', malformed)
  const reason = normalizedText(value.reason, 'reason', malformed)
  const keywords = normalizedList(value.matched_keywords, 'matched_keywords', malformed)
  const examples = normalizedText(detail.examples, nested ? 'strategy.examples' : 'examples', malformed)
  const oneLiner = normalizedText(detail.one_liner, nested ? 'strategy.one_liner' : 'one_liner', malformed)
  const traits = normalizedList(detail.traits, nested ? 'strategy.traits' : 'traits', malformed)
  const tactics = normalizedList(detail.tactics, nested ? 'strategy.tactics' : 'tactics', malformed)
  const blocks: StrategyDisplayBlock[] = []

  if (categoryName || confidence || reason) {
    blocks.push({
      kind: 'summary',
      categoryName: categoryName || '未知',
      confidence: confidence || '-',
      reason,
    })
  }
  if (keywords.length > 0) blocks.push({ kind: 'keywords', items: keywords })
  if (examples) blocks.push({ kind: 'paragraph', label: '覆盖范围', text: examples, emphasis: false })
  if (oneLiner) blocks.push({ kind: 'paragraph', label: null, text: oneLiner, emphasis: true })
  if (traits.length > 0) blocks.push({ kind: 'list', heading: '核心特点', ordered: false, items: traits })
  if (tactics.length > 0) blocks.push({ kind: 'list', heading: '建议营销策略', ordered: true, items: tactics })

  const malformedFields = [...malformed].sort()
  const status = blocks.length > 0 ? 'present' : 'malformed'
  return {
    status,
    blocks,
    malformedFields,
    signatureSha256: semanticSignature('strategy', {
      version: MARKETING_STRATEGY_VIEW_VERSION,
      status,
      blocks,
      malformedFields,
    }),
  }
}

function hasStrategyCandidate(value: MarketingStrategy) {
  return Object.keys(value).length > 0
}

function copyOwnerSignature(owner: CopyStrategyOwner) {
  return semanticSignature('copy-owner', owner)
}

function posterOwner(state: WorkflowState): PosterStrategyOwner | null {
  const result = state.posterGeneration.result
  if (!result) return null
  return {
    sourceKind: 'poster',
    generationId: result.generationId,
    requestId: result.requestId,
    intentFingerprint: state.posterGeneration.resultIntentFingerprint,
    targetPlatform: result.targetPlatform,
    targetPlatformResolution: result.targetPlatformResolution,
  }
}

function sourceOwnerSignature(owner: StrategySourceOwner) {
  return semanticSignature(`${owner.sourceKind}-owner`, owner)
}

function platformLabel(id: PlatformId) {
  return PLATFORM_OPTIONS.find((option) => option.id === id)?.label ?? '小红书'
}

function resolvedPlatform(state: WorkflowState, poster: PosterStrategyOwner | null): Step6PlatformView {
  const copyOwner = state.platformCopy.strategyOwner
  if (
    copyOwner &&
    state.platformCopy.generationPlatform === copyOwner.platform &&
    state.platformCopy.generationStyle === copyOwner.style
  ) {
    return {
      id: copyOwner.platform,
      label: platformLabel(copyOwner.platform),
      sourceKind: 'copy',
      sourceOwnerSignatureSha256: copyOwnerSignature(copyOwner),
    }
  }
  if (poster?.targetPlatform) {
    return {
      id: poster.targetPlatform,
      label: platformLabel(poster.targetPlatform),
      sourceKind: poster.targetPlatformResolution === 'legacy-defaulted-unknown'
        ? 'legacy-defaulted-unknown'
        : 'poster',
      sourceOwnerSignatureSha256: sourceOwnerSignature(poster),
    }
  }
  const current = state.platformCopy.platform
  return {
    id: current,
    label: platformLabel(current),
    sourceKind: 'current',
    sourceOwnerSignatureSha256: semanticSignature('current-platform', { id: current }),
  }
}

function selectedStrategy(state: WorkflowState, poster: PosterStrategyOwner | null) {
  if (hasStrategyCandidate(state.platformCopy.marketingStrategy)) {
    const owner: StrategySourceOwner = state.platformCopy.strategyOwner ?? UNBOUND_OWNER('copy')
    return { raw: state.platformCopy.marketingStrategy, owner }
  }
  const posterStrategy = state.posterGeneration.result?.marketingStrategy ?? {}
  if (hasStrategyCandidate(posterStrategy)) {
    const owner: StrategySourceOwner = poster ?? UNBOUND_OWNER('poster')
    return { raw: posterStrategy, owner }
  }
  return { raw: null, owner: ABSENT_OWNER as StrategySourceOwner }
}

function ownerMatchesPlatform(
  owner: StrategySourceOwner,
  platform: Step6PlatformView,
) {
  if (owner.sourceKind === 'none') return true
  if (owner.sourceKind === 'unbound') return false
  if (owner.sourceKind === 'copy') {
    return platform.sourceKind === 'copy' &&
      platform.id === owner.platform &&
      platform.sourceOwnerSignatureSha256 === sourceOwnerSignature(owner)
  }
  if (
    owner.targetPlatformResolution !== 'known' ||
    !owner.targetPlatform ||
    owner.targetPlatform !== platform.id
  ) return false
  if (platform.sourceKind === 'poster') {
    return platform.sourceOwnerSignatureSha256 === sourceOwnerSignature(owner)
  }
  return platform.sourceKind === 'copy'
}

function currentStepFourAuthority(state: WorkflowState) {
  const editor = state.posterEditor
  const active = editor.active
  const confirmed = editor.confirmedPoster
  const completion = editor.completion
  if (
    !active ||
    !confirmed ||
    !completion ||
    !editor.currentLayoutSha256 ||
    confirmed.generationId !== active.generationId ||
    confirmed.posterId !== active.posterId ||
    confirmed.slot !== active.slot ||
    confirmed.baseBlobSha256 !== active.baseBlobSha256 ||
    confirmed.upstreamSha256 !== active.upstreamSha256 ||
    confirmed.layoutSha256 !== editor.currentLayoutSha256 ||
    confirmed.confirmedRevision !== editor.compositionRevision ||
    completion.generationId !== confirmed.generationId ||
    completion.posterId !== confirmed.posterId ||
    completion.confirmedRevision !== confirmed.confirmedRevision ||
    completion.baseBlobSha256 !== confirmed.baseBlobSha256 ||
    completion.layoutSha256 !== confirmed.layoutSha256 ||
    completion.upstreamSha256 !== confirmed.upstreamSha256 ||
    completion.pngBlobSha256 !== confirmed.pngBlobSha256
  ) return null
  return confirmed
}

export function selectCurrentStep5Authority(state: WorkflowState): Step5AuthoritySnapshot | null {
  const detail = state.detailEditor
  const owner = detail.owner
  const confirmed = detail.confirmedDetails
  const completion = detail.completion
  const stepFour = currentStepFourAuthority(state)
  if (
    !state.completedSteps.has(5) ||
    !owner ||
    !confirmed ||
    !completion ||
    !stepFour ||
    !sameDetailOwner(owner, confirmed.owner) ||
    !sameDetailOwner(owner, completion.owner) ||
    owner.generationId !== stepFour.generationId ||
    owner.posterId !== stepFour.posterId ||
    owner.inputSignatureSha256 !== stepFour.inputSignatureSha256 ||
    owner.pngBlobSha256 !== stepFour.pngBlobSha256 ||
    confirmed.confirmedResourceRevision !== detail.resourceRevision ||
    confirmed.pageExports.length === 0 ||
    confirmed.pageExports.length !== detail.pages.length ||
    confirmed.pageExports.length !== confirmed.pngBlobs.length ||
    confirmed.pageExports.length !== completion.pageCount ||
    confirmed.groupSignatureSha256 !== completion.groupSignatureSha256 ||
    confirmed.firstPngBlob !== confirmed.pageExports[0].pngBlob ||
    confirmed.pageExports.some((item, index) =>
      detail.pages[index].currentExport !== item ||
      confirmed.pngBlobs[index] !== item.pngBlob ||
      completion.pngBlobSha256[index] !== item.pngBlobSha256,
    )
  ) return null
  return {
    owner: { ...owner },
    groupSignatureSha256: confirmed.groupSignatureSha256,
    pageCount: confirmed.pageExports.length,
    pngBlobSha256: confirmed.pageExports.map((item) => item.pngBlobSha256),
  }
}

export function selectStep6ViewModel(state: WorkflowState): Step6ViewModel {
  const step5Authority = selectCurrentStep5Authority(state)
  const poster = posterOwner(state)
  const platform = resolvedPlatform(state, poster)
  const candidate = selectedStrategy(state, poster)
  const normalized = normalizeMarketingStrategy(candidate.raw)
  const ownerSignature = sourceOwnerSignature(candidate.owner)
  const ownerMismatch = !ownerMatchesPlatform(candidate.owner, platform)
  const strategy: Step6StrategyView = ownerMismatch
    ? {
        status: 'owner-mismatch',
        sourceKind: candidate.owner.sourceKind,
        owner: candidate.owner,
        sourceOwnerSignatureSha256: ownerSignature,
        strategySignatureSha256: semanticSignature('strategy', { status: 'owner-mismatch' }),
        blocks: [],
        malformedFields: normalized.malformedFields,
      }
    : {
        status: normalized.status,
        sourceKind: candidate.owner.sourceKind,
        owner: candidate.owner,
        sourceOwnerSignatureSha256: ownerSignature,
        strategySignatureSha256: normalized.signatureSha256,
        blocks: normalized.blocks,
        malformedFields: normalized.malformedFields,
      }
  const signatureInputs = {
    version: MARKETING_STRATEGY_VIEW_VERSION,
    step5Authority,
    platform: {
      id: platform.id,
      sourceKind: platform.sourceKind,
      sourceOwnerSignatureSha256: platform.sourceOwnerSignatureSha256,
    },
    strategy: {
      status: strategy.status,
      sourceKind: strategy.sourceKind,
      sourceOwnerSignatureSha256: strategy.sourceOwnerSignatureSha256,
      strategySignatureSha256: strategy.strategySignatureSha256,
    },
  }
  return {
    validEntry: step5Authority !== null,
    step5Authority,
    platform,
    strategy,
    step6SignatureSha256: semanticSignature('step6', signatureInputs),
  }
}

export function completionFromStep6View(view: Step6ViewModel): Step6Completion | null {
  if (!view.validEntry || !view.step5Authority) return null
  return {
    step5Authority: {
      owner: { ...view.step5Authority.owner },
      groupSignatureSha256: view.step5Authority.groupSignatureSha256,
      pageCount: view.step5Authority.pageCount,
      pngBlobSha256: [...view.step5Authority.pngBlobSha256],
    },
    strategySourceKind: view.strategy.sourceKind,
    strategySourceOwnerSignatureSha256: view.strategy.sourceOwnerSignatureSha256,
    platformId: view.platform.id,
    platformSourceOwnerSignatureSha256: view.platform.sourceOwnerSignatureSha256,
    strategyStatus: view.strategy.status,
    strategySignatureSha256: view.strategy.strategySignatureSha256,
    step6SignatureSha256: view.step6SignatureSha256,
  }
}

export function isCurrentStep6Completion(
  state: WorkflowState,
  completion = state.marketingStrategyStep.completion,
) {
  if (!completion) return false
  const view = selectStep6ViewModel(state)
  return Boolean(
    state.completedSteps.has(6) &&
    view.validEntry &&
    view.step5Authority &&
    completion.step6SignatureSha256 === view.step6SignatureSha256 &&
    completion.step5Authority.groupSignatureSha256 === view.step5Authority.groupSignatureSha256 &&
    sameDetailOwner(completion.step5Authority.owner, view.step5Authority.owner) &&
    completion.step5Authority.pageCount === view.step5Authority.pageCount &&
    completion.step5Authority.pngBlobSha256.length === view.step5Authority.pngBlobSha256.length &&
    completion.step5Authority.pngBlobSha256.every((hash, index) => hash === view.step5Authority?.pngBlobSha256[index]) &&
    completion.strategySourceKind === view.strategy.sourceKind &&
    completion.strategySourceOwnerSignatureSha256 === view.strategy.sourceOwnerSignatureSha256 &&
    completion.platformId === view.platform.id &&
    completion.platformSourceOwnerSignatureSha256 === view.platform.sourceOwnerSignatureSha256 &&
    completion.strategyStatus === view.strategy.status &&
    completion.strategySignatureSha256 === view.strategy.strategySignatureSha256
  )
}

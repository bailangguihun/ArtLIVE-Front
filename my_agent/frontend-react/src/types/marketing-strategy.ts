import type { DetailOwnerIdentity } from './detail-editor'
import type {
  CopyStrategyOwner,
  PlatformId,
} from './platform-copy'

export const MARKETING_STRATEGY_VIEW_VERSION = 'marketing-strategy-view-v1'
export const MISSING_STRATEGY_COPY =
  '暂无策略结果；可返回步骤 2 重新生成文案以刷新策略。'

export type StrategyStatus =
  | 'present'
  | 'absent'
  | 'malformed'
  | 'owner-mismatch'

export interface StrategySummaryBlock {
  kind: 'summary'
  categoryName: string
  confidence: string
  reason: string
}

export interface StrategyKeywordsBlock {
  kind: 'keywords'
  items: string[]
}

export interface StrategyParagraphBlock {
  kind: 'paragraph'
  label: '覆盖范围' | null
  text: string
  emphasis: boolean
}

export interface StrategyListBlock {
  kind: 'list'
  heading: '核心特点' | '建议营销策略'
  ordered: boolean
  items: string[]
}

export type StrategyDisplayBlock =
  | StrategySummaryBlock
  | StrategyKeywordsBlock
  | StrategyParagraphBlock
  | StrategyListBlock

export interface PosterStrategyOwner {
  sourceKind: 'poster'
  generationId: string
  requestId: string | null
  intentFingerprint: string | null
  targetPlatform: PlatformId | null
  targetPlatformResolution: 'known' | 'legacy-defaulted-unknown' | 'missing'
}

export interface AbsentStrategyOwner {
  sourceKind: 'none'
}

export interface UnboundStrategyOwner {
  sourceKind: 'unbound'
  candidateSourceKind: 'copy' | 'poster'
}

export type StrategySourceOwner =
  | CopyStrategyOwner
  | PosterStrategyOwner
  | AbsentStrategyOwner
  | UnboundStrategyOwner

export interface Step5AuthoritySnapshot {
  owner: DetailOwnerIdentity
  groupSignatureSha256: string
  pageCount: number
  pngBlobSha256: string[]
}

export interface Step6PlatformView {
  id: PlatformId
  label: string
  sourceKind: 'copy' | 'poster' | 'current' | 'legacy-defaulted-unknown'
  sourceOwnerSignatureSha256: string
}

export interface Step6StrategyView {
  status: StrategyStatus
  sourceKind: StrategySourceOwner['sourceKind']
  owner: StrategySourceOwner
  sourceOwnerSignatureSha256: string
  strategySignatureSha256: string
  blocks: StrategyDisplayBlock[]
  malformedFields: string[]
}

export interface Step6ViewModel {
  validEntry: boolean
  step5Authority: Step5AuthoritySnapshot | null
  platform: Step6PlatformView
  strategy: Step6StrategyView
  step6SignatureSha256: string
}

export interface Step6Completion {
  step5Authority: Step5AuthoritySnapshot
  strategySourceKind: StrategySourceOwner['sourceKind']
  strategySourceOwnerSignatureSha256: string
  platformId: PlatformId
  platformSourceOwnerSignatureSha256: string
  strategyStatus: StrategyStatus
  strategySignatureSha256: string
  step6SignatureSha256: string
}

export interface MarketingStrategyStepState {
  completion: Step6Completion | null
}

export function createInitialMarketingStrategyStepState(): MarketingStrategyStepState {
  return { completion: null }
}

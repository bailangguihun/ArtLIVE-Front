export const PLATFORM_OPTIONS = [
  { id: 'xiaohongshu', label: '小红书' },
  { id: 'douyin', label: '抖音' },
  { id: 'taobao', label: '淘宝' },
  { id: 'pinduoduo', label: '拼多多' },
] as const

export const COPY_STYLE_OPTIONS = [
  { id: 'premium', label: '高级质感' },
  { id: 'vibrant', label: '爆款吸睛' },
] as const

export type PlatformId = (typeof PLATFORM_OPTIONS)[number]['id']
export type CopyStyleId = (typeof COPY_STYLE_OPTIONS)[number]['id']

export function isPlatformId(value: string): value is PlatformId {
  return PLATFORM_OPTIONS.some((option) => option.id === value)
}

export function isCopyStyleId(value: string): value is CopyStyleId {
  return COPY_STYLE_OPTIONS.some((option) => option.id === value)
}

export type CopyVariant = {
  body: string
  title?: string
  headline?: string
  subline?: string
  [key: string]: unknown
}

export type MarketingStrategy = Record<string, unknown>

/** The server recomputes and verifies this narrow reference before copy work. */
export interface MarketingAdviceReference {
  advice_version: 'catalog-v1'
  input_signature_sha256: string
  advice_signature_sha256: string
}

export interface CopyStrategyOwner {
  sourceKind: 'copy'
  intentFingerprint: string
  idempotencyKey: string
  requestId: string | null
  platform: PlatformId
  style: CopyStyleId
}

export interface CopyOnlyPayload {
  product_info: string
  product_short_name: string
  creative_note: string
  visual_style: CopyStyleId
  target_platform: PlatformId
  generate_poster: false
  background_mode: 'procedural'
  output_size: '768x1024'
  product_type: 'bag_heavy'
  generation_mode: 'legacy_background_composite'
  send_product_to_provider: false
  requested_poster_count: 1
  text_rendering_mode: 'local'
  copy_variant_count: 3
  marketing_advice_ref?: MarketingAdviceReference
}

export interface NormalizedCopyResponse {
  variants: CopyVariant[]
  marketingStrategy: MarketingStrategy
  requestId: string | null
}

export interface PlatformCopyCompletedDraft {
  platform: PlatformId
  style: CopyStyleId
  copyDraft: string
  platformCopy: CopyVariant
  variants: CopyVariant[]
  selectedVariantIndex: number
  generationPlatform: PlatformId
  generationStyle: CopyStyleId
  marketingStrategy: MarketingStrategy
  strategyOwner: CopyStrategyOwner
}

export interface PlatformCopyState {
  platform: PlatformId
  style: CopyStyleId
  copyDraft: string
  platformCopy: CopyVariant | null
  variants: CopyVariant[]
  selectedVariantIndex: number | null
  generationPlatform: PlatformId | null
  generationStyle: CopyStyleId | null
  marketingStrategy: MarketingStrategy
  strategyOwner: CopyStrategyOwner | null
  copyGenerationError: string
  requestBusy: boolean
  pendingCopyFingerprint: string | null
  pendingIdempotencyKey: string | null
  completedDraft: PlatformCopyCompletedDraft | null
}

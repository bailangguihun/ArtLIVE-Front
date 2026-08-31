import {
  isPlatformId,
  type CopyVariant,
  type MarketingStrategy,
  type PlatformId,
} from '../../types/platform-copy'
import {
  POSTER_SEQUENCE_MODE,
  type KnownOverallStatus,
  type KnownPosterSlotStatus,
  type NormalizedOverallStatus,
  type NormalizedPosterSlot,
  type NormalizedPosterSlotStatus,
  type NormalizedSequenceResult,
} from '../../types/poster-generation'

export const INVALID_SEQUENCE_RESPONSE_MESSAGE =
  '海报生成响应无效，请重试。'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SAFE_STATUS_PATTERN = /^[a-z0-9_-]{1,64}$/i
const SAFE_CODE_PATTERN = /^[a-z0-9._:-]{1,128}$/i
const KNOWN_OVERALL = new Set<KnownOverallStatus>([
  'queued',
  'running',
  'completed',
  'failed',
  'partial_failed',
  'interrupted',
])
const KNOWN_SLOT = new Set<KnownPosterSlotStatus>([
  'waiting',
  'generating',
  'ready',
  'failed',
  'blocked',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function normalizeStrategy(value: unknown): MarketingStrategy {
  return isRecord(value) ? { ...value } : {}
}

function normalizeTargetPlatform(value: unknown): {
  targetPlatform: PlatformId | null
  targetPlatformResolution: 'known' | 'legacy-defaulted-unknown' | 'missing'
} {
  if (typeof value !== 'string' || !value.trim()) {
    return { targetPlatform: null, targetPlatformResolution: 'missing' }
  }
  const candidate = value.trim().toLowerCase()
  if (isPlatformId(candidate)) {
    return { targetPlatform: candidate, targetPlatformResolution: 'known' }
  }
  return {
    targetPlatform: 'xiaohongshu',
    targetPlatformResolution: 'legacy-defaulted-unknown',
  }
}

export function isValidUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value)
}

function safeStatus(value: unknown): string {
  if (typeof value !== 'string') {
    return 'unknown'
  }
  const normalized = value.trim().toLowerCase()
  return SAFE_STATUS_PATTERN.test(normalized) ? normalized : 'unknown'
}

export function safeErrorCode(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const normalized = value.trim()
  return SAFE_CODE_PATTERN.test(normalized) ? normalized : null
}

function safeShortText(value: unknown, maximum = 160): string {
  if (typeof value !== 'string') {
    return ''
  }
  const normalized = value.trim()
  return normalized.length <= maximum && !/[\r\n]/.test(normalized)
    ? normalized
    : ''
}

function optionalInteger(
  value: unknown,
  minimum: number,
  maximum: number,
): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return null
  }
  return Math.min(maximum, Math.max(minimum, value))
}

function positiveInteger(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    return null
  }
  return value
}

export function safeRelativeApiUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.startsWith('/api/v1/')) {
    return null
  }
  if (value.startsWith('//') || /[\\\r\n]/.test(value)) {
    return null
  }

  try {
    const origin = globalThis.location?.origin || 'http://localhost'
    const resolved = new URL(value, origin)
    if (
      resolved.origin !== origin ||
      !resolved.pathname.startsWith('/api/v1/') ||
      resolved.username ||
      resolved.password ||
      resolved.hash
    ) {
      return null
    }
    return `${resolved.pathname}${resolved.search}`
  } catch {
    return null
  }
}

function normalizeCopy(value: unknown): CopyVariant | null {
  if (!isRecord(value)) {
    return null
  }
  const fields = ['body', 'title', 'headline', 'subline'] as const
  if (fields.some((field) => typeof value[field] !== 'string')) {
    return null
  }
  return {
    body: value.body as string,
    title: value.title as string,
    headline: value.headline as string,
    subline: value.subline as string,
  }
}

function missingSlot(displayIndex: 1 | 2 | 3): NormalizedPosterSlot {
  return {
    displayIndex,
    sourceIndex: null,
    concept: '',
    status: 'missing',
    rawStatus: 'missing',
    providerAttemptCount: 0,
    posterId: null,
    width: null,
    height: null,
    previewUrl: null,
    downloadUrl: null,
    safeErrorCode: null,
  }
}

function normalizeSlot(
  value: unknown,
  displayIndex: 1 | 2 | 3,
): NormalizedPosterSlot {
  if (!isRecord(value)) {
    return missingSlot(displayIndex)
  }

  const rawStatus = safeStatus(value.status)
  let status: NormalizedPosterSlotStatus = KNOWN_SLOT.has(
    rawStatus as KnownPosterSlotStatus,
  )
    ? (rawStatus as KnownPosterSlotStatus)
    : 'unknown'
  const posterId = isValidUuid(value.poster_id) ? value.poster_id : null
  if (status === 'ready' && !posterId) {
    status = 'unknown'
  }
  const ready = status === 'ready' && posterId !== null

  return {
    displayIndex,
    sourceIndex: optionalInteger(value.index, 1, 3),
    concept: safeShortText(value.concept),
    status,
    rawStatus,
    providerAttemptCount:
      optionalInteger(value.provider_attempt_count, 0, 3) ?? 0,
    posterId,
    width: positiveInteger(value.width),
    height: positiveInteger(value.height),
    previewUrl: ready ? safeRelativeApiUrl(value.preview_url) : null,
    downloadUrl: ready ? safeRelativeApiUrl(value.download_url) : null,
    safeErrorCode: safeErrorCode(value.safe_error_code),
  }
}

export function normalizeSequenceResult(
  value: unknown,
): NormalizedSequenceResult {
  if (!isRecord(value)) {
    throw new Error(INVALID_SEQUENCE_RESPONSE_MESSAGE)
  }
  if (
    value.generation_mode !== POSTER_SEQUENCE_MODE ||
    !isValidUuid(value.generation_id) ||
    !Array.isArray(value.posters)
  ) {
    throw new Error(INVALID_SEQUENCE_RESPONSE_MESSAGE)
  }
  const rawPosters = value.posters
  const marketingCopy = normalizeCopy(value.marketing_copy)
  if (!marketingCopy) {
    throw new Error(INVALID_SEQUENCE_RESPONSE_MESSAGE)
  }

  const rawStatus = safeStatus(value.status)
  const status: NormalizedOverallStatus = KNOWN_OVERALL.has(
    rawStatus as KnownOverallStatus,
  )
    ? (rawStatus as KnownOverallStatus)
    : 'unknown'
  const posters = ([0, 1, 2] as const).map((index) =>
    normalizeSlot(rawPosters[index], (index + 1) as 1 | 2 | 3),
  )
  const readyCount = posters.filter((slot) => slot.status === 'ready').length
  const qa = isRecord(value.qa) ? value.qa : {}
  const target = normalizeTargetPlatform(value.target_platform)

  return {
    apiVersion: safeShortText(value.api_version, 32),
    requestId: isValidUuid(value.request_id) ? value.request_id : null,
    generationId: value.generation_id,
    status,
    rawStatus,
    generationMode: POSTER_SEQUENCE_MODE,
    marketingCopy,
    marketingStrategy: normalizeStrategy(value.marketing_strategy),
    ...target,
    posters,
    zipDownloadUrl:
      status === 'completed'
        ? safeRelativeApiUrl(value.zip_download_url)
        : null,
    completedPosterCount: readyCount,
    currentPosterIndex: optionalInteger(value.current_poster_index, 1, 3),
    safeErrorCode: safeErrorCode(qa.safe_error_code),
  }
}

export function isTerminalSequenceStatus(status: NormalizedOverallStatus) {
  return (
    status === 'completed' ||
    status === 'failed' ||
    status === 'partial_failed' ||
    status === 'interrupted'
  )
}

export function isEligibleReadySlot(
  slot: NormalizedPosterSlot | null | undefined,
): slot is NormalizedPosterSlot & { posterId: string } {
  return Boolean(slot && slot.status === 'ready' && slot.posterId)
}

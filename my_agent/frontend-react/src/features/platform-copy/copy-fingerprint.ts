import type {
  CopyOnlyPayload,
  MarketingAdviceReference,
} from '../../types/platform-copy'
import type { ProductInfoValues } from '../../types/product-info'
import { normalizeMarketingAdviceInput } from '../../state/workflow-v2/workflow-v2-canonical'
import type {
  CopyStyleId,
  PlatformId,
} from '../../types/platform-copy'

function toCanonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(toCanonicalValue)
  }

  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value).sort(([left], [right]) => {
      if (left === right) {
        return 0
      }
      return left < right ? -1 : 1
    })
    return Object.fromEntries(
      entries.map(([key, entryValue]) => [key, toCanonicalValue(entryValue)]),
    )
  }

  return value
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(toCanonicalValue(value))
}

export function buildCopyOnlyPayload(
  values: ProductInfoValues,
  platform: PlatformId,
  style: CopyStyleId,
  marketingAdviceRef?: MarketingAdviceReference,
): CopyOnlyPayload {
  const normalized = normalizeMarketingAdviceInput(values)
  const payload: CopyOnlyPayload = {
    product_info: normalized.productInfo,
    product_short_name: normalized.productShortName,
    creative_note: normalized.creativeNote,
    visual_style: style,
    target_platform: platform,
    generate_poster: false,
    background_mode: 'procedural',
    output_size: '768x1024',
    product_type: 'bag_heavy',
    generation_mode: 'legacy_background_composite',
    send_product_to_provider: false,
    requested_poster_count: 1,
    text_rendering_mode: 'local',
    copy_variant_count: 3,
  }
  if (marketingAdviceRef) {
    payload.marketing_advice_ref = { ...marketingAdviceRef }
  }
  return payload
}

export async function copyIntentFingerprint(
  canonicalPayload: string,
): Promise<string> {
  const bytes = new TextEncoder().encode(`copy-only|${canonicalPayload}`)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
}

interface PendingCopyIntent {
  pendingCopyFingerprint: string | null
  pendingIdempotencyKey: string | null
}

export function acquirePendingCopyIntent(
  pending: PendingCopyIntent,
  fingerprint: string,
  keyFactory: () => string,
) {
  if (
    pending.pendingCopyFingerprint === fingerprint &&
    pending.pendingIdempotencyKey
  ) {
    return {
      fingerprint,
      idempotencyKey: pending.pendingIdempotencyKey,
    }
  }

  const idempotencyKey = keyFactory().trim()
  if (!idempotencyKey) {
    throw new Error('Unable to create an idempotency key.')
  }

  return { fingerprint, idempotencyKey }
}

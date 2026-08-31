import type { SequencePayload } from '../../types/poster-generation'

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalValue)
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalValue(item)]),
    )
  }
  return value
}

export function canonicalSequenceJson(payload: SequencePayload): string {
  return JSON.stringify(canonicalValue(payload))
}

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
}

export async function sequenceIntentFingerprint(
  canonicalPayload: string,
  productImageBytes: ArrayBuffer,
): Promise<string> {
  const productDigest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    productImageBytes,
  )
  const emptyDigest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new Uint8Array(),
  )
  const payloadBytes = new TextEncoder().encode(canonicalPayload)
  const combined = new Uint8Array(
    payloadBytes.byteLength + productDigest.byteLength + emptyDigest.byteLength,
  )
  combined.set(payloadBytes, 0)
  combined.set(new Uint8Array(productDigest), payloadBytes.byteLength)
  combined.set(
    new Uint8Array(emptyDigest),
    payloadBytes.byteLength + productDigest.byteLength,
  )
  return hex(await globalThis.crypto.subtle.digest('SHA-256', combined))
}

interface PendingSequenceIntent {
  pendingFingerprint: string | null
  pendingIdempotencyKey: string | null
}

export function acquirePendingSequenceIntent(
  pending: PendingSequenceIntent,
  fingerprint: string,
  keyFactory: () => string,
) {
  if (
    pending.pendingFingerprint === fingerprint &&
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

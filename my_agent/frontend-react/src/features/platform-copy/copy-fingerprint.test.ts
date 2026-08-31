import { describe, expect, it, vi } from 'vitest'
import {
  acquirePendingCopyIntent,
  buildCopyOnlyPayload,
  canonicalJson,
  copyIntentFingerprint,
} from './copy-fingerprint'

describe('copy request fingerprinting', () => {
  it('orders object keys recursively while preserving array order', () => {
    expect(
      canonicalJson({ z: 1, nested: { y: 2, a: 3 }, list: [{ b: 4, a: 5 }] }),
    ).toBe('{"list":[{"a":5,"b":4}],"nested":{"a":3,"y":2},"z":1}')
  })

  it('builds the exact active copy-only payload', () => {
    expect(
      buildCopyOnlyPayload(
        {
          productInfo: '  咖啡豆  ',
          productShortName: '晨光咖啡',
          creativeNote: '克制高级',
        },
        'taobao',
        'premium',
      ),
    ).toEqual({
      product_info: '咖啡豆',
      product_short_name: '晨光咖啡',
      creative_note: '克制高级',
      visual_style: 'premium',
      target_platform: 'taobao',
      generate_poster: false,
      background_mode: 'procedural',
      output_size: '768x1024',
      product_type: 'bag_heavy',
      generation_mode: 'legacy_background_composite',
      send_product_to_provider: false,
      requested_poster_count: 1,
      text_rendering_mode: 'local',
      copy_variant_count: 3,
    })
  })

  it('creates a SHA-256 fingerprint for the copy-only canonical payload', async () => {
    const fingerprint = await copyIntentFingerprint('{"a":1}')
    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/)
    expect(await copyIntentFingerprint('{"a":1}')).toBe(fingerprint)
  })

  it('reuses the same pending key and replaces it when intent changes', () => {
    const keyFactory = vi
      .fn<() => string>()
      .mockReturnValueOnce('key-one')
      .mockReturnValueOnce('key-two')

    const first = acquirePendingCopyIntent(
      { pendingCopyFingerprint: null, pendingIdempotencyKey: null },
      'fingerprint-one',
      keyFactory,
    )
    const reused = acquirePendingCopyIntent(
      {
        pendingCopyFingerprint: first.fingerprint,
        pendingIdempotencyKey: first.idempotencyKey,
      },
      'fingerprint-one',
      keyFactory,
    )
    const changed = acquirePendingCopyIntent(
      {
        pendingCopyFingerprint: first.fingerprint,
        pendingIdempotencyKey: first.idempotencyKey,
      },
      'fingerprint-two',
      keyFactory,
    )

    expect(reused.idempotencyKey).toBe('key-one')
    expect(changed.idempotencyKey).toBe('key-two')
    expect(keyFactory).toHaveBeenCalledTimes(2)
  })
})

import { describe, expect, it } from 'vitest'
import { removeDetailNearWhitePixels } from './detail-white-removal'

describe('Step 5 near-white alpha transform', () => {
  it('implements the exact >=248, 225–247 and <225 bands without changing RGB', () => {
    const pixels = new Uint8ClampedArray([
      248, 250, 255, 200,
      247, 247, 247, 230,
      225, 230, 240, 230,
      224, 255, 255, 199,
    ])
    const rgb = [pixels[0], pixels[1], pixels[2], pixels[4], pixels[5], pixels[6], pixels[8], pixels[9], pixels[10], pixels[12], pixels[13], pixels[14]]
    removeDetailNearWhitePixels(pixels, 4, 1)
    expect([pixels[3], pixels[7], pixels[11], pixels[15]]).toEqual([0, 10, 230, 199])
    expect([pixels[0], pixels[1], pixels[2], pixels[4], pixels[5], pixels[6], pixels[8], pixels[9], pixels[10], pixels[12], pixels[13], pixels[14]]).toEqual(rgb)
  })

  it('returns the alpha-channel nonzero bounding box only', () => {
    const pixels = new Uint8ClampedArray(4 * 4 * 4)
    const set = (x: number, y: number, value: number, alpha = 255) => {
      const offset = (y * 4 + x) * 4
      pixels.set([value, value, value, alpha], offset)
    }
    set(1, 1, 10)
    set(3, 2, 20)
    set(0, 3, 255)
    expect(removeDetailNearWhitePixels(pixels, 4, 4)).toEqual({ left: 1, top: 1, right: 3, bottom: 2 })
  })

  it('returns null for fully transparent output so callers preserve source dimensions', () => {
    const pixels = new Uint8ClampedArray([255, 255, 255, 255, 248, 249, 250, 180])
    expect(removeDetailNearWhitePixels(pixels, 2, 1)).toBeNull()
    expect([pixels[3], pixels[7]]).toEqual([0, 0])
  })
})

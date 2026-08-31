import { describe, expect, it } from 'vitest'
import type { PosterTextBox } from '../../types/poster-editor'
import {
  calculatePosterTextLayout,
  expandPreviewHitBounds,
  nativeBoundsToPreviewBounds,
  placePreviewSelectionBadge,
  splitPosterTextLines,
} from './poster-text-layout'
import { posterFontFamily } from './poster-fonts'

const native = { width: 768, height: 1024 }
const preview = { width: 352, height: 528 }

function box(overrides: Partial<PosterTextBox> = {}): PosterTextBox {
  return {
    id: 'title',
    role: 'title',
    text: '通勤新主张',
    fontId: null,
    fontSize: 64,
    color: '#FFFFFF',
    align: 'center',
    strokeEnabled: false,
    strokeWidth: 2,
    strokeColor: '#000000',
    showBox: false,
    x: 0.5,
    y: 0.2,
    ...overrides,
  }
}

function measureText(text: string, font: string) {
  const size = Number.parseInt(font.match(/(\d+)px/)?.[1] ?? '0', 10)
  return {
    width: text.length * size * 0.52,
    actualBoundingBoxAscent: size * 0.76,
    actualBoundingBoxDescent: size * 0.24,
  }
}

function layout(overrides: Partial<PosterTextBox> = {}) {
  return calculatePosterTextLayout({
    box: box(overrides),
    defaultFontId: 'lxgw_wenkai',
    nativeWidth: native.width,
    nativeHeight: native.height,
    measureText,
  })
}

function overlap(a: { left: number; top: number; width: number; height: number }, b: { left: number; top: number; width: number; height: number }) {
  return Math.max(0, Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left)) *
    Math.max(0, Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top))
}

describe('canonical poster text layout', () => {
  it('uses the resolved default font and supports a per-box font override', () => {
    expect(layout().font).toContain(posterFontFamily('lxgw_wenkai'))
    expect(layout({ fontId: 'msyh' }).font).toContain(posterFontFamily('msyh'))
  })

  it('preserves one-line Chinese and explicit multiline Chinese line layouts', () => {
    const single = layout({ text: '通勤新主张' })
    const multiline = layout({ text: '通勤\n新主张\n现在出发' })
    expect(single.lines).toHaveLength(1)
    expect(multiline.lines).toHaveLength(3)
    expect(multiline.lines.map((line) => line.drawY)).toEqual([
      multiline.drawY,
      multiline.drawY + multiline.lineHeight,
      multiline.drawY + multiline.lineHeight * 2,
    ])
    expect(multiline.selectionBounds.height).toBeGreaterThan(single.selectionBounds.height)
  })

  it('measures mixed-language content without character-count geometry', () => {
    const mixed = layout({ text: '通勤 GO 2026!' })
    expect(mixed.textBounds.width).toBeCloseTo(measureText('通勤 GO 2026!', mixed.font).width, 4)
    expect(splitPosterTextLines('  A\r\nB  ')).toEqual(['A', 'B'])
  })

  it.each(['left', 'center', 'right'] as const)('keeps the %s alignment anchor canonical', (align) => {
    const result = calculatePosterTextLayout({
      box: { ...box({ align: 'left' }), align } as Parameters<typeof calculatePosterTextLayout>[0]['box'],
      defaultFontId: 'lxgw_wenkai',
      nativeWidth: native.width,
      nativeHeight: native.height,
      measureText,
    })
    const expectedLeft = align === 'left'
      ? result.drawX
      : align === 'right'
        ? result.drawX - result.textBounds.width
        : result.drawX - result.textBounds.width / 2
    expect(result.textBounds.left).toBeCloseTo(expectedLeft, 4)
  })

  it('includes font size, outline, and background-box expansion in the selectable visual bounds', () => {
    const plain = layout({ fontSize: 48, strokeEnabled: false, showBox: false })
    const outlined = layout({ fontSize: 72, strokeEnabled: true, strokeWidth: 8, showBox: false })
    const boxed = layout({ fontSize: 48, strokeEnabled: false, showBox: true })
    expect(outlined.textBounds.width).toBeGreaterThan(plain.textBounds.width)
    expect(boxed.backgroundBounds).not.toBeNull()
    expect(boxed.selectionBounds.width).toBeGreaterThan(boxed.textBounds.width)
    expect(boxed.selectionBounds.height).toBeGreaterThan(boxed.textBounds.height)
  })

  it('clamps canonical bounds at each native poster edge without non-finite coordinates', () => {
    const edgeLayouts = [
      layout({ x: 0, y: 0, align: 'left' }),
      layout({ x: 1, y: 0, align: 'right' as never }),
      layout({ x: 0, y: 1, align: 'left' }),
      layout({ x: 1, y: 1, align: 'right' as never }),
    ]
    for (const result of edgeLayouts) {
      expect(result.selectionBounds.left).toBeGreaterThanOrEqual(0)
      expect(result.selectionBounds.top).toBeGreaterThanOrEqual(0)
      expect(result.selectionBounds.left + result.selectionBounds.width).toBeLessThanOrEqual(native.width)
      expect(result.selectionBounds.top + result.selectionBounds.height).toBeLessThanOrEqual(native.height)
      expect(Object.values(result.selectionBounds).every(Number.isFinite)).toBe(true)
    }
  })

  it('provides a predictable nonzero selection rectangle for empty and whitespace-only text without rendering a line', () => {
    for (const text of ['', '   \n  ']) {
      const result = layout({ text })
      expect(result.hasRenderableText).toBe(false)
      expect(result.lines).toEqual([])
      expect(result.selectionBounds.width).toBeGreaterThan(0)
      expect(result.selectionBounds.height).toBeGreaterThan(0)
      expect(Object.values(result.selectionBounds).every(Number.isFinite)).toBe(true)
    }
  })

  it('maps one native layout to differently scaled previews without changing its visual geometry', () => {
    const result = layout({ text: '短字', fontSize: 24 })
    const small = nativeBoundsToPreviewBounds(result.selectionBounds, native.width, native.height, { width: 240, height: 360 })
    const large = nativeBoundsToPreviewBounds(result.selectionBounds, native.width, native.height, preview)
    expect(large.width / small.width).toBeCloseTo(352 / 240, 4)
    expect(large.height / small.height).toBeCloseTo(528 / 360, 4)
    expect(expandPreviewHitBounds(large, preview).width).toBeGreaterThanOrEqual(44)
    expect(expandPreviewHitBounds(large, preview).height).toBeGreaterThanOrEqual(44)
    expect(large.width).not.toBe(expandPreviewHitBounds(large, preview).width)
  })

  it('places the badge outside the visual bounds, below at the top edge, and clamps horizontally', () => {
    const top = { left: 4, top: 0, width: 20, height: 18 }
    const topBadge = placePreviewSelectionBadge(top, preview)
    const topRect = { left: topBadge.left, top: topBadge.top, width: 36, height: 17 }
    expect(topBadge.placement).toBe('below')
    expect(overlap(top, topRect)).toBe(0)

    const bottom = { left: 340, top: 500, width: 12, height: 20 }
    const bottomBadge = placePreviewSelectionBadge(bottom, preview)
    const bottomRect = { left: bottomBadge.left, top: bottomBadge.top, width: 36, height: 17 }
    expect(bottomBadge.placement).toBe('above')
    expect(bottomBadge.left + 36).toBeLessThanOrEqual(preview.width)
    expect(overlap(bottom, bottomRect)).toBe(0)
  })
})

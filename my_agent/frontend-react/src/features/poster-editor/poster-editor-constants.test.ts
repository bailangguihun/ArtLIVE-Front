import { describe, expect, it } from 'vitest'
import type { CopyVariant } from '../../types/platform-copy'
import type { CompletePosterLayout } from '../../types/poster-editor'
import {
  createCustomTextBox,
  createDefaultPosterLayout,
  createDefaultShape,
  PLATFORM_POSTER_PRESETS,
  resolvedPlatformFontId,
  SHAPE_ADD_OPTIONS,
} from './poster-defaults'
import {
  AVAILABLE_POSTER_FONTS,
  FIRST_AVAILABLE_FONT_ID,
  resolveAvailableFontId,
} from './poster-fonts'
import {
  canonicalJson,
  completeInputSignatureSha256,
  layoutSha256,
  normalizeCompletePosterLayout,
  normalizePosterImage,
  normalizeShape,
} from './poster-signature'
import { acceptedRasterFile } from './poster-resources'
import { removeNearWhitePixels } from './white-removal'

const copy: CopyVariant = {
  body: '正文',
  title: '标题',
  headline: '主卖点',
  subline: '补充句',
}

describe('source-extracted Step 4 constants', () => {
  it.each([
    ['xiaohongshu', 'lxgw_wenkai', 'left', [64, 36, 28], ['#333333', '#FF2442', '#333333'], [[0.08, 0.08], [0.08, 0.15], [0.08, 0.21]]],
    ['douyin', FIRST_AVAILABLE_FONT_ID, 'center', [70, 40, 30], ['#FFFFFF', '#FE2C55', '#FFFFFF'], [[0.5, 0.78], [0.5, 0.85], [0.5, 0.91]]],
    ['taobao', FIRST_AVAILABLE_FONT_ID, 'left', [60, 36, 28], ['#111111', '#FF5000', '#111111'], [[0.08, 0.08], [0.08, 0.15], [0.08, 0.21]]],
    ['pinduoduo', 'zcool_qingke', 'center', [72, 42, 30], ['#E02E24', '#E02E24', '#E02E24'], [[0.5, 0.08], [0.5, 0.15], [0.5, 0.21]]],
  ] as const)(
    'applies the exact %s platform preset',
    (platform, fontId, align, sizes, colors, positions) => {
      const layout = createDefaultPosterLayout(platform, copy)
      expect(layout.fontId).toBe(fontId)
      expect(layout.textBoxes.map((box) => box.fontSize)).toEqual([...sizes])
      expect(layout.textBoxes.map((box) => box.color)).toEqual([...colors])
      expect(layout.textBoxes.map((box) => box.align)).toEqual([align, align, align])
      expect(layout.textBoxes.map((box) => [box.x, box.y])).toEqual(positions.map((pair) => [...pair]))
      expect(layout.textBoxes.every((box) => box.showBox === false)).toBe(true)
    },
  )

  it('records source preferences and deterministic local fallback without fabricating unavailable fonts', () => {
    expect(PLATFORM_POSTER_PRESETS.douyin.preferredFontId).toBe('msyhbd')
    expect(PLATFORM_POSTER_PRESETS.taobao.preferredFontId).toBe('noto_sans_sc')
    expect(resolvedPlatformFontId('douyin')).toBe(FIRST_AVAILABLE_FONT_ID)
    expect(resolvedPlatformFontId('taobao')).toBe(FIRST_AVAILABLE_FONT_ID)
    expect(resolveAvailableFontId('not-bundled')).toBe(FIRST_AVAILABLE_FONT_ID)
  })

  it('preserves the exact bundled font ID/label order', () => {
    expect(AVAILABLE_POSTER_FONTS.map(({ id, label }) => [id, label])).toEqual([
      ['lxgw_wenkai', '霞鹜文楷'],
      ['zcool_xiaowei', '站酷小薇'],
      ['zcool_qingke', '站酷庆科黄油体'],
      ['ma_shan_zheng', '马善政毛笔楷书'],
      ['zhi_mang_xing', '志莽行书'],
      ['long_cang', '龙藏体'],
      ['open_sans', 'Open Sans'],
      ['montserrat', 'Montserrat'],
      ['playfair', 'Playfair Display'],
      ['oswald', 'Oswald'],
      ['merriweather', 'Merriweather'],
    ])
  })

  it('uses exact AI role sources and blank fallback material in the default draft', () => {
    const layout = createDefaultPosterLayout('xiaohongshu', {
      body: '正文不会替代角色字段',
      title: '  保留空格  ',
      headline: undefined,
      subline: '',
    })
    expect(layout.textBoxes.map((box) => box.text)).toEqual(['  保留空格  ', '', ''])
  })

  it('uses protected roles plus source custom text defaults', () => {
    const custom = createCustomTextBox(7)
    expect(custom.role).toBe('custom-7')
    expect(custom).toMatchObject({ fontSize: 36, color: '#FFFFFF', align: 'center', x: 0.5, showBox: false })
  })

  it('preserves exact shape order, defaults, and zero rotation', () => {
    expect(SHAPE_ADD_OPTIONS.map((item) => item.type)).toEqual(['rect', 'ellipse', 'line', 'star', 'diamond'])
    for (const type of SHAPE_ADD_OPTIONS.map((item) => item.type)) {
      const shape = createDefaultShape(type, `shape-${type}`)
      expect(shape.rotation).toBe(0)
      if (type === 'line') {
        expect(shape).toMatchObject({ x: 0.25, y: 0.5, w: 0.5, h: 0, fillOpacity: 0, stroke: '#111111', strokeWidth: 4, strokeOpacity: 1 })
      } else {
        expect(shape).toMatchObject({ x: 0.3, y: 0.4, w: 0.4, h: 0.18, fill: '#FFFFFF', fillOpacity: 0.35, stroke: '#111111', strokeWidth: 3, strokeOpacity: 1 })
      }
    }
  })
})

describe('canonical layout normalization and signatures', () => {
  const base = createDefaultPosterLayout('xiaohongshu', copy)

  it('normalizes finite values, -0, ranges, left/center only, and max text length', () => {
    const layout = normalizeCompletePosterLayout({
      ...base,
      textBoxes: [{ ...base.textBoxes[0], text: 'x'.repeat(80), x: Number.NaN, y: -0, fontSize: 999, align: 'right' as 'left' }],
    })
    expect(layout.textBoxes[0]).toMatchObject({ text: 'x'.repeat(60), x: 0.5, y: 0, fontSize: 160, align: 'center' })
    expect(Object.is(layout.textBoxes[0].y, -0)).toBe(false)
  })

  it('clamps boxes fully on canvas and maps line endpoints independently', () => {
    const rect = normalizeShape({ ...createDefaultShape('rect', 'r'), x: 0.9, y: 0.95, w: 0.5, h: 0.4 }, 0)
    expect(rect).toMatchObject({ x: 0.5, y: 0.6, w: 0.5, h: 0.4 })
    const line = normalizeShape({ ...createDefaultShape('line', 'l'), x: 0.8, y: 0.2, w: 0.7, h: -0.5 }, 0)
    expect(line).toMatchObject({ x: 0.8, y: 0.2, fillOpacity: 0, rotation: 0 })
    expect(line.w).toBeCloseTo(0.2)
    expect(line.h).toBeCloseTo(-0.2)
  })

  it('enforces image minima and full-canvas placement', () => {
    const image = normalizePosterImage({ id: 'i', name: 'safe.png', x: 0.99, y: 0.99, w: 0.001, h: 2, blobId: 'b', sha256: 's' }, 0)
    expect(image).toMatchObject({ x: 0.96, y: 0, w: 0.04, h: 1 })
  })

  it('canonical JSON is deterministic across object key order and normalizes -0/non-finite', () => {
    expect(canonicalJson({ b: -0, a: { z: Number.NaN, y: 2 } })).toBe(canonicalJson({ a: { y: 2, z: Infinity }, b: 0 }))
    expect(canonicalJson({ b: 0, a: 1 })).toBe('{"a":1,"b":0}')
  })

  it('array order affects the layout digest while UI-only values are absent', async () => {
    const withShapes: CompletePosterLayout = {
      ...base,
      shapes: [createDefaultShape('rect', 'first'), createDefaultShape('ellipse', 'second')],
    }
    const reversed = { ...withShapes, shapes: [...withShapes.shapes].reverse() }
    expect(await layoutSha256(withShapes)).not.toBe(await layoutSha256(reversed))
    expect(canonicalJson(withShapes)).not.toContain('selectedShapeId')
  })

  it('base, overlays, and upstream identity all affect the complete signature', async () => {
    const common = { generationId: 'g', posterId: 'p', slot: 1, baseBlobSha256: 'base-a', layoutSha256: 'layout', upstreamSha256: 'upstream-a', overlayBlobSha256: ['overlay-a'] }
    const signature = await completeInputSignatureSha256(common)
    await expect(completeInputSignatureSha256({ ...common, baseBlobSha256: 'base-b' })).resolves.not.toBe(signature)
    await expect(completeInputSignatureSha256({ ...common, upstreamSha256: 'upstream-b' })).resolves.not.toBe(signature)
    await expect(completeInputSignatureSha256({ ...common, overlayBlobSha256: ['overlay-b'] })).resolves.not.toBe(signature)
  })
})

describe('raster validation and exact near-white removal', () => {
  it.each([
    ['logo.png', 'image/png', true],
    ['logo.JPG', 'image/jpeg', true],
    ['logo.jpeg', 'image/jpeg', true],
    ['logo.webp', 'image/webp', true],
    ['logo.svg', 'image/svg+xml', false],
    ['logo.png', 'text/html', false],
    ['logo.jpg', 'image/png', false],
  ])('validates extension and declared MIME for %s', (name, type, accepted) => {
    expect(acceptedRasterFile(new File([new Uint8Array([1])], name, { type }))).toBe(accepted)
  })

  it('uses the exact 248 cutoff, 225..247 graduated alpha, and preserves original alpha', () => {
    const pixels = new Uint8ClampedArray([
      248, 250, 249, 200,
      247, 250, 250, 230,
      225, 230, 240, 100,
      224, 255, 255, 77,
    ])
    const bounds = removeNearWhitePixels(pixels, 4, 1)
    expect([...pixels.filter((_, index) => index % 4 === 3)]).toEqual([0, 10, 100, 77])
    // Retained RGB means Pillow RGBA getbbox keeps all four pixels in bounds.
    expect(bounds).toEqual({ left: 0, top: 0, right: 3, bottom: 0 })
  })

  it('retains dimensions for a fully zero RGBA result', () => {
    const pixels = new Uint8ClampedArray(16)
    expect(removeNearWhitePixels(pixels, 2, 2)).toBeNull()
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DetailPage, DetailResource } from '../../types/detail-editor'
import {
  DETAIL_BACKGROUNDS,
  DETAIL_CANVAS_HEIGHT,
  DETAIL_CANVAS_WIDTH,
  DETAIL_FONTS,
  createImageLayer,
  createShapeLayer,
  createTextLayer,
  detailBackgroundDefinition,
  systemBackground,
} from './detail-defaults'
import {
  DETAIL_UPLOAD_DECODE_ERROR,
  DETAIL_UPLOAD_SIZE_ERROR,
  DETAIL_UPLOAD_TYPE_ERROR,
  detailResourceByteIdentity,
  hasPngMagic,
  pngHasAlphaColorType,
  sniffRasterMime,
  validateDetailUpload,
  validatePngBlob,
} from './detail-resources'
import { detailPageRenderInputs, detailPageSignatureSha256 } from './detail-signature'

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6])
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xdb])
const WEBP = new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4, 87, 69, 66, 80])

function bitmap(width = 200, height = 100) {
  return { width, height, close: vi.fn() } as unknown as ImageBitmap
}

function resource(id = 'poster-final', width = 1024, height = 1536): DetailResource {
  return {
    id,
    kind: id === 'poster-final' ? 'poster-final' : 'upload',
    name: `${id}.png`,
    blob: new Blob([PNG], { type: 'image/png' }),
    sha256: id.padEnd(64, 'a').slice(0, 64),
    mimeType: 'image/png',
    width,
    height,
  }
}

function page(): DetailPage {
  return {
    id: 'page-stable',
    background: systemBackground('01'),
    activeProductId: 'poster-final',
    selectedFontId: 'zcool_xiaowei',
    layers: [createImageLayer('image-1', resource(), 0), createTextLayer('text-1')],
    compositionRevision: 3,
    currentExport: null,
  }
}

describe('active Step 5 source constants', () => {
  it('exposes the real 01–20 catalog in exact source order with exact dimensions', () => {
    expect(DETAIL_BACKGROUNDS.map((item) => item.id)).toEqual(Array.from({ length: 20 }, (_, index) => String(index + 1).padStart(2, '0')))
    expect(new Set(DETAIL_BACKGROUNDS.map((item) => item.sha256)).size).toBe(20)
    expect(DETAIL_BACKGROUNDS.every((item) => item.width === 750 && item.height === 1334)).toBe(true)
    expect(DETAIL_BACKGROUNDS[0].sha256).toBe('2aac316ac50563e96d6e97cc1bc35561de94f170d638d495e0862969cfc136ea')
    expect(DETAIL_BACKGROUNDS[19].sha256).toBe('17518b59868dfe08bcec199f63fbf38610e1a6a0ff3162f5cd079b1fb858dfd9')
  })

  it('uses 01 as default/fallback and resolves the complete 24-font active catalog', () => {
    expect(systemBackground()).toMatchObject({ kind: 'system', catalogId: '01' })
    expect(detailBackgroundDefinition('missing').id).toBe('01')
    expect(DETAIL_FONTS).toHaveLength(24)
    expect(DETAIL_FONTS.find((font) => font.id === 'zcool_xiaowei')?.label).toBe('站酷小薇')
  })

  it('preserves exact text, five-shape and product-fit defaults', () => {
    expect(createTextLayer('text')).toMatchObject({ text: '双击编辑文字', left: 375, top: 960.48, fontSize: 36, strokeEnabled: false })
    expect((['line', 'rect', 'ellipse', 'star', 'diamond'] as const).map((kind) => createShapeLayer(kind, kind).shapeKind)).toEqual(['line', 'rect', 'ellipse', 'star', 'diamond'])
    const fitted = createImageLayer('product', resource(), 0)
    expect(fitted.left).toBe(339)
    expect(fitted.top).toBe(DETAIL_CANVAS_HEIGHT * 0.42)
    expect(1024 * fitted.scaleX).toBeLessThanOrEqual(DETAIL_CANVAS_WIDTH * 0.62 + 0.001)
    expect(1536 * fitted.scaleY).toBeLessThanOrEqual(DETAIL_CANVAS_HEIGHT * 0.55 + 0.001)
    expect(fitted.scaleX).toBeLessThanOrEqual(1)
  })

  it('signs render inputs but excludes revision, export and editor chrome', async () => {
    const original = page()
    const resources = { 'poster-final': resource() }
    const first = await detailPageSignatureSha256(original, resources)
    const chromeOnly = { ...original, compositionRevision: 99, currentExport: {
      pageId: original.id, revision: 3, signatureSha256: 'old', pngBlob: new Blob(), pngBlobSha256: 'old', width: 750 as const, height: 1334 as const,
    } }
    expect(await detailPageSignatureSha256(chromeOnly, resources)).toBe(first)
    expect(await detailPageSignatureSha256({ ...original, layers: original.layers.map((layer) => layer.kind === 'text' ? { ...layer, text: `${layer.text}!` } : layer) }, resources)).not.toBe(first)
    expect(detailPageRenderInputs(original, resources)).toMatchObject({ width: 750, height: 1334, rendererVersion: 'detail-canvas-v1' })
  })
})

describe('byte-first upload and PNG validation', () => {
  beforeEach(() => vi.stubGlobal('createImageBitmap', vi.fn(async () => bitmap())))
  afterEach(() => vi.unstubAllGlobals())

  it('sniffs PNG, JPEG and WebP bytes independent of file names', () => {
    expect(sniffRasterMime(PNG)).toBe('image/png')
    expect(sniffRasterMime(JPEG)).toBe('image/jpeg')
    expect(sniffRasterMime(WEBP)).toBe('image/webp')
    expect(sniffRasterMime(new Uint8Array([1, 2, 3]))).toBeNull()
    expect(hasPngMagic(PNG)).toBe(true)
    expect(pngHasAlphaColorType(PNG)).toBe(true)
  })

  it.each([
    ['png', PNG, 'image/png'],
    ['jpeg', JPEG, 'image/jpeg'],
    ['webp', WEBP, 'image/webp'],
  ])('accepts decoded %s content and normalizes empty MIME', async (name, bytes, mime) => {
    const file = new File([bytes], `${name}.unknown`, { type: '' })
    const validated = await validateDetailUpload(file)
    expect(validated.mimeType).toBe(mime)
    expect(validated.width).toBe(200)
    expect(validated.height).toBe(100)
  })

  it('rejects forged MIME, damaged bytes, empty bytes and decoded pixel overflow', async () => {
    await expect(validateDetailUpload(new File([PNG], 'forged.jpg', { type: 'image/jpeg' }))).rejects.toThrow(DETAIL_UPLOAD_TYPE_ERROR)
    await expect(validateDetailUpload(new File([new Uint8Array([1, 2, 3])], 'bad.png', { type: 'image/png' }))).rejects.toThrow(DETAIL_UPLOAD_TYPE_ERROR)
    await expect(validateDetailUpload(new File([], 'empty.png', { type: 'image/png' }))).rejects.toThrow(DETAIL_UPLOAD_DECODE_ERROR)
    vi.mocked(createImageBitmap).mockResolvedValueOnce(bitmap(10_000, 4_001))
    await expect(validateDetailUpload(new File([PNG], 'huge.png', { type: 'image/png' }))).rejects.toThrow(DETAIL_UPLOAD_SIZE_ERROR)
  })

  it('rejects the exact byte-limit overflow before decode', async () => {
    const bytes = new Uint8Array(10 * 1024 * 1024 + 1)
    bytes.set(PNG)
    await expect(validateDetailUpload(new File([bytes], 'large.png', { type: 'image/png' }))).rejects.toThrow(DETAIL_UPLOAD_SIZE_ERROR)
    expect(createImageBitmap).not.toHaveBeenCalled()
  })

  it('closes decoded ImageBitmaps on validation success and PNG failure', async () => {
    const success = bitmap(750, 1334)
    vi.mocked(createImageBitmap).mockResolvedValueOnce(success)
    await validatePngBlob(new Blob([PNG], { type: 'image/png' }), { width: 750, height: 1334, requireAlpha: true })
    expect(success.close).toHaveBeenCalledOnce()
    const mismatch = bitmap(1, 1)
    vi.mocked(createImageBitmap).mockResolvedValueOnce(mismatch)
    await expect(validatePngBlob(new Blob([PNG], { type: 'image/png' }), { width: 750, height: 1334 })).rejects.toThrow(DETAIL_UPLOAD_DECODE_ERROR)
    expect(mismatch.close).toHaveBeenCalledOnce()
  })

  it('uses byte identity for dedupe so same name/different bytes remain distinct', () => {
    const first = resource('upload:first', 20, 20)
    const duplicate = { ...first, id: 'upload:duplicate', name: 'other-name.png' }
    const changed = { ...first, id: 'upload:changed', sha256: 'b'.repeat(64), name: first.name }
    expect(detailResourceByteIdentity(duplicate)).toBe(detailResourceByteIdentity(first))
    expect(detailResourceByteIdentity(changed)).not.toBe(detailResourceByteIdentity(first))
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ActivePosterEditor, CompletePosterLayout } from '../../types/poster-editor'
import { createDefaultShape } from './poster-defaults'
import {
  composePosterPng,
  posterPreviewResourceKey,
  renderPosterCanvas,
  type PosterRenderSnapshot,
} from './poster-renderer'
import { calculatePosterTextLayout } from './poster-text-layout'

function fixture() {
  const pixels = new Uint8ClampedArray([10, 20, 30, 0, 40, 50, 60, 127])
  const calls: Array<{ name: string; args: unknown[] }> = []
  const context = {
    clearRect: (...args: unknown[]) => calls.push({ name: 'clearRect', args }),
    drawImage: (...args: unknown[]) => calls.push({ name: 'drawImage', args }),
    save: () => calls.push({ name: 'save', args: [] }),
    restore: () => calls.push({ name: 'restore', args: [] }),
    beginPath: () => calls.push({ name: 'beginPath', args: [] }),
    moveTo: (...args: unknown[]) => calls.push({ name: 'moveTo', args }),
    lineTo: (...args: unknown[]) => calls.push({ name: 'lineTo', args }),
    closePath: () => calls.push({ name: 'closePath', args: [] }),
    rect: (...args: unknown[]) => calls.push({ name: 'rect', args }),
    ellipse: (...args: unknown[]) => calls.push({ name: 'ellipse', args }),
    quadraticCurveTo: (...args: unknown[]) => calls.push({ name: 'quadraticCurveTo', args }),
    fill: () => calls.push({ name: 'fill', args: [] }),
    stroke: () => calls.push({ name: 'stroke', args: [] }),
    measureText: (text: string) => ({ width: text.length * 20, actualBoundingBoxAscent: 40, actualBoundingBoxDescent: 10 }) as TextMetrics,
    strokeText: (...args: unknown[]) => calls.push({ name: 'strokeText', args }),
    fillText: (...args: unknown[]) => calls.push({ name: 'fillText', args }),
    getImageData: () => ({ data: pixels }) as ImageData,
    putImageData: (...args: unknown[]) => calls.push({ name: 'putImageData', args }),
    set strokeStyle(value: string) { calls.push({ name: 'strokeStyle', args: [value] }) },
    set fillStyle(value: string) { calls.push({ name: 'fillStyle', args: [value] }) },
    set lineWidth(value: number) { calls.push({ name: 'lineWidth', args: [value] }) },
    set lineCap(value: CanvasLineCap) { calls.push({ name: 'lineCap', args: [value] }) },
    set lineJoin(value: CanvasLineJoin) { calls.push({ name: 'lineJoin', args: [value] }) },
    set font(value: string) { calls.push({ name: 'font', args: [value] }) },
    set textBaseline(value: CanvasTextBaseline) { calls.push({ name: 'textBaseline', args: [value] }) },
    set textAlign(value: CanvasTextAlign) { calls.push({ name: 'textAlign', args: [value] }) },
  }
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => context),
  } as unknown as HTMLCanvasElement
  return { canvas, calls, pixels }
}

function active(width = 2048, height = 3072): ActivePosterEditor {
  return {
    generationId: 'g', posterId: 'p', slot: 1, downloadUrl: '/api/v1/p/download', baseBlobId: 'base', baseBlobSha256: 'base-sha', intrinsicWidth: width, intrinsicHeight: height, upstreamSha256: 'upstream', resourceRevision: 1,
    copySnapshot: { body: '正文', title: '标题', headline: '主标', subline: '补充', platform: 'xiaohongshu', style: 'premium' },
  }
}

function layout(): CompletePosterLayout {
  return {
    fontId: 'lxgw_wenkai',
    images: [{ id: 'image', name: 'logo.png', x: 0.1, y: 0.2, w: 0.3, h: 0.4, blobId: 'overlay', sha256: 'overlay-sha' }],
    shapes: [
      createDefaultShape('rect', 'rect'),
      createDefaultShape('ellipse', 'ellipse'),
      createDefaultShape('line', 'line'),
      createDefaultShape('star', 'star'),
      createDefaultShape('diamond', 'diamond'),
    ],
    textBoxes: [
      { id: 'left', role: 'title', text: '左侧文字', fontId: null, fontSize: 64, color: '#FFFFFF', align: 'left', strokeEnabled: true, strokeWidth: 2, strokeColor: '#000000', showBox: true, x: 0.08, y: 0.08 },
      { id: 'center', role: 'headline', text: '居中文字', fontId: null, fontSize: 36, color: '#FF3366', align: 'center', strokeEnabled: false, strokeWidth: 2, strokeColor: '#000000', showBox: false, x: 0.5, y: 0.2 },
      { id: 'empty', role: 'subline', text: '   ', fontId: null, fontSize: 28, color: '#FFFFFF', align: 'left', strokeEnabled: false, strokeWidth: 2, strokeColor: '#000000', showBox: false, x: 0.08, y: 0.3 },
    ],
  }
}

describe('single browser-Canvas renderer', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('draws base -> images -> all five shapes -> non-empty text -> opaque in exact order', () => {
    const { canvas } = fixture()
    const layers: string[] = []
    renderPosterCanvas(
      canvas,
      { active: active(), layout: layout(), base: {} as CanvasImageSource, overlays: new Map([['overlay', {} as CanvasImageSource]]) },
      { onLayer: (layer, id) => layers.push(id ? `${layer}:${id}` : layer) },
    )
    expect(layers).toEqual([
      'base', 'image:image', 'shape:rect', 'shape:ellipse', 'shape:line', 'shape:star', 'shape:diamond', 'text:left', 'text:center', 'opaque',
    ])
  })

  it('uses intrinsic dimensions and exact normalized overlay boxes independent of CSS', () => {
    const { canvas, calls } = fixture()
    renderPosterCanvas(canvas, { active: active(1000, 1500), layout: layout(), base: {} as CanvasImageSource, overlays: new Map([['overlay', {} as CanvasImageSource]]) })
    expect(canvas.width).toBe(1000)
    expect(canvas.height).toBe(1500)
    const drawImages = calls.filter((call) => call.name === 'drawImage')
    expect(drawImages[0].args.slice(1)).toEqual([0, 0, 1000, 1500])
    expect(drawImages[1].args.slice(1)).toEqual([100, 300, 300, 600])
  })

  it('scales fonts and strokes from the 1024 reference width', () => {
    const { canvas, calls } = fixture()
    renderPosterCanvas(canvas, { active: active(2048, 3072), layout: layout(), base: {} as CanvasImageSource, overlays: new Map([['overlay', {} as CanvasImageSource]]) })
    expect(calls.some((call) => call.name === 'font' && String(call.args[0]).includes('128px'))).toBe(true)
    expect(calls.some((call) => call.name === 'lineWidth' && call.args[0] === 6)).toBe(true)
    expect(calls.some((call) => call.name === 'lineWidth' && call.args[0] === 8)).toBe(true)
  })

  it('supports only left-top and middle-top anchors, skips empty text, and never wraps', () => {
    const { canvas, calls } = fixture()
    renderPosterCanvas(canvas, { active: active(), layout: layout(), base: {} as CanvasImageSource, overlays: new Map([['overlay', {} as CanvasImageSource]]) })
    expect(calls.filter((call) => call.name === 'textBaseline').every((call) => call.args[0] === 'top')).toBe(true)
    expect(calls.filter((call) => call.name === 'textAlign').map((call) => call.args[0])).toEqual(['left', 'center'])
    expect(calls.filter((call) => call.name === 'fillText')).toHaveLength(2)
  })

  it('draws explicit multiline text from the same canonical layout used by the editor overlay', () => {
    const { canvas, calls } = fixture()
    const multiline = { ...layout(), images: [], shapes: [], textBoxes: [{ ...layout().textBoxes[1], text: '第一行\n第二行\n第三行' }] }
    renderPosterCanvas(canvas, { active: active(768, 1024), layout: multiline, base: {} as CanvasImageSource, overlays: new Map() })
    const canonical = calculatePosterTextLayout({
      box: multiline.textBoxes[0],
      defaultFontId: multiline.fontId,
      nativeWidth: 768,
      nativeHeight: 1024,
      measureText: (text) => ({ width: text.length * 20, actualBoundingBoxAscent: 40, actualBoundingBoxDescent: 10 }),
    })
    expect(calls.filter((call) => call.name === 'fillText').map((call) => call.args)).toEqual(
      canonical.lines.map((line) => [line.text, canonical.drawX, line.drawY]),
    )
  })

  it('uses source-exact translucent text-panel fill with no border pass', () => {
    const { canvas, calls } = fixture()
    renderPosterCanvas(canvas, { active: active(), layout: layout(), base: {} as CanvasImageSource, overlays: new Map([['overlay', {} as CanvasImageSource]]) })
    expect(calls.some((call) => call.name === 'fillStyle' && call.args[0] === 'rgba(12, 16, 22, 0.2823529412)')).toBe(true)
    expect(calls.some((call) => call.name === 'quadraticCurveTo')).toBe(true)
  })

  it('reproduces Pillow RGB conversion by forcing every output alpha byte opaque without changing RGB', () => {
    const { canvas, pixels } = fixture()
    renderPosterCanvas(canvas, { active: active(), layout: { ...layout(), images: [], shapes: [], textBoxes: [] }, base: {} as CanvasImageSource, overlays: new Map() })
    expect([...pixels]).toEqual([10, 20, 30, 255, 40, 50, 60, 255])
  })

  it('skips the expensive alpha flattening pass only for prepared preview draws', () => {
    const { canvas, calls, pixels } = fixture()
    renderPosterCanvas(
      canvas,
      { active: active(), layout: { ...layout(), images: [], shapes: [], textBoxes: [] }, base: {} as CanvasImageSource, overlays: new Map() },
      { flattenAlpha: false },
    )
    expect([...pixels]).toEqual([10, 20, 30, 0, 40, 50, 60, 127])
    expect(calls.some((call) => call.name === 'getImageData')).toBe(false)
    expect(calls.some((call) => call.name === 'putImageData')).toBe(false)
  })

  it('keys prepared preview resources only by base and visible image sources, not text or selection properties', () => {
    const original: PosterRenderSnapshot = {
      active: active(),
      layout: layout(),
      base: { id: 'base', kind: 'base' as const, blob: new Blob(), sha256: 'base-sha', mimeType: 'image/png', name: 'base.png', width: 2048, height: 3072 },
      overlays: new Map([['overlay', { id: 'overlay', kind: 'overlay' as const, blob: new Blob(), sha256: 'overlay-sha', mimeType: 'image/png', name: 'overlay.png', width: 100, height: 100 }]]),
    }
    const textOnly = {
      ...original,
      layout: { ...original.layout, textBoxes: original.layout.textBoxes.map((box) => ({ ...box, text: `${box.text}更新`, x: 0.4 })) },
    }
    const replacement = {
      ...original,
      base: { ...original.base, id: 'base-new', sha256: 'base-new-sha' },
    }
    expect(posterPreviewResourceKey(textOnly)).toBe(posterPreviewResourceKey(original))
    expect(posterPreviewResourceKey(replacement)).not.toBe(posterPreviewResourceKey(original))
  })

  it('keeps rotation normalized at zero for every shape type', () => {
    expect(layout().shapes.every((shape) => shape.rotation === 0)).toBe(true)
  })

  it('closes base and overlay bitmaps when authority becomes stale immediately after overlay decode', async () => {
    const baseClose = vi.fn()
    const overlayClose = vi.fn()
    vi.stubGlobal('createImageBitmap', vi.fn()
      .mockResolvedValueOnce({ width: 2048, height: 3072, close: baseClose })
      .mockResolvedValueOnce({ width: 200, height: 100, close: overlayClose }))
    const currentLayout = { ...layout(), fontId: 'msyh', shapes: [], textBoxes: [] }
    let authorityChecks = 0
    await expect(composePosterPng({
      active: active(),
      layout: currentLayout,
      base: { id: 'base', kind: 'base', blob: new Blob(), sha256: 'base-sha', mimeType: 'image/png', name: 'base.png', width: 2048, height: 3072 },
      overlays: new Map([['overlay', { id: 'overlay', kind: 'overlay', blob: new Blob(), sha256: 'overlay-sha', mimeType: 'image/png', name: 'overlay.png', width: 200, height: 100 }]]),
    }, () => {
      authorityChecks += 1
      if (authorityChecks === 3) throw new Error('stale-preview')
    })).rejects.toThrow('stale-preview')
    expect(baseClose).toHaveBeenCalledOnce()
    expect(overlayClose).toHaveBeenCalledOnce()
  })
})

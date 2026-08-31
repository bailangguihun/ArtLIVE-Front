import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DetailPage, DetailResource } from '../../types/detail-editor'
import { sha256Text } from '../poster-editor/poster-signature'
import { createImageLayer, createShapeLayer, createTextLayer, systemBackground } from './detail-defaults'
import { detailLayerBounds, hitTestDetailLayers, renderDetailCanvas, renderDetailPreview } from './detail-renderer'

function resource(): DetailResource {
  return { id: 'image', kind: 'upload', name: 'image.png', blob: new Blob(), sha256: 'a'.repeat(64), mimeType: 'image/png', width: 200, height: 100 }
}

function page(): DetailPage {
  return {
    id: 'page', background: systemBackground('01'), activeProductId: 'image', selectedFontId: 'zcool_xiaowei',
    layers: [
      createImageLayer('image-layer', resource(), 0),
      createShapeLayer('line', 'line'),
      createShapeLayer('rect', 'rect'),
      createShapeLayer('ellipse', 'ellipse'),
      createShapeLayer('star', 'star'),
      createShapeLayer('diamond', 'diamond'),
      { ...createTextLayer('text'), text: '测试文字', strokeEnabled: true },
    ],
    compositionRevision: 0, currentExport: null,
  }
}

function canvasFixture(contextAvailable = true) {
  const calls: Array<{ name: string; args: unknown[] }> = []
  const context = {
    clearRect: (...args: unknown[]) => calls.push({ name: 'clearRect', args }),
    fillRect: (...args: unknown[]) => calls.push({ name: 'fillRect', args }),
    drawImage: (...args: unknown[]) => calls.push({ name: 'drawImage', args }),
    save: () => calls.push({ name: 'save', args: [] }),
    restore: () => calls.push({ name: 'restore', args: [] }),
    translate: (...args: unknown[]) => calls.push({ name: 'translate', args }),
    rotate: (...args: unknown[]) => calls.push({ name: 'rotate', args }),
    scale: (...args: unknown[]) => calls.push({ name: 'scale', args }),
    beginPath: () => calls.push({ name: 'beginPath', args: [] }),
    moveTo: (...args: unknown[]) => calls.push({ name: 'moveTo', args }),
    lineTo: (...args: unknown[]) => calls.push({ name: 'lineTo', args }),
    closePath: () => calls.push({ name: 'closePath', args: [] }),
    ellipse: (...args: unknown[]) => calls.push({ name: 'ellipse', args }),
    rect: (...args: unknown[]) => calls.push({ name: 'rect', args }),
    fill: () => calls.push({ name: 'fill', args: [] }),
    stroke: () => calls.push({ name: 'stroke', args: [] }),
    fillText: (...args: unknown[]) => calls.push({ name: 'fillText', args }),
    strokeText: (...args: unknown[]) => calls.push({ name: 'strokeText', args }),
    set fillStyle(value: string) { calls.push({ name: 'fillStyle', args: [value] }) },
    set strokeStyle(value: string) { calls.push({ name: 'strokeStyle', args: [value] }) },
    set lineWidth(value: number) { calls.push({ name: 'lineWidth', args: [value] }) },
    set lineJoin(value: CanvasLineJoin) { calls.push({ name: 'lineJoin', args: [value] }) },
    set lineCap(value: CanvasLineCap) { calls.push({ name: 'lineCap', args: [value] }) },
    set globalAlpha(value: number) { calls.push({ name: 'globalAlpha', args: [value] }) },
    set font(value: string) { calls.push({ name: 'font', args: [value] }) },
    set textAlign(value: CanvasTextAlign) { calls.push({ name: 'textAlign', args: [value] }) },
    set textBaseline(value: CanvasTextBaseline) { calls.push({ name: 'textBaseline', args: [value] }) },
  }
  const canvas = { width: 0, height: 0, getContext: vi.fn(() => contextAvailable ? context : null) } as unknown as HTMLCanvasElement
  return { canvas, calls }
}

function fixedContractPage(): DetailPage {
  const image = resource()
  return {
    id: 'fixed-page',
    background: systemBackground('10'),
    activeProductId: 'image',
    selectedFontId: 'zcool_xiaowei',
    layers: [
      { ...createImageLayer('image-layer', image, 0), left: 203, top: 431, angle: -17, scaleX: 0.73, scaleY: 1.21 },
      { ...createShapeLayer('line', 'line'), left: 125, top: 210, angle: 9, scaleX: 1.15, scaleY: 0.8 },
      { ...createShapeLayer('rect', 'rect'), left: 250, top: 300, angle: -8, scaleX: 0.9, scaleY: 1.2 },
      { ...createShapeLayer('ellipse', 'ellipse'), left: 375, top: 420, angle: 13, scaleX: 1.1, scaleY: 0.7 },
      { ...createShapeLayer('star', 'star'), left: 500, top: 540, angle: 22, scaleX: 0.88, scaleY: 1.05 },
      { ...createShapeLayer('diamond', 'diamond'), left: 620, top: 650, angle: 31, scaleX: 1.25, scaleY: 0.76 },
      {
        ...createTextLayer('text'),
        text: 'Round 4 fixed renderer fixture',
        left: 375,
        top: 1120,
        angle: -3,
        scaleX: 1.07,
        scaleY: 0.96,
        fontSize: 48,
        fill: '#073b89',
        fontWeight: 'bold',
        strokeEnabled: true,
        stroke: '#fefefe',
        strokeWidth: 2,
      },
    ],
    compositionRevision: 7,
    currentExport: null,
  }
}

function normalizedCommandBytes(
  canvas: HTMLCanvasElement,
  calls: Array<{ name: string; args: unknown[] }>,
) {
  return JSON.stringify({
    width: canvas.width,
    height: canvas.height,
    calls: calls.map((call) => ({
      name: call.name,
      args: call.args.map((arg) => {
        if (!arg || typeof arg !== 'object' || !('sourceId' in arg)) return arg
        const source = arg as { sourceId: string; width: number; height: number }
        return { sourceId: source.sourceId, width: source.width, height: source.height }
      }),
    })),
  })
}

describe('750x1334 code-native detail renderer', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('uses invariant logical/export dimensions and exact centered background cover', () => {
    const { canvas, calls } = canvasFixture()
    renderDetailCanvas(canvas, { page: page(), background: { width: 100, height: 100 } as CanvasImageSource, backgroundWidth: 100, backgroundHeight: 100, images: new Map([['image', { width: 200, height: 100 } as CanvasImageSource]]) })
    expect([canvas.width, canvas.height]).toEqual([750, 1334])
    const background = calls.filter((call) => call.name === 'drawImage')[0]
    expect(background.args.slice(1)).toEqual([-292, 0, 1334, 1334])
  })

  it('draws multi-image transforms, all five shapes and stroked text in ordered layer traversal', () => {
    const { canvas, calls } = canvasFixture()
    renderDetailCanvas(canvas, { page: page(), background: { width: 750, height: 1334 } as CanvasImageSource, backgroundWidth: 750, backgroundHeight: 1334, images: new Map([['image', { width: 200, height: 100 } as CanvasImageSource]]) })
    expect(calls.filter((call) => call.name === 'drawImage')).toHaveLength(2)
    expect(calls.filter((call) => call.name === 'ellipse')).toHaveLength(1)
    expect(calls.filter((call) => call.name === 'rect')).toHaveLength(1)
    expect(calls.filter((call) => call.name === 'closePath').length).toBeGreaterThanOrEqual(2)
    expect(calls.some((call) => call.name === 'strokeText' && call.args[0] === '测试文字')).toBe(true)
    expect(calls.some((call) => call.name === 'fillText' && call.args[0] === '测试文字')).toBe(true)
  })

  it('locks dimensions and a byte-equivalent fixed renderer SHA-256 in jsdom', async () => {
    const { canvas, calls } = canvasFixture()
    const background = {
      sourceId: 'background',
      width: 1000,
      height: 600,
    } as unknown as CanvasImageSource
    const image = {
      sourceId: 'image',
      width: 200,
      height: 100,
    } as unknown as CanvasImageSource

    renderDetailCanvas(canvas, {
      page: fixedContractPage(),
      background,
      backgroundWidth: 1000,
      backgroundHeight: 600,
      images: new Map([['image', image]]),
    })

    const commandBytes = normalizedCommandBytes(canvas, calls)
    expect([canvas.width, canvas.height]).toEqual([750, 1334])
    expect(calls).toHaveLength(113)
    expect(new TextEncoder().encode(commandBytes)).toHaveLength(4552)
    expect(await sha256Text(commandBytes)).toBe(
      '3ecb3334f762c4728fad11a4de5d1ee7222f2f640ef99940abce24958464ef86',
    )
  })

  it('reports real getContext failure without a production flag', () => {
    const { canvas } = canvasFixture(false)
    expect(() => renderDetailCanvas(canvas, { page: page(), background: {} as CanvasImageSource, backgroundWidth: 750, backgroundHeight: 1334, images: new Map() })).toThrow('canvas unavailable')
  })

  it('computes transformed bounds and topmost hit testing for selection chrome', () => {
    const current = page()
    const resources = { image: resource() }
    const text = current.layers.at(-1)!
    const bounds = detailLayerBounds(text, resources)
    expect(bounds.width).toBeGreaterThan(100)
    expect(hitTestDetailLayers(current, resources, text.left, text.top)).toBe(text.id)
    expect(hitTestDetailLayers(current, resources, -100, -100)).toBeNull()
  })

  it('closes background and image bitmaps when a replacement makes the preview stale after image decode', async () => {
    const backgroundClose = vi.fn()
    const imageClose = vi.fn()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1]), {
      status: 200,
      headers: { 'Content-Type': 'image/png' },
    })))
    vi.stubGlobal('createImageBitmap', vi.fn()
      .mockResolvedValueOnce({ width: 750, height: 1334, close: backgroundClose })
      .mockResolvedValueOnce({ width: 200, height: 100, close: imageClose }))
    const imageResource = resource()
    const currentPage = {
      ...page(),
      layers: [createImageLayer('image-layer', imageResource, 0)],
    }
    let authorityChecks = 0
    await expect(renderDetailPreview(
      canvasFixture().canvas,
      { page: currentPage, resources: { image: imageResource } },
      () => {
        authorityChecks += 1
        if (authorityChecks === 3) throw new Error('stale-preview')
      },
    )).rejects.toThrow('stale-preview')
    expect(backgroundClose).toHaveBeenCalledOnce()
    expect(imageClose).toHaveBeenCalledOnce()
  })
})

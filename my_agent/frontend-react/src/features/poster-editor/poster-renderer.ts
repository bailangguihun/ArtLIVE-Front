import type {
  ActivePosterEditor,
  CompletePosterLayout,
  PosterBlobResource,
  PosterShape,
} from '../../types/poster-editor'
import { ensureLayoutFonts } from './poster-fonts'
import { calculatePosterTextLayout } from './poster-text-layout'
import {
  canvasToPngBlob,
  decodeRasterBlob,
  POSTER_BASE_DECODE_MESSAGE,
} from './poster-resources'
import { normalizeCompletePosterLayout } from './poster-signature'

export type PosterRenderLayer = 'base' | 'image' | 'shape' | 'text' | 'opaque'

export interface PosterRenderSnapshot {
  active: ActivePosterEditor
  layout: CompletePosterLayout
  base: PosterBlobResource
  overlays: ReadonlyMap<string, PosterBlobResource>
}

interface DecodedPosterSnapshot {
  active: ActivePosterEditor
  layout: CompletePosterLayout
  base: CanvasImageSource
  overlays: ReadonlyMap<string, CanvasImageSource>
}

interface RenderOptions {
  onLayer?: (layer: PosterRenderLayer, id?: string) => void
  flattenAlpha?: boolean
}

export interface PosterPreviewResources {
  readonly key: string
  readonly active: ActivePosterEditor
  readonly base: CanvasImageSource
  readonly overlays: ReadonlyMap<string, CanvasImageSource>
  readonly close: () => void
}

function scaledPx(value: number, width: number, minimum = 0) {
  return Math.max(minimum, Math.round(value * (width / 1024)))
}

function rgba(hex: string, opacity = 1) {
  const raw = /^#[0-9a-f]{6}$/i.test(hex) ? hex.slice(1) : 'FFFFFF'
  const red = Number.parseInt(raw.slice(0, 2), 16)
  const green = Number.parseInt(raw.slice(2, 4), 16)
  const blue = Number.parseInt(raw.slice(4, 6), 16)
  return `rgba(${red}, ${green}, ${blue}, ${Math.min(1, Math.max(0, opacity))})`
}

function polygonPath(
  context: CanvasRenderingContext2D,
  points: ReadonlyArray<readonly [number, number]>,
) {
  context.beginPath()
  points.forEach(([x, y], index) => {
    if (index === 0) context.moveTo(x, y)
    else context.lineTo(x, y)
  })
  context.closePath()
}

function drawShape(
  context: CanvasRenderingContext2D,
  shape: PosterShape,
  width: number,
  height: number,
) {
  const x = shape.x * width
  const y = shape.y * height
  const boxWidth = shape.w * width
  const boxHeight = shape.h * height
  context.save()
  context.strokeStyle = rgba(shape.stroke, shape.strokeOpacity)
  context.lineWidth = Math.max(1, scaledPx(shape.strokeWidth, width, 1))
  context.lineCap = 'butt'
  context.lineJoin = 'miter'
  if (shape.type === 'line') {
    context.beginPath()
    context.moveTo(x, y)
    context.lineTo(x + boxWidth, y + boxHeight)
    context.stroke()
    context.restore()
    return
  }
  context.fillStyle = rgba(shape.fill, shape.fillOpacity)
  const left = Math.min(x, x + boxWidth)
  const top = Math.min(y, y + boxHeight)
  const right = Math.max(x, x + boxWidth)
  const bottom = Math.max(y, y + boxHeight)
  const drawWidth = right - left
  const drawHeight = bottom - top
  if (shape.type === 'ellipse') {
    context.beginPath()
    context.ellipse(
      left + drawWidth / 2,
      top + drawHeight / 2,
      drawWidth / 2,
      drawHeight / 2,
      0,
      0,
      Math.PI * 2,
    )
  } else if (shape.type === 'star') {
    const points: [number, number][] = []
    const centerX = left + drawWidth / 2
    const centerY = top + drawHeight / 2
    for (let index = 0; index < 10; index += 1) {
      const angle = -Math.PI / 2 + (index * Math.PI) / 5
      const inner = index % 2 === 0 ? 1 : 0.42
      points.push([
        centerX + (drawWidth / 2) * inner * Math.cos(angle),
        centerY + (drawHeight / 2) * inner * Math.sin(angle),
      ])
    }
    polygonPath(context, points)
  } else if (shape.type === 'diamond') {
    polygonPath(context, [
      [left + drawWidth / 2, top],
      [right, top + drawHeight / 2],
      [left + drawWidth / 2, bottom],
      [left, top + drawHeight / 2],
    ])
  } else {
    context.beginPath()
    context.rect(left, top, drawWidth, drawHeight)
  }
  if (shape.fillOpacity > 0.001) context.fill()
  context.stroke()
  context.restore()
}

function roundedRect(
  context: CanvasRenderingContext2D,
  left: number,
  top: number,
  width: number,
  height: number,
  radius: number,
) {
  const r = Math.min(radius, width / 2, height / 2)
  context.beginPath()
  context.moveTo(left + r, top)
  context.lineTo(left + width - r, top)
  context.quadraticCurveTo(left + width, top, left + width, top + r)
  context.lineTo(left + width, top + height - r)
  context.quadraticCurveTo(left + width, top + height, left + width - r, top + height)
  context.lineTo(left + r, top + height)
  context.quadraticCurveTo(left, top + height, left, top + height - r)
  context.lineTo(left, top + r)
  context.quadraticCurveTo(left, top, left + r, top)
  context.closePath()
}

export function renderPosterCanvas(
  canvas: HTMLCanvasElement,
  snapshot: DecodedPosterSnapshot,
  options: RenderOptions = {},
) {
  const width = snapshot.active.intrinsicWidth
  const height = snapshot.active.intrinsicHeight
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('canvas unavailable')
  context.clearRect(0, 0, width, height)
  context.drawImage(snapshot.base, 0, 0, width, height)
  options.onLayer?.('base')

  for (const image of snapshot.layout.images) {
    const source = snapshot.overlays.get(image.blobId)
    if (!source) throw new Error('overlay unavailable')
    const left = Math.trunc(image.x * width)
    const top = Math.trunc(image.y * height)
    const boxWidth = Math.max(8, Math.trunc(Math.abs(image.w) * width))
    const boxHeight = Math.max(8, Math.trunc(Math.abs(image.h) * height))
    context.drawImage(source, left, top, boxWidth, boxHeight)
    options.onLayer?.('image', image.id)
  }

  for (const shape of snapshot.layout.shapes) {
    drawShape(context, shape, width, height)
    options.onLayer?.('shape', shape.id)
  }

  for (const box of snapshot.layout.textBoxes) {
    context.save()
    const textLayout = calculatePosterTextLayout({
      box,
      defaultFontId: snapshot.layout.fontId,
      nativeWidth: width,
      nativeHeight: height,
      measureText: (text, font) => {
        context.font = font
        return context.measureText(text)
      },
    })
    if (!textLayout.hasRenderableText) {
      context.restore()
      continue
    }
    context.font = textLayout.font
    context.textBaseline = 'top'
    context.textAlign = box.align

    if (box.showBox && textLayout.backgroundBounds) {
      const bounds = textLayout.backgroundBounds
      roundedRect(
        context,
        bounds.left,
        bounds.top,
        bounds.width,
        bounds.height,
        Math.max(8, Math.floor(width / 64)),
      )
      context.fillStyle = 'rgba(12, 16, 22, 0.2823529412)'
      context.fill()
    }

    if (textLayout.strokeWidth > 0) {
      context.strokeStyle = box.strokeColor
      context.lineWidth = textLayout.strokeWidth * 2
      context.lineJoin = 'round'
      for (const line of textLayout.lines) {
        context.strokeText(line.text, textLayout.drawX, line.drawY)
      }
    }
    context.fillStyle = box.color
    for (const line of textLayout.lines) {
      context.fillText(line.text, textLayout.drawX, line.drawY)
    }
    context.restore()
    options.onLayer?.('text', box.id)
  }

  if (options.flattenAlpha !== false) {
    // Pillow's final .convert("RGB") removes alpha without leaving a transparent PNG.
    const pixels = context.getImageData(0, 0, width, height)
    for (let index = 3; index < pixels.data.length; index += 4) {
      pixels.data[index] = 255
    }
    context.putImageData(pixels, 0, 0)
    options.onLayer?.('opaque')
  }
}

export function posterPreviewResourceKey(snapshot: PosterRenderSnapshot) {
  const overlays = [...new Set(snapshot.layout.images.map((image) => {
    const resource = snapshot.overlays.get(image.blobId)
    return `${image.blobId}:${resource?.sha256 ?? ''}`
  }))].sort()
  return [
    snapshot.active.generationId,
    snapshot.active.posterId,
    snapshot.active.baseBlobId,
    snapshot.base.id,
    snapshot.base.sha256,
    snapshot.active.intrinsicWidth,
    snapshot.active.intrinsicHeight,
    ...overlays,
  ].join('\u0000')
}

export async function preparePosterPreviewResources(
  snapshot: PosterRenderSnapshot,
  assertCurrent?: () => void,
): Promise<PosterPreviewResources> {
  const base = await decodeRasterBlob(snapshot.base.blob, POSTER_BASE_DECODE_MESSAGE)
  const decodedOverlays = new Map<string, CanvasImageSource>()
  const closers: Array<() => void> = [base.close]
  try {
    assertCurrent?.()
    if (
      base.width !== snapshot.active.intrinsicWidth ||
      base.height !== snapshot.active.intrinsicHeight
    ) {
      throw new Error(POSTER_BASE_DECODE_MESSAGE)
    }
    for (const image of snapshot.layout.images) {
      if (decodedOverlays.has(image.blobId)) continue
      const resource = snapshot.overlays.get(image.blobId)
      if (!resource) throw new Error('overlay unavailable')
      const decoded = await decodeRasterBlob(resource.blob)
      closers.push(decoded.close)
      assertCurrent?.()
      decodedOverlays.set(image.blobId, decoded.source)
    }
    return {
      key: posterPreviewResourceKey(snapshot),
      active: snapshot.active,
      base: base.source,
      overlays: decodedOverlays,
      close: () => {
        for (const closer of closers.splice(0)) closer()
      },
    }
  } catch (error) {
    for (const closer of closers.splice(0)) closer()
    throw error
  }
}

export function renderPreparedPosterPreview(
  canvas: HTMLCanvasElement,
  resources: PosterPreviewResources,
  layout: CompletePosterLayout,
) {
  renderPosterCanvas(
    canvas,
    {
      active: resources.active,
      layout: normalizeCompletePosterLayout(layout),
      base: resources.base,
      overlays: resources.overlays,
    },
    { flattenAlpha: false },
  )
}

async function decodeSnapshot(
  snapshot: PosterRenderSnapshot,
  assertCurrent?: () => void,
) {
  await ensureLayoutFonts(snapshot.layout)
  assertCurrent?.()
  const prepared = await preparePosterPreviewResources(snapshot, assertCurrent)
  return {
    decoded: {
      active: prepared.active,
      layout: normalizeCompletePosterLayout(snapshot.layout),
      base: prepared.base,
      overlays: prepared.overlays,
    } satisfies DecodedPosterSnapshot,
    close: prepared.close,
  }
}

export async function renderPosterPreview(
  canvas: HTMLCanvasElement,
  snapshot: PosterRenderSnapshot,
) {
  const prepared = await decodeSnapshot(snapshot)
  try {
    renderPosterCanvas(canvas, prepared.decoded)
  } finally {
    prepared.close()
  }
}

export async function composePosterPng(
  snapshot: PosterRenderSnapshot,
  assertCurrent?: () => void,
) {
  const prepared = await decodeSnapshot(snapshot, assertCurrent)
  try {
    const canvas = document.createElement('canvas')
    renderPosterCanvas(canvas, prepared.decoded)
    assertCurrent?.()
    const blob = await canvasToPngBlob(canvas)
    assertCurrent?.()
    return blob
  } finally {
    prepared.close()
  }
}

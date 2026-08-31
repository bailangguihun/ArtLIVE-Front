import type {
  DetailImageLayer,
  DetailLayer,
  DetailPage,
  DetailResource,
  DetailShapeLayer,
} from '../../types/detail-editor'
import { canvasToPngBlob, decodeRasterBlob } from '../poster-editor/poster-resources'
import {
  DETAIL_CANVAS_HEIGHT,
  DETAIL_CANVAS_WIDTH,
  detailBackgroundDefinition,
  detailFont,
  ensureDetailFont,
} from './detail-defaults'

export interface DetailRenderSnapshot {
  page: DetailPage
  resources: Readonly<Record<string, DetailResource>>
}

export interface PreparedDetailSnapshot {
  page: DetailPage
  background: CanvasImageSource
  backgroundWidth: number
  backgroundHeight: number
  images: ReadonlyMap<string, CanvasImageSource>
}

function polygon(context: CanvasRenderingContext2D, points: ReadonlyArray<readonly [number, number]>) {
  context.beginPath()
  points.forEach(([x, y], index) => index === 0 ? context.moveTo(x, y) : context.lineTo(x, y))
  context.closePath()
}

function drawShape(context: CanvasRenderingContext2D, layer: DetailShapeLayer) {
  context.save()
  context.translate(layer.left, layer.top)
  context.rotate((layer.angle * Math.PI) / 180)
  context.scale(layer.scaleX, layer.scaleY)
  context.globalAlpha = Math.min(1, Math.max(0, layer.opacity))
  context.fillStyle = layer.fill || 'transparent'
  context.strokeStyle = layer.stroke
  context.lineWidth = Math.max(1, layer.strokeWidth)
  context.lineJoin = 'miter'
  context.lineCap = 'butt'
  if (layer.shapeKind === 'line' && 'points' in layer.geometry) {
    const [x1, y1, x2, y2] = layer.geometry.points
    context.beginPath()
    context.moveTo(x1, y1)
    context.lineTo(x2, y2)
    context.stroke()
  } else if (layer.shapeKind === 'ellipse' && 'rx' in layer.geometry) {
    context.beginPath()
    context.ellipse(0, 0, layer.geometry.rx, layer.geometry.ry, 0, 0, Math.PI * 2)
    context.fill()
    context.stroke()
  } else if (layer.shapeKind === 'star' && 'outerRadius' in layer.geometry) {
    const points: [number, number][] = []
    const count = layer.geometry.spikes * 2
    for (let index = 0; index < count; index += 1) {
      const radius = index % 2 === 0 ? layer.geometry.outerRadius : layer.geometry.innerRadius
      const angle = -Math.PI / 2 + (index * Math.PI) / layer.geometry.spikes
      points.push([Math.cos(angle) * radius, Math.sin(angle) * radius])
    }
    polygon(context, points)
    context.fill()
    context.stroke()
  } else if ('width' in layer.geometry) {
    const width = layer.geometry.width
    const height = layer.geometry.height
    if (layer.shapeKind === 'diamond') {
      polygon(context, [[0, -height / 2], [width / 2, 0], [0, height / 2], [-width / 2, 0]])
    } else {
      context.beginPath()
      context.rect(-width / 2, -height / 2, width, height)
    }
    context.fill()
    context.stroke()
  }
  context.restore()
}

function drawLayer(
  context: CanvasRenderingContext2D,
  layer: DetailLayer,
  snapshot: PreparedDetailSnapshot,
) {
  if (layer.kind === 'shape') {
    drawShape(context, layer)
    return
  }
  context.save()
  context.translate(layer.left, layer.top)
  context.rotate((layer.angle * Math.PI) / 180)
  context.scale(layer.scaleX, layer.scaleY)
  if (layer.kind === 'text') {
    context.font = `${layer.fontStyle} ${layer.fontWeight} ${Math.max(12, layer.fontSize)}px "${detailFont(layer.fontId).family}"`
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.lineJoin = 'round'
    if (layer.strokeEnabled) {
      context.strokeStyle = layer.stroke
      context.lineWidth = Math.max(1, layer.strokeWidth) * 2
      context.strokeText(layer.text, 0, 0)
    }
    context.fillStyle = layer.fill
    context.fillText(layer.text, 0, 0)
  } else {
    const source = snapshot.images.get(layer.resourceId)
    const metadata = snapshotImageMetadata(snapshot, layer)
    if (!source || !metadata) {
      context.restore()
      throw new Error('image unavailable')
    }
    context.drawImage(source, -metadata.width / 2, -metadata.height / 2, metadata.width, metadata.height)
  }
  context.restore()
}

function snapshotImageMetadata(snapshot: PreparedDetailSnapshot, layer: DetailImageLayer) {
  const source = snapshot.images.get(layer.resourceId)
  if (!source) return null
  const width = 'width' in source ? Number(source.width) : 0
  const height = 'height' in source ? Number(source.height) : 0
  return width > 0 && height > 0 ? { width, height } : null
}

export function renderDetailCanvas(canvas: HTMLCanvasElement, snapshot: PreparedDetailSnapshot) {
  canvas.width = DETAIL_CANVAS_WIDTH
  canvas.height = DETAIL_CANVAS_HEIGHT
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('canvas unavailable')
  context.clearRect(0, 0, DETAIL_CANVAS_WIDTH, DETAIL_CANVAS_HEIGHT)
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, DETAIL_CANVAS_WIDTH, DETAIL_CANVAS_HEIGHT)
  const scale = Math.max(
    DETAIL_CANVAS_WIDTH / snapshot.backgroundWidth,
    DETAIL_CANVAS_HEIGHT / snapshot.backgroundHeight,
  )
  const width = snapshot.backgroundWidth * scale
  const height = snapshot.backgroundHeight * scale
  context.drawImage(
    snapshot.background,
    (DETAIL_CANVAS_WIDTH - width) / 2,
    (DETAIL_CANVAS_HEIGHT - height) / 2,
    width,
    height,
  )
  for (const layer of snapshot.page.layers) drawLayer(context, layer, snapshot)
}

async function systemBackgroundBlob(page: DetailPage) {
  if (page.background.kind !== 'system') throw new Error('background unavailable')
  const response = await fetch(detailBackgroundDefinition(page.background.catalogId).url, { credentials: 'same-origin' })
  if (!response.ok) throw new Error('background unavailable')
  return response.blob()
}

async function prepareDetailSnapshot(snapshot: DetailRenderSnapshot, assertCurrent?: () => void) {
  const closers: Array<() => void> = []
  try {
    const fontIds = new Set(snapshot.page.layers.filter((layer) => layer.kind === 'text').map((layer) => layer.fontId))
    for (const fontId of fontIds) {
      await ensureDetailFont(fontId)
      assertCurrent?.()
    }
    const backgroundBlob = snapshot.page.background.kind === 'system'
      ? await systemBackgroundBlob(snapshot.page)
      : snapshot.resources[snapshot.page.background.resourceId]?.blob
    assertCurrent?.()
    if (!backgroundBlob) throw new Error('background unavailable')
    const background = await decodeRasterBlob(backgroundBlob, 'background unavailable')
    closers.push(background.close)
    assertCurrent?.()
    const images = new Map<string, CanvasImageSource>()
    for (const layer of snapshot.page.layers) {
      if (layer.kind !== 'image' || images.has(layer.resourceId)) continue
      const resource = snapshot.resources[layer.resourceId]
      if (!resource) throw new Error('image unavailable')
      const decoded = await decodeRasterBlob(resource.blob, 'image unavailable')
      closers.push(decoded.close)
      assertCurrent?.()
      if (decoded.width !== resource.width || decoded.height !== resource.height) {
        throw new Error('image unavailable')
      }
      images.set(layer.resourceId, decoded.source)
    }
    return {
      prepared: {
        page: snapshot.page,
        background: background.source,
        backgroundWidth: background.width,
        backgroundHeight: background.height,
        images,
      } satisfies PreparedDetailSnapshot,
      close: () => closers.splice(0).forEach((closer) => closer()),
    }
  } catch (error) {
    closers.splice(0).forEach((closer) => closer())
    throw error
  }
}

export async function renderDetailPreview(canvas: HTMLCanvasElement, snapshot: DetailRenderSnapshot, assertCurrent?: () => void) {
  const decoded = await prepareDetailSnapshot(snapshot, assertCurrent)
  try {
    renderDetailCanvas(canvas, decoded.prepared)
    assertCurrent?.()
  } finally {
    decoded.close()
  }
}

export async function composeDetailPng(snapshot: DetailRenderSnapshot, assertCurrent?: () => void) {
  const decoded = await prepareDetailSnapshot(snapshot, assertCurrent)
  try {
    const canvas = document.createElement('canvas')
    renderDetailCanvas(canvas, decoded.prepared)
    assertCurrent?.()
    const blob = await canvasToPngBlob(canvas)
    assertCurrent?.()
    return blob
  } finally {
    decoded.close()
  }
}

export interface DetailLayerBounds { left: number; top: number; width: number; height: number; angle: number }

export function detailLayerBounds(layer: DetailLayer, resources: Readonly<Record<string, DetailResource>>): DetailLayerBounds {
  let width = 80
  let height = 50
  if (layer.kind === 'text') {
    width = Math.max(layer.fontSize * 1.2, Array.from(layer.text || ' ').length * layer.fontSize * 0.72)
    height = layer.fontSize * 1.35
  } else if (layer.kind === 'image') {
    const resource = resources[layer.resourceId]
    width = resource?.width ?? 120
    height = resource?.height ?? 120
  } else if (layer.shapeKind === 'line' && 'points' in layer.geometry) {
    width = Math.abs(layer.geometry.points[2] - layer.geometry.points[0])
    height = Math.max(16, layer.strokeWidth * 2)
  } else if (layer.shapeKind === 'ellipse' && 'rx' in layer.geometry) {
    width = layer.geometry.rx * 2
    height = layer.geometry.ry * 2
  } else if (layer.shapeKind === 'star' && 'outerRadius' in layer.geometry) {
    width = layer.geometry.outerRadius * 2
    height = layer.geometry.outerRadius * 2
  } else if ('width' in layer.geometry) {
    width = layer.geometry.width
    height = layer.geometry.height
  }
  return {
    left: layer.left,
    top: layer.top,
    width: Math.max(12, Math.abs(width * layer.scaleX)),
    height: Math.max(12, Math.abs(height * layer.scaleY)),
    angle: layer.angle,
  }
}

export function hitTestDetailLayers(page: DetailPage, resources: Readonly<Record<string, DetailResource>>, x: number, y: number) {
  for (let index = page.layers.length - 1; index >= 0; index -= 1) {
    const layer = page.layers[index]
    const bounds = detailLayerBounds(layer, resources)
    const radians = (-bounds.angle * Math.PI) / 180
    const dx = x - bounds.left
    const dy = y - bounds.top
    const localX = dx * Math.cos(radians) - dy * Math.sin(radians)
    const localY = dx * Math.sin(radians) + dy * Math.cos(radians)
    if (Math.abs(localX) <= bounds.width / 2 + 8 && Math.abs(localY) <= bounds.height / 2 + 8) return layer.id
  }
  return null
}

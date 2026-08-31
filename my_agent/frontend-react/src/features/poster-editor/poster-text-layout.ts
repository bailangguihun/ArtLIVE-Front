import type { PosterTextBox } from '../../types/poster-editor'
import { posterFontFamily } from './poster-fonts'

export type PosterCanvasTextAlign = 'left' | 'center' | 'right'

export interface PosterTextMetricsLike {
  width: number
  actualBoundingBoxAscent?: number
  actualBoundingBoxDescent?: number
}

export interface PosterTextBounds {
  left: number
  top: number
  width: number
  height: number
}

export interface PosterTextLineLayout {
  text: string
  metrics: PosterTextMetricsLike
  drawY: number
}

export interface PosterTextLayout {
  font: string
  fontFamily: string
  fontSize: number
  strokeWidth: number
  anchorX: number
  anchorY: number
  drawX: number
  drawY: number
  lineHeight: number
  lines: readonly PosterTextLineLayout[]
  hasRenderableText: boolean
  textBounds: PosterTextBounds
  backgroundBounds: PosterTextBounds | null
  selectionBounds: PosterTextBounds
}

export interface PosterTextLayoutInput {
  box: Pick<
    PosterTextBox,
    | 'text'
    | 'fontId'
    | 'fontSize'
    | 'align'
    | 'strokeEnabled'
    | 'strokeWidth'
    | 'showBox'
    | 'x'
    | 'y'
  > & { align: PosterCanvasTextAlign }
  defaultFontId: string
  nativeWidth: number
  nativeHeight: number
  measureText: (text: string, font: string) => PosterTextMetricsLike
}

export interface PosterPreviewContentRect {
  width: number
  height: number
}

export interface PosterPreviewBadgePlacement {
  left: number
  top: number
  placement: 'above' | 'below'
}

const POSTER_EDGE_MARGIN = 4
const EMPTY_SELECTION_MINIMUM = 12
const BADGE_WIDTH = 36
const BADGE_HEIGHT = 17
const BADGE_GAP = 4

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value))
}

function finite(value: number, fallback = 0) {
  return Number.isFinite(value) ? value : fallback
}

export function scaledPosterTextPx(value: number, width: number, minimum = 0) {
  return Math.max(minimum, Math.round(value * (width / 1024)))
}

export function splitPosterTextLines(value: string) {
  const normalized = String(value ?? '').trim()
  return normalized ? normalized.split(/\r?\n/) : []
}

export function createPosterTextFont(fontSize: number, fontId: string) {
  return `400 ${fontSize}px "${posterFontFamily(fontId)}"`
}

function boundsForAnchor(
  anchorX: number,
  anchorY: number,
  width: number,
  height: number,
  align: PosterCanvasTextAlign,
) {
  const left = align === 'left'
    ? anchorX
    : align === 'right'
      ? anchorX - width
      : anchorX - width / 2
  return { left, top: anchorY, width, height }
}

function offsetWithinPoster(
  bounds: PosterTextBounds,
  nativeWidth: number,
  nativeHeight: number,
) {
  let x = 0
  let y = 0
  if (bounds.left < POSTER_EDGE_MARGIN) x = POSTER_EDGE_MARGIN - bounds.left
  else if (bounds.left + bounds.width > nativeWidth - POSTER_EDGE_MARGIN) {
    x = nativeWidth - POSTER_EDGE_MARGIN - (bounds.left + bounds.width)
  }
  if (bounds.top < POSTER_EDGE_MARGIN) y = POSTER_EDGE_MARGIN - bounds.top
  else if (bounds.top + bounds.height > nativeHeight - POSTER_EDGE_MARGIN) {
    y = nativeHeight - POSTER_EDGE_MARGIN - (bounds.top + bounds.height)
  }
  return { x, y }
}

function moveBounds(bounds: PosterTextBounds, x: number, y: number): PosterTextBounds {
  return { ...bounds, left: bounds.left + x, top: bounds.top + y }
}

function clipBounds(bounds: PosterTextBounds, nativeWidth: number, nativeHeight: number) {
  const left = clamp(finite(bounds.left), 0, nativeWidth)
  const top = clamp(finite(bounds.top), 0, nativeHeight)
  const right = clamp(finite(bounds.left + bounds.width), left, nativeWidth)
  const bottom = clamp(finite(bounds.top + bounds.height), top, nativeHeight)
  return {
    left,
    top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  }
}

function emptySelectionBounds(
  input: PosterTextLayoutInput,
  fontSize: number,
  strokeWidth: number,
) {
  const size = Math.max(EMPTY_SELECTION_MINIMUM, fontSize + strokeWidth * 2)
  const anchored = boundsForAnchor(
    input.box.x * input.nativeWidth,
    input.box.y * input.nativeHeight,
    size,
    size,
    input.box.align,
  )
  const offset = offsetWithinPoster(anchored, input.nativeWidth, input.nativeHeight)
  return clipBounds(moveBounds(anchored, offset.x, offset.y), input.nativeWidth, input.nativeHeight)
}

/**
 * Canonical native-pixel text layout used by both the Canvas renderer and the
 * editor-only selection overlay. Explicit line breaks are preserved; automatic
 * wrapping is intentionally not introduced by this model.
 */
export function calculatePosterTextLayout(input: PosterTextLayoutInput): PosterTextLayout {
  const fontSize = scaledPosterTextPx(input.box.fontSize, input.nativeWidth, 8)
  const fontId = input.box.fontId || input.defaultFontId
  const fontFamily = posterFontFamily(fontId)
  const font = `400 ${fontSize}px "${fontFamily}"`
  const strokeWidth = input.box.strokeEnabled
    ? scaledPosterTextPx(input.box.strokeWidth, input.nativeWidth, 0)
    : 0
  const anchorX = input.box.x * input.nativeWidth
  const anchorY = input.box.y * input.nativeHeight
  const sourceLines = splitPosterTextLines(input.box.text)
  if (sourceLines.length === 0) {
    const selectionBounds = emptySelectionBounds(input, fontSize, strokeWidth)
    return {
      font,
      fontFamily,
      fontSize,
      strokeWidth,
      anchorX,
      anchorY,
      drawX: selectionBounds.left,
      drawY: selectionBounds.top,
      lineHeight: selectionBounds.height,
      lines: [],
      hasRenderableText: false,
      textBounds: selectionBounds,
      backgroundBounds: null,
      selectionBounds,
    }
  }

  const measuredLines = sourceLines.map((text) => ({ text, metrics: input.measureText(text, font) }))
  const lineHeight = Math.max(
    fontSize,
    ...measuredLines.map(({ metrics }) => {
      const metricHeight = Math.abs(finite(metrics.actualBoundingBoxAscent ?? 0)) + Math.abs(finite(metrics.actualBoundingBoxDescent ?? 0))
      return Math.max(fontSize, metricHeight + strokeWidth * 2)
    }),
  )
  const textWidth = Math.max(
    1,
    ...measuredLines.map(({ metrics }) => Math.max(1, finite(metrics.width) + strokeWidth * 2)),
  )
  const textHeight = lineHeight * measuredLines.length
  const anchoredBounds = boundsForAnchor(anchorX, anchorY, textWidth, textHeight, input.box.align)
  const offset = offsetWithinPoster(anchoredBounds, input.nativeWidth, input.nativeHeight)
  const textBounds = moveBounds(anchoredBounds, offset.x, offset.y)
  const backgroundBounds = input.box.showBox
    ? {
        left: textBounds.left - Math.max(10, Math.trunc(textWidth * 0.06)),
        top: textBounds.top - Math.max(6, Math.trunc(textHeight * 0.25)),
        width: textBounds.width + Math.max(10, Math.trunc(textWidth * 0.06)) * 2,
        height: textBounds.height + Math.max(6, Math.trunc(textHeight * 0.25)) * 2,
      }
    : null
  return {
    font,
    fontFamily,
    fontSize,
    strokeWidth,
    anchorX,
    anchorY,
    drawX: anchorX + offset.x,
    drawY: anchorY + offset.y,
    lineHeight,
    lines: measuredLines.map(({ text, metrics }, index) => ({ text, metrics, drawY: anchorY + offset.y + index * lineHeight })),
    hasRenderableText: true,
    textBounds,
    backgroundBounds,
    selectionBounds: clipBounds(backgroundBounds ?? textBounds, input.nativeWidth, input.nativeHeight),
  }
}

export function nativeBoundsToPreviewBounds(
  bounds: PosterTextBounds,
  nativeWidth: number,
  nativeHeight: number,
  content: PosterPreviewContentRect,
): PosterTextBounds {
  const scaleX = content.width / nativeWidth
  const scaleY = content.height / nativeHeight
  return {
    left: finite(bounds.left * scaleX),
    top: finite(bounds.top * scaleY),
    width: Math.max(1, finite(bounds.width * scaleX, 1)),
    height: Math.max(1, finite(bounds.height * scaleY, 1)),
  }
}

export function expandPreviewHitBounds(
  visual: PosterTextBounds,
  content: PosterPreviewContentRect,
  minimum = 44,
): PosterTextBounds {
  const width = Math.min(content.width, Math.max(minimum, visual.width))
  const height = Math.min(content.height, Math.max(minimum, visual.height))
  return {
    left: clamp(visual.left + visual.width / 2 - width / 2, 0, Math.max(0, content.width - width)),
    top: clamp(visual.top + visual.height / 2 - height / 2, 0, Math.max(0, content.height - height)),
    width,
    height,
  }
}

export function placePreviewSelectionBadge(
  visual: PosterTextBounds,
  content: PosterPreviewContentRect,
): PosterPreviewBadgePlacement {
  const left = clamp(visual.left, 0, Math.max(0, content.width - BADGE_WIDTH))
  const above = visual.top - BADGE_GAP - BADGE_HEIGHT
  if (above >= 0) return { left, top: above, placement: 'above' }
  const below = visual.top + visual.height + BADGE_GAP
  if (below + BADGE_HEIGHT <= content.height) return { left, top: below, placement: 'below' }
  // Normal text bounds are smaller than the poster; this last-resort edge
  // placement still keeps the badge outside the clipped visual selection.
  return visual.top <= content.height / 2
    ? { left, top: Math.max(0, content.height - BADGE_HEIGHT), placement: 'below' }
    : { left, top: 0, placement: 'above' }
}

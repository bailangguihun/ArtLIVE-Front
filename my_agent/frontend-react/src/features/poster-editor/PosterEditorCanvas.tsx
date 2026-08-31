import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type {
  CompletePosterLayout,
  PosterImage,
  PosterShape,
} from '../../types/poster-editor'
import { ensureLayoutFonts } from './poster-fonts'
import {
  posterPreviewResourceKey,
  preparePosterPreviewResources,
  renderPreparedPosterPreview,
  type PosterPreviewResources,
  type PosterRenderSnapshot,
} from './poster-renderer'
import {
  calculatePosterTextLayout,
  expandPreviewHitBounds,
  nativeBoundsToPreviewBounds,
  placePreviewSelectionBadge,
  type PosterPreviewContentRect,
  type PosterTextBounds,
} from './poster-text-layout'

export interface PosterEditorCanvasHandle {
  materializeLayout: () => CompletePosterLayout
}

type SelectableKind = 'text' | 'shape' | 'image'
type ResizeCorner = 'nw' | 'ne' | 'sw' | 'se'

interface PosterEditorCanvasProps {
  snapshot: PosterRenderSnapshot
  selectedTextId: string | null
  selectedShapeId: string | null
  selectedImageId: string | null
  disabled: boolean
  onSelect: (kind: SelectableKind, id: string) => void
  onCommit: (layout: CompletePosterLayout) => void
  onRenderError: (message: string) => void
  onRenderSuccess: () => void
}

interface Gesture {
  pointerId: number
  kind: SelectableKind
  id: string
  mode: 'move' | ResizeCorner
  startX: number
  startY: number
  layout: CompletePosterLayout
}

interface Bounds {
  left: number
  top: number
  width: number
  height: number
}

interface PreviewGeometryRect extends PosterPreviewContentRect {
  fontMetricRevision: number
}

interface PendingPreviewResources {
  readonly key: string
  readonly promise: Promise<PosterPreviewResources>
}

interface PreviewResourceCache {
  resources: PosterPreviewResources | null
  pending: PendingPreviewResources | null
  released: boolean
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value))
}

function shapeBounds(shape: PosterShape): Bounds {
  const right = shape.x + shape.w
  const bottom = shape.y + shape.h
  return {
    left: Math.min(shape.x, right),
    top: Math.min(shape.y, bottom),
    width: Math.max(0.012, Math.abs(shape.w)),
    height: Math.max(0.012, Math.abs(shape.h)),
  }
}

function imageBounds(image: PosterImage): Bounds {
  return { left: image.x, top: image.y, width: image.w, height: image.h }
}

function movedShape(shape: PosterShape, dx: number, dy: number): PosterShape {
  if (shape.type === 'line') {
    const x2 = shape.x + shape.w
    const y2 = shape.y + shape.h
    const boundedDx = clamp(dx, -Math.min(shape.x, x2), 1 - Math.max(shape.x, x2))
    const boundedDy = clamp(dy, -Math.min(shape.y, y2), 1 - Math.max(shape.y, y2))
    return { ...shape, x: shape.x + boundedDx, y: shape.y + boundedDy }
  }
  return {
    ...shape,
    x: clamp(shape.x + dx, 0, 1 - shape.w),
    y: clamp(shape.y + dy, 0, 1 - shape.h),
  }
}

function resizedShape(
  shape: PosterShape,
  corner: ResizeCorner,
  dx: number,
  dy: number,
): PosterShape {
  if (shape.type === 'line') {
    const start = { x: shape.x, y: shape.y }
    const end = { x: shape.x + shape.w, y: shape.y + shape.h }
    if (corner === 'nw' || corner === 'sw') {
      start.x = clamp(start.x + dx, 0, 1)
      start.y = clamp(start.y + dy, 0, 1)
    } else {
      end.x = clamp(end.x + dx, 0, 1)
      end.y = clamp(end.y + dy, 0, 1)
    }
    return { ...shape, x: start.x, y: start.y, w: end.x - start.x, h: end.y - start.y }
  }

  let left = shape.x
  let top = shape.y
  let right = shape.x + shape.w
  let bottom = shape.y + shape.h
  if (corner.includes('w')) left = clamp(left + dx, 0, right - 0.01)
  if (corner.includes('e')) right = clamp(right + dx, left + 0.01, 1)
  if (corner.includes('n')) top = clamp(top + dy, 0, bottom - 0.01)
  if (corner.includes('s')) bottom = clamp(bottom + dy, top + 0.01, 1)
  return { ...shape, x: left, y: top, w: right - left, h: bottom - top }
}

function resizedImage(
  image: PosterImage,
  corner: ResizeCorner,
  dx: number,
  dy: number,
): PosterImage {
  let left = image.x
  let top = image.y
  let right = image.x + image.w
  let bottom = image.y + image.h
  if (corner.includes('w')) left = clamp(left + dx, 0, right - 0.04)
  if (corner.includes('e')) right = clamp(right + dx, left + 0.04, 1)
  if (corner.includes('n')) top = clamp(top + dy, 0, bottom - 0.04)
  if (corner.includes('s')) bottom = clamp(bottom + dy, top + 0.04, 1)
  return { ...image, x: left, y: top, w: right - left, h: bottom - top }
}

function updateGestureLayout(gesture: Gesture, dx: number, dy: number) {
  const layout = gesture.layout
  if (gesture.kind === 'text') {
    return {
      ...layout,
      textBoxes: layout.textBoxes.map((box) =>
        box.id === gesture.id
          ? { ...box, x: clamp(box.x + dx, 0, 1), y: clamp(box.y + dy, 0, 1) }
          : box,
      ),
    }
  }
  if (gesture.kind === 'shape') {
    return {
      ...layout,
      shapes: layout.shapes.map((shape) =>
        shape.id !== gesture.id
          ? shape
          : gesture.mode === 'move'
            ? movedShape(shape, dx, dy)
            : resizedShape(shape, gesture.mode, dx, dy),
      ),
    }
  }
  return {
    ...layout,
    images: layout.images.map((image) =>
      image.id !== gesture.id
        ? image
        : gesture.mode === 'move'
          ? {
              ...image,
              x: clamp(image.x + dx, 0, 1 - image.w),
              y: clamp(image.y + dy, 0, 1 - image.h),
            }
          : resizedImage(image, gesture.mode, dx, dy),
    ),
  }
}

function selectionStyle(bounds: Bounds) {
  return {
    left: `${bounds.left * 100}%`,
    top: `${bounds.top * 100}%`,
    width: `${bounds.width * 100}%`,
    height: `${bounds.height * 100}%`,
  }
}

function handleStyle(bounds: Bounds, corner: ResizeCorner) {
  const x = corner.includes('w') ? bounds.left : bounds.left + bounds.width
  const y = corner.includes('n') ? bounds.top : bounds.top + bounds.height
  return { left: `${x * 100}%`, top: `${y * 100}%` }
}

function previewBoundsStyle(bounds: PosterTextBounds) {
  return {
    left: `${bounds.left}px`,
    top: `${bounds.top}px`,
    width: `${bounds.width}px`,
    height: `${bounds.height}px`,
  }
}

function textTargetName(role: string) {
  return `选择并拖动${role}文本框`
}

function releasePreviewResources(cache: PreviewResourceCache) {
  cache.released = true
  cache.pending = null
  cache.resources?.close()
  cache.resources = null
}

async function acquirePreviewResources(
  cache: PreviewResourceCache,
  snapshot: PosterRenderSnapshot,
) {
  if (cache.released) return null
  const key = posterPreviewResourceKey(snapshot)
  if (cache.resources?.key === key) return cache.resources
  if (cache.pending?.key === key) return cache.pending.promise

  const pending: PendingPreviewResources = {
    key,
    promise: preparePosterPreviewResources(snapshot),
  }
  cache.pending = pending
  try {
    const resources = await pending.promise
    if (cache.released || cache.pending !== pending) {
      resources.close()
      return null
    }
    const previous = cache.resources
    cache.resources = resources
    cache.pending = null
    previous?.close()
    return resources
  } catch (error) {
    if (cache.pending === pending) cache.pending = null
    throw error
  }
}

function requestPreviewFrame(callback: FrameRequestCallback) {
  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    return window.requestAnimationFrame(callback)
  }
  return globalThis.setTimeout(() => callback(Date.now()), 0)
}

function cancelPreviewFrame(frame: number) {
  if (typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
    window.cancelAnimationFrame(frame)
    return
  }
  globalThis.clearTimeout(frame)
}

export const PosterEditorCanvas = forwardRef<
  PosterEditorCanvasHandle,
  PosterEditorCanvasProps
>(function PosterEditorCanvas(
  {
    snapshot,
    selectedTextId,
    selectedShapeId,
    selectedImageId,
    disabled,
    onSelect,
    onCommit,
    onRenderError,
    onRenderSuccess,
  },
  forwardedRef,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const hitLayerRef = useRef<HTMLDivElement>(null)
  const gestureRef = useRef<Gesture | null>(null)
  const renderSequenceRef = useRef(0)
  const previewFrameRef = useRef<number | null>(null)
  const previewCacheRef = useRef<PreviewResourceCache>({
    resources: null,
    pending: null,
    released: false,
  })
  const [transientLayout, setTransientLayout] = useState<CompletePosterLayout | null>(null)
  const [contentRect, setContentRect] = useState<PreviewGeometryRect>({ width: 0, height: 0, fontMetricRevision: 0 })
  const [textMeasureContext] = useState(() => {
    if (typeof document === 'undefined') return null
    return document.createElement('canvas').getContext('2d')
  })
  const displayedLayout = transientLayout ?? snapshot.layout

  useImperativeHandle(
    forwardedRef,
    () => ({ materializeLayout: () => transientLayout ?? snapshot.layout }),
    [snapshot.layout, transientLayout],
  )

  const displayedSnapshot = useMemo(
    () => ({ ...snapshot, layout: displayedLayout }),
    [displayedLayout, snapshot],
  )

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const sequence = ++renderSequenceRef.current
    if (previewFrameRef.current !== null) {
      cancelPreviewFrame(previewFrameRef.current)
      previewFrameRef.current = null
    }
    previewFrameRef.current = requestPreviewFrame(() => {
      previewFrameRef.current = null
      void (async () => {
        try {
          await ensureLayoutFonts(displayedSnapshot.layout)
          if (sequence !== renderSequenceRef.current) return
          const resources = await acquirePreviewResources(previewCacheRef.current, displayedSnapshot)
          if (!resources || sequence !== renderSequenceRef.current) return
          renderPreparedPosterPreview(canvas, resources, displayedSnapshot.layout)
          if (sequence === renderSequenceRef.current) {
            setContentRect((previous) => ({ ...previous, fontMetricRevision: previous.fontMetricRevision + 1 }))
            onRenderSuccess()
          }
        } catch {
          if (sequence === renderSequenceRef.current) {
            onRenderError('预览合成失败，请检查字体或图片资源。')
          }
        }
      })()
    })
    return () => {
      renderSequenceRef.current += 1
      if (previewFrameRef.current !== null) {
        cancelPreviewFrame(previewFrameRef.current)
        previewFrameRef.current = null
      }
    }
  }, [displayedSnapshot, onRenderError, onRenderSuccess])

  useEffect(() => {
    const cache = previewCacheRef.current
    cache.released = false
    return () => {
      if (previewFrameRef.current !== null) {
        cancelPreviewFrame(previewFrameRef.current)
        previewFrameRef.current = null
      }
      releasePreviewResources(cache)
    }
  }, [])

  useLayoutEffect(() => {
    const layer = hitLayerRef.current
    if (!layer) return
    const update = () => {
      const rect = layer.getBoundingClientRect()
      const next = { width: Math.max(0, rect.width), height: Math.max(0, rect.height) }
      setContentRect((previous) => (
        previous.width === next.width && previous.height === next.height ? previous : { ...previous, ...next }
      ))
    }
    update()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    observer?.observe(layer)
    window.addEventListener('resize', update)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [])

  useEffect(() => {
    setTransientLayout(null)
    gestureRef.current = null
  }, [snapshot.active.generationId, snapshot.active.posterId])

  const beginGesture = (
    event: ReactPointerEvent<HTMLElement>,
    kind: SelectableKind,
    id: string,
    mode: Gesture['mode'] = 'move',
  ) => {
    onSelect(kind, id)
    if (disabled || event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    gestureRef.current = {
      pointerId: event.pointerId,
      kind,
      id,
      mode,
      startX: event.clientX,
      startY: event.clientY,
      layout: displayedLayout,
    }
  }

  const moveGesture = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current
    const stage = stageRef.current
    if (!gesture || gesture.pointerId !== event.pointerId || !stage) return
    event.preventDefault()
    const bounds = stage.getBoundingClientRect()
    const dx = (event.clientX - gesture.startX) / bounds.width
    const dy = (event.clientY - gesture.startY) / bounds.height
    setTransientLayout(updateGestureLayout(gesture, dx, dy))
  }

  const finishGesture = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    const finalLayout = transientLayout ?? gesture.layout
    gestureRef.current = null
    setTransientLayout(null)
    onCommit(finalLayout)
  }

  const selectedShape = displayedLayout.shapes.find((shape) => shape.id === selectedShapeId)
  const selectedImage = displayedLayout.images.find((image) => image.id === selectedImageId)
  const textGeometry = useMemo(() => {
    const geometries = new Map<string, {
      visual: PosterTextBounds
      hit: PosterTextBounds
      badge: ReturnType<typeof placePreviewSelectionBadge>
    }>()
    if (!textMeasureContext || contentRect.width <= 0 || contentRect.height <= 0) return geometries
    for (const box of displayedLayout.textBoxes) {
      const layout = calculatePosterTextLayout({
        box,
        defaultFontId: displayedLayout.fontId,
        nativeWidth: snapshot.active.intrinsicWidth,
        nativeHeight: snapshot.active.intrinsicHeight,
        measureText: (text, font) => {
          textMeasureContext.font = font
          return textMeasureContext.measureText(text)
        },
      })
      const visual = nativeBoundsToPreviewBounds(
        layout.selectionBounds,
        snapshot.active.intrinsicWidth,
        snapshot.active.intrinsicHeight,
        contentRect,
      )
      geometries.set(box.id, {
        visual,
        hit: expandPreviewHitBounds(visual, contentRect),
        badge: placePreviewSelectionBadge(visual, contentRect),
      })
    }
    return geometries
  }, [contentRect, displayedLayout, snapshot.active.intrinsicHeight, snapshot.active.intrinsicWidth, textMeasureContext])

  return (
    <div className="poster-stage-bay">
      <div
        className="poster-stage"
        data-testid="poster-stage-outer"
        ref={stageRef}
        onPointerMove={moveGesture}
        onPointerUp={finishGesture}
        onPointerCancel={finishGesture}
      >
        <canvas
          aria-label="海报合成预览。可通过右侧对象列表和属性控件完成所有编辑。"
          className="poster-stage__canvas"
          data-testid="poster-stage-canvas"
          ref={canvasRef}
          role="img"
        />
        <div className="poster-stage__hit-layer" aria-hidden={false} ref={hitLayerRef}>
          {displayedLayout.images.map((image, index) => (
            <button
              aria-label={`选择图片 ${index + 1} 并拖动`}
              className={`poster-stage__object${selectedImageId === image.id ? ' poster-stage__object--selected' : ''}`}
              key={image.id}
              onPointerDown={(event) => beginGesture(event, 'image', image.id)}
              style={selectionStyle(imageBounds(image))}
              type="button"
            />
          ))}
          {displayedLayout.shapes.map((shape, index) => (
            <button
              aria-label={`选择图形 ${index + 1} 并拖动`}
              className={`poster-stage__object${selectedShapeId === shape.id ? ' poster-stage__object--selected' : ''}`}
              key={shape.id}
              onPointerDown={(event) => beginGesture(event, 'shape', shape.id)}
              style={selectionStyle(shapeBounds(shape))}
              type="button"
            />
          ))}
          {displayedLayout.textBoxes.map((box) => {
            const geometry = textGeometry.get(box.id)
            if (!geometry) return null
            const selected = selectedTextId === box.id
            return (
              <div className="poster-stage__text-layer" key={box.id}>
                <button
                  aria-description={box.text.trim() ? `文本内容：${box.text.trim().replace(/\s+/g, ' ').slice(0, 28)}` : '空白文本框'}
                  aria-label={textTargetName(box.role)}
                  aria-pressed={selected}
                  className="poster-stage__text-target"
                  data-testid={`poster-text-target-${box.id}`}
                  onClick={(event) => {
                    if (event.detail === 0) onSelect('text', box.id)
                  }}
                  onPointerDown={(event) => beginGesture(event, 'text', box.id)}
                  style={previewBoundsStyle(geometry.hit)}
                  type="button"
                />
                {selected ? (
                  <>
                    <span
                      aria-hidden="true"
                      className="poster-stage__text-selection"
                      data-testid={`poster-text-selection-${box.id}`}
                      style={{ ...previewBoundsStyle(geometry.visual), pointerEvents: 'none' }}
                    />
                    <span
                      aria-hidden="true"
                      className="poster-stage__text-selection-badge"
                      data-testid={`poster-text-selection-badge-${box.id}`}
                      style={{ left: `${geometry.badge.left}px`, top: `${geometry.badge.top}px`, pointerEvents: 'none' }}
                    >
                      已选
                    </span>
                  </>
                ) : null}
              </div>
            )
          })}
          {selectedShape
            ? (['nw', 'ne', 'sw', 'se'] as const).map((corner) => (
                <button
                  aria-label={`调整所选图形${corner}边界`}
                  className={`poster-stage__handle poster-stage__handle--${corner}`}
                  key={corner}
                  onPointerDown={(event) => beginGesture(event, 'shape', selectedShape.id, corner)}
                  style={handleStyle(shapeBounds(selectedShape), corner)}
                  type="button"
                />
              ))
            : null}
          {selectedImage
            ? (['nw', 'ne', 'sw', 'se'] as const).map((corner) => (
                <button
                  aria-label={`调整所选图片${corner}边界`}
                  className={`poster-stage__handle poster-stage__handle--${corner}`}
                  key={corner}
                  onPointerDown={(event) => beginGesture(event, 'image', selectedImage.id, corner)}
                  style={handleStyle(imageBounds(selectedImage), corner)}
                  type="button"
                />
              ))
            : null}
        </div>
      </div>
    </div>
  )
})

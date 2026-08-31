import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { DetailLayer, DetailPage, DetailResource } from '../../types/detail-editor'
import {
  DETAIL_CANVAS_HEIGHT,
  DETAIL_CANVAS_WIDTH,
} from './detail-defaults'
import {
  detailLayerBounds,
  hitTestDetailLayers,
  renderDetailPreview,
} from './detail-renderer'

type GestureMode = 'move' | 'scale-nw' | 'scale-ne' | 'scale-se' | 'scale-sw' | 'rotate'

interface Gesture {
  pointerId: number
  mode: GestureMode
  layerId: string
  startX: number
  startY: number
  initialPage: DetailPage
  latestPage: DetailPage
  began: boolean
  expectedRevision: number
  initialDistance: number
  initialPointerAngle: number
}

interface DetailEditorCanvasProps {
  disabled: boolean
  page: DetailPage
  resources: Readonly<Record<string, DetailResource>>
  selectedLayerId: string | null
  retryToken: number
  onBeginPixelMutation: (pageId: string, expectedRevision: number) => void
  onCommitPixelMutation: (page: DetailPage, expectedRevision: number) => void
  onRenderError: (message: string) => void
  onRenderSuccess: () => void
  onSelect: (id: string | null) => void
}

function replaceLayer(page: DetailPage, id: string, next: DetailLayer): DetailPage {
  return { ...page, layers: page.layers.map((layer) => layer.id === id ? next : layer) }
}

function logicalPoint(canvas: HTMLCanvasElement, clientX: number, clientY: number) {
  const rect = canvas.getBoundingClientRect()
  return {
    x: ((clientX - rect.left) / Math.max(1, rect.width)) * DETAIL_CANVAS_WIDTH,
    y: ((clientY - rect.top) / Math.max(1, rect.height)) * DETAIL_CANVAS_HEIGHT,
  }
}

export function DetailEditorCanvas({
  disabled,
  page,
  resources,
  selectedLayerId,
  retryToken,
  onBeginPixelMutation,
  onCommitPixelMutation,
  onRenderError,
  onRenderSuccess,
  onSelect,
}: DetailEditorCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const gestureRef = useRef<Gesture | null>(null)
  const renderSequence = useRef(0)
  const [previewPage, setPreviewPage] = useState(page)

  useEffect(() => {
    if (!gestureRef.current) setPreviewPage(page)
  }, [page])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const sequence = renderSequence.current + 1
    renderSequence.current = sequence
    let disposed = false
    const assertCurrent = () => {
      if (disposed || renderSequence.current !== sequence) throw new Error('stale-preview')
    }
    void renderDetailPreview(canvas, { page: previewPage, resources }, assertCurrent)
      .then(() => {
        if (!disposed && renderSequence.current === sequence) onRenderSuccess()
      })
      .catch((error: unknown) => {
        if (disposed || renderSequence.current !== sequence || (error instanceof Error && error.message === 'stale-preview')) return
        onRenderError('详情页编辑器加载失败，请重试。')
      })
    return () => { disposed = true }
  }, [onRenderError, onRenderSuccess, previewPage, resources, retryToken])

  const selectedLayer = useMemo(
    () => previewPage.layers.find((layer) => layer.id === selectedLayerId) ?? null,
    [previewPage.layers, selectedLayerId],
  )
  const bounds = selectedLayer ? detailLayerBounds(selectedLayer, resources) : null

  const beginGesture = useCallback((
    event: ReactPointerEvent<HTMLElement>,
    mode: GestureMode,
    layerId: string,
  ) => {
    if (disabled) return
    const canvas = canvasRef.current
    const layer = previewPage.layers.find((item) => item.id === layerId)
    if (!canvas || !layer) return
    const point = logicalPoint(canvas, event.clientX, event.clientY)
    const dx = point.x - layer.left
    const dy = point.y - layer.top
    gestureRef.current = {
      pointerId: event.pointerId,
      mode,
      layerId,
      startX: point.x,
      startY: point.y,
      initialPage: previewPage,
      latestPage: previewPage,
      began: false,
      expectedRevision: previewPage.compositionRevision + 1,
      initialDistance: Math.max(1, Math.hypot(dx, dy)),
      initialPointerAngle: Math.atan2(dy, dx) * 180 / Math.PI,
    }
    event.currentTarget.setPointerCapture?.(event.pointerId)
    event.preventDefault()
  }, [disabled, previewPage])

  const handleCanvasPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (disabled) return
    const point = logicalPoint(event.currentTarget, event.clientX, event.clientY)
    const id = hitTestDetailLayers(previewPage, resources, point.x, point.y)
    onSelect(id)
    if (id) beginGesture(event, 'move', id)
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current
    const canvas = canvasRef.current
    if (!gesture || !canvas || gesture.pointerId !== event.pointerId) return
    const point = logicalPoint(canvas, event.clientX, event.clientY)
    const dx = point.x - gesture.startX
    const dy = point.y - gesture.startY
    const distance = Math.hypot(dx, dy)
    if (!gesture.began && distance < 0.25) return
    if (!gesture.began) {
      gesture.began = true
      onBeginPixelMutation(gesture.initialPage.id, gesture.initialPage.compositionRevision)
    }
    const original = gesture.initialPage.layers.find((layer) => layer.id === gesture.layerId)
    if (!original) return
    let next: DetailLayer
    if (gesture.mode === 'move') {
      next = { ...original, left: original.left + dx, top: original.top + dy }
    } else if (gesture.mode === 'rotate') {
      const pointerAngle = Math.atan2(point.y - original.top, point.x - original.left) * 180 / Math.PI
      next = { ...original, angle: original.angle + pointerAngle - gesture.initialPointerAngle }
    } else {
      const ratio = Math.max(0.08, Math.hypot(point.x - original.left, point.y - original.top) / gesture.initialDistance)
      next = { ...original, scaleX: original.scaleX * ratio, scaleY: original.scaleY * ratio }
    }
    const nextPage = replaceLayer(gesture.initialPage, gesture.layerId, next)
    gesture.latestPage = nextPage
    setPreviewPage(nextPage)
    event.preventDefault()
  }

  const finishGesture = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    gestureRef.current = null
    if (gesture.began) onCommitPixelMutation(gesture.latestPage, gesture.expectedRevision)
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLCanvasElement>) => {
    if (disabled) return
    const amount = event.shiftKey ? 10 : 1
    const layer = previewPage.layers.find((item) => item.id === selectedLayerId)
    if (!layer || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
    event.preventDefault()
    const left = layer.left + (event.key === 'ArrowLeft' ? -amount : event.key === 'ArrowRight' ? amount : 0)
    const top = layer.top + (event.key === 'ArrowUp' ? -amount : event.key === 'ArrowDown' ? amount : 0)
    onBeginPixelMutation(previewPage.id, previewPage.compositionRevision)
    onCommitPixelMutation(replaceLayer(previewPage, layer.id, { ...layer, left, top }), previewPage.compositionRevision + 1)
  }

  return (
    <div
      className="detail-canvas-stage"
      data-testid="detail-canvas-stage"
      onPointerCancel={finishGesture}
      onPointerMove={handlePointerMove}
      onPointerUp={finishGesture}
    >
      <canvas
        aria-label="详情页画布"
        className="detail-canvas"
        data-page-id={page.id}
        height={DETAIL_CANVAS_HEIGHT}
        onKeyDown={handleKeyDown}
        onPointerDown={handleCanvasPointerDown}
        ref={canvasRef}
        role="img"
        tabIndex={disabled ? -1 : 0}
        width={DETAIL_CANVAS_WIDTH}
      />
      {bounds && selectedLayer ? (
        <div
          aria-hidden="true"
          className="detail-selection"
          data-layer-id={selectedLayer.id}
          style={{
            left: `${(bounds.left / DETAIL_CANVAS_WIDTH) * 100}%`,
            top: `${(bounds.top / DETAIL_CANVAS_HEIGHT) * 100}%`,
            width: `${(bounds.width / DETAIL_CANVAS_WIDTH) * 100}%`,
            height: `${(bounds.height / DETAIL_CANVAS_HEIGHT) * 100}%`,
            transform: `translate(-50%, -50%) rotate(${bounds.angle}deg)`,
          }}
        >
          {(['nw', 'ne', 'se', 'sw'] as const).map((corner) => (
            <span
              className={`detail-selection__handle detail-selection__handle--${corner}`}
              key={corner}
              onPointerDown={(event) => beginGesture(event, `scale-${corner}`, selectedLayer.id)}
            />
          ))}
          <span
            className="detail-selection__rotate"
            onPointerDown={(event) => beginGesture(event, 'rotate', selectedLayer.id)}
          />
        </div>
      ) : null}
    </div>
  )
}

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import type { CompletePosterLayout } from '../../types/poster-editor'
import { PosterEditorCanvas } from './PosterEditorCanvas'
import type { PosterRenderSnapshot } from './poster-renderer'

const renderer = vi.hoisted(() => ({
  preview: vi.fn(async () => undefined),
  prepare: vi.fn(async (nextSnapshot: PosterRenderSnapshot) => ({
    key: 'canvas-preview',
    active: nextSnapshot.active,
    base: {},
    overlays: new Map(),
    close: vi.fn(),
  })),
  prepared: vi.fn(),
  previewKey: vi.fn((nextSnapshot: PosterRenderSnapshot) => nextSnapshot.active.baseBlobSha256),
}))

vi.mock('./poster-renderer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./poster-renderer')>()
  return {
    ...actual,
    renderPosterPreview: renderer.preview,
    preparePosterPreviewResources: renderer.prepare,
    renderPreparedPosterPreview: renderer.prepared,
    posterPreviewResourceKey: renderer.previewKey,
  }
})

const layout: CompletePosterLayout = {
  fontId: 'lxgw_wenkai',
  images: [],
  shapes: [],
  textBoxes: [
    {
      id: 'small', role: 'title', text: '短字', fontId: null, fontSize: 24,
      color: '#FFFFFF', align: 'center', strokeEnabled: false, strokeWidth: 2,
      strokeColor: '#000000', showBox: false, x: 0.5, y: 0,
    },
    {
      id: 'overlap', role: 'headline', text: '覆盖', fontId: null, fontSize: 24,
      color: '#FFFFFF', align: 'center', strokeEnabled: false, strokeWidth: 2,
      strokeColor: '#000000', showBox: false, x: 0.5, y: 0,
    },
  ],
}

const snapshot: PosterRenderSnapshot = {
  active: {
    generationId: 'generation', posterId: 'poster', slot: 1, downloadUrl: '/download',
    baseBlobId: 'base', baseBlobSha256: 'a'.repeat(64), intrinsicWidth: 768, intrinsicHeight: 1024,
    upstreamSha256: 'b'.repeat(64), resourceRevision: 1,
    copySnapshot: { body: '正文', title: '标题', headline: '主卖点', subline: '补充', platform: 'xiaohongshu', style: 'premium' },
  },
  layout,
  base: { id: 'base', kind: 'base', blob: new Blob(), sha256: 'a'.repeat(64), mimeType: 'image/png', name: 'base.png', width: 768, height: 1024 },
  overlays: new Map(),
}

function installGeometryEnvironment() {
  const context = {
    font: '',
    measureText: (text: string) => ({
      width: text.length * 12,
      actualBoundingBoxAscent: 14,
      actualBoundingBoxDescent: 4,
    }),
  }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D)
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 0, top: 0, left: 0, right: 352, bottom: 528, width: 352, height: 528,
    toJSON: () => ({}),
  })
  class TestResizeObserver {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(target: Element) { this.callback([{ target } as ResizeObserverEntry], this as unknown as ResizeObserver) }
    disconnect() {}
    unobserve() {}
  }
  vi.stubGlobal('ResizeObserver', TestResizeObserver)
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
    configurable: true,
    value: vi.fn(),
  })
}

function CanvasHarness() {
  const [selectedTextId, setSelectedTextId] = useState('small')
  return (
    <PosterEditorCanvas
      disabled={false}
      onCommit={vi.fn()}
      onRenderError={vi.fn()}
      onRenderSuccess={vi.fn()}
      onSelect={(kind, id) => {
        if (kind === 'text') setSelectedTextId(id)
      }}
      selectedImageId={null}
      selectedShapeId={null}
      selectedTextId={selectedTextId}
      snapshot={snapshot}
    />
  )
}

describe('PosterEditorCanvas canonical text selection overlays', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    delete (HTMLElement.prototype as unknown as { setPointerCapture?: unknown }).setPointerCapture
    renderer.preview.mockReset().mockResolvedValue(undefined)
    renderer.prepare.mockReset().mockImplementation(async (nextSnapshot: PosterRenderSnapshot) => ({
      key: 'canvas-preview',
      active: nextSnapshot.active,
      base: {},
      overlays: new Map(),
      close: vi.fn(),
    }))
    renderer.prepared.mockReset()
    renderer.previewKey.mockReset().mockImplementation((nextSnapshot: PosterRenderSnapshot) => nextSnapshot.active.baseBlobSha256)
  })

  it('keeps a canonical visual border small while expanding the direct target and putting the top-edge badge below', async () => {
    installGeometryEnvironment()
    render(<CanvasHarness />)
    const target = await screen.findByTestId('poster-text-target-small')
    const border = screen.getByTestId('poster-text-selection-small')
    const badge = screen.getByTestId('poster-text-selection-badge-small')
    expect(Number.parseFloat(target.style.width)).toBeGreaterThanOrEqual(44)
    expect(Number.parseFloat(target.style.height)).toBeGreaterThanOrEqual(44)
    expect(Number.parseFloat(border.style.width)).toBeLessThan(44)
    expect(Number.parseFloat(border.style.height)).toBeLessThan(44)
    expect(Number.parseFloat(badge.style.top)).toBeGreaterThan(Number.parseFloat(border.style.top) + Number.parseFloat(border.style.height))
    expect(badge.style.pointerEvents).toBe('none')
    expect(border.style.pointerEvents).toBe('none')
    expect(target).toHaveAttribute('aria-pressed', 'true')
    expect(target).toHaveAccessibleDescription('文本内容：短字')
  })

  it('keeps direct and keyboard selection synchronized without changing text layer order', async () => {
    installGeometryEnvironment()
    render(<CanvasHarness />)
    const targets = await screen.findAllByRole('button', { name: /选择并拖动.*文本框/ })
    expect(targets.map((target) => target.getAttribute('data-testid'))).toEqual([
      'poster-text-target-small',
      'poster-text-target-overlap',
    ])
    await act(async () => {
      fireEvent.click(screen.getByTestId('poster-text-target-overlap'), { detail: 0 })
    })
    expect(screen.getByTestId('poster-text-target-overlap')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByTestId('poster-text-selection-small')).not.toBeInTheDocument()
    expect(screen.getByTestId('poster-text-selection-overlap')).toBeInTheDocument()
  })

  it('selects through the enlarged direct target without mutating poster data or issuing a request', async () => {
    installGeometryEnvironment()
    const select = vi.fn()
    render(
      <PosterEditorCanvas
        disabled={false}
        onCommit={vi.fn()}
        onRenderError={vi.fn()}
        onRenderSuccess={vi.fn()}
        onSelect={select}
        selectedImageId={null}
        selectedShapeId={null}
        selectedTextId={null}
        snapshot={snapshot}
      />,
    )
    const target = await screen.findByTestId('poster-text-target-small')
    fireEvent.pointerDown(target, { button: 0, pointerId: 1, clientX: 4, clientY: 4 })
    expect(select).toHaveBeenCalledWith('text', 'small')
    await waitFor(() => expect(renderer.prepared).toHaveBeenCalled())
  })

  it('coalesces text-only preview work, reuses the base resource, and releases resources on replacement and unmount', async () => {
    installGeometryEnvironment()
    const closeA = vi.fn()
    const closeB = vi.fn()
    renderer.previewKey.mockImplementation((nextSnapshot: PosterRenderSnapshot) => nextSnapshot.active.baseBlobSha256)
    renderer.prepare.mockImplementation(async (nextSnapshot: PosterRenderSnapshot) => ({
      key: nextSnapshot.active.baseBlobSha256,
      active: nextSnapshot.active,
      base: {},
      overlays: new Map(),
      close: nextSnapshot.active.baseBlobSha256 === 'b'.repeat(64) ? closeB : closeA,
    }))
    let nextFrame = 0
    const frames = new Map<number, FrameRequestCallback>()
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      nextFrame += 1
      frames.set(nextFrame, callback)
      return nextFrame
    }))
    vi.stubGlobal('cancelAnimationFrame', vi.fn((frame: number) => frames.delete(frame)))

    const props = {
      disabled: false,
      onCommit: vi.fn(),
      onRenderError: vi.fn(),
      onRenderSuccess: vi.fn(),
      onSelect: vi.fn(),
      selectedImageId: null,
      selectedShapeId: null,
      selectedTextId: 'small',
    }
    const view = render(<PosterEditorCanvas {...props} snapshot={snapshot} />)
    const textOnly = {
      ...snapshot,
      layout: {
        ...snapshot.layout,
        textBoxes: snapshot.layout.textBoxes.map((box) => box.id === 'small' ? { ...box, text: '更新' } : box),
      },
    }
    view.rerender(<PosterEditorCanvas {...props} snapshot={textOnly} />)
    expect(frames).toHaveLength(1)
    await act(async () => {
      const [frame, callback] = [...frames.entries()].at(-1)!
      frames.delete(frame)
      callback(16)
    })
    await waitFor(() => expect(renderer.prepare).toHaveBeenCalledTimes(1))
    expect(renderer.prepared).toHaveBeenCalledTimes(1)

    const replacedBase = {
      ...textOnly,
      active: { ...textOnly.active, baseBlobSha256: 'b'.repeat(64), baseBlobId: 'base-b' },
      base: { ...textOnly.base, id: 'base-b', sha256: 'b'.repeat(64) },
    }
    view.rerender(<PosterEditorCanvas {...props} snapshot={replacedBase} />)
    await act(async () => {
      const [frame, callback] = [...frames.entries()].at(-1)!
      frames.delete(frame)
      callback(32)
    })
    await waitFor(() => expect(renderer.prepare).toHaveBeenCalledTimes(2))
    expect(closeA).toHaveBeenCalledOnce()
    view.unmount()
    expect(closeB).toHaveBeenCalledOnce()
  })
})

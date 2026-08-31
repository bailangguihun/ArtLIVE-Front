import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { DetailPage } from '../../types/detail-editor'
import { createTextLayer, systemBackground } from './detail-defaults'
import { DetailEditorCanvas } from './DetailEditorCanvas'

vi.mock('./detail-renderer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./detail-renderer')>()
  return { ...actual, renderDetailPreview: vi.fn(async () => undefined) }
})

function page(): DetailPage {
  return {
    id: 'page-pointer', background: systemBackground('01'), activeProductId: null,
    selectedFontId: 'zcool_xiaowei', layers: [{ ...createTextLayer('text'), left: 375, top: 500 }],
    compositionRevision: 4, currentExport: null,
  }
}

function renderCanvas() {
  const onBegin = vi.fn()
  const onCommit = vi.fn()
  const view = render(
    <DetailEditorCanvas
      disabled={false}
      onBeginPixelMutation={onBegin}
      onCommitPixelMutation={onCommit}
      onRenderError={vi.fn()}
      onRenderSuccess={vi.fn()}
      onSelect={vi.fn()}
      page={page()}
      resources={{}}
      retryToken={0}
      selectedLayerId="text"
    />,
  )
  const canvas = view.getByRole('img', { name: '详情页画布' }) as HTMLCanvasElement
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 750, bottom: 1334, width: 750, height: 1334, toJSON: () => ({}) })
  return { ...view, canvas, onBegin, onCommit }
}

describe('transient pointer gesture safety', () => {
  it('initialization and selection-only pointer activity create no false mutation', () => {
    const { canvas, onBegin, onCommit } = renderCanvas()
    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 375, clientY: 500 })
    fireEvent.pointerUp(canvas.parentElement!, { pointerId: 1, clientX: 375, clientY: 500 })
    expect(onBegin).not.toHaveBeenCalled()
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('dispatches synchronous invalidation on first effective delta and commits only on pointer-up', () => {
    const { canvas, onBegin, onCommit } = renderCanvas()
    const stage = canvas.parentElement!
    fireEvent.pointerDown(canvas, { pointerId: 2, clientX: 375, clientY: 500 })
    fireEvent.pointerMove(stage, { pointerId: 2, clientX: 395, clientY: 520 })
    expect(onBegin).toHaveBeenCalledOnce()
    expect(onBegin).toHaveBeenCalledWith('page-pointer', 4)
    expect(onCommit).not.toHaveBeenCalled()
    fireEvent.pointerMove(stage, { pointerId: 2, clientX: 405, clientY: 525 })
    expect(onBegin).toHaveBeenCalledOnce()
    fireEvent.pointerUp(stage, { pointerId: 2, clientX: 405, clientY: 525 })
    expect(onCommit).toHaveBeenCalledOnce()
    expect(onCommit.mock.calls[0][1]).toBe(5)
    expect(onCommit.mock.calls[0][0].layers[0]).toMatchObject({ left: 405, top: 525 })
  })
})

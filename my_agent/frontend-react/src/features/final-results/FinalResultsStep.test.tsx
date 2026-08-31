import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkflowProvider } from '../../state/WorkflowProvider'
import { useWorkflowState } from '../../state/use-workflow'
import type { WorkflowState } from '../../state/workflow-types'
import { FinalResultsStep } from './FinalResultsStep'
import { selectFinalResultsViewModel } from './final-results-model'
import { createStepSevenState } from './final-results-test-utils'

let observed: WorkflowState | null = null
let nextUrl = 0
let createObjectURL: ReturnType<typeof vi.fn>
let revokeObjectURL: ReturnType<typeof vi.fn>

function StateProbe() {
  const state = useWorkflowState()
  useEffect(() => { observed = state }, [state])
  return <output data-step={state.currentStep} data-testid="final-state" />
}

function renderStep(state = createStepSevenState()) {
  return render(
    <WorkflowProvider initialState={state}>
      <FinalResultsStep />
      <StateProbe />
    </WorkflowProvider>,
  )
}

describe('FinalResultsStep', () => {
  beforeEach(() => {
    nextUrl = 0
    createObjectURL = vi.fn(() => `blob:final-owned-${++nextUrl}`)
    revokeObjectURL = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectURL,
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectURL,
    })
  })

  afterEach(() => {
    observed = null
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('renders one read-only board with exact copy and poster-first semantic figures', async () => {
    renderStep(createStepSevenState({ detailCount: 2 }))
    expect(screen.getByRole('heading', { level: 1, name: '步骤 7：最终结果' })).toBeVisible()
    expect(screen.getByRole('heading', { level: 2, name: '最终文案' })).toBeVisible()
    expect(screen.getByText('手动编辑后的正文')).toBeVisible()
    expect(screen.getByRole('heading', { level: 2, name: '成稿图片' })).toBeVisible()
    expect(screen.getByText('共 3 张：海报 + 详情页')).toBeVisible()
    const figures = screen.getAllByRole('figure')
    expect(figures).toHaveLength(3)
    expect(figures.map((figure) => within(figure).getByText(/定稿海报|详情页/).textContent)).toEqual([
      '定稿海报',
      '详情页 1',
      '详情页 2',
    ])
    await waitFor(() => expect(screen.getAllByRole('img')).toHaveLength(3))
    expect(screen.getAllByRole('button', { name: '下载' })).toHaveLength(3)
    expect(screen.getByRole('button', { name: '上一步' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '重新开始一轮创作' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: /下一步/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(document.querySelectorAll('.final-results-board')).toHaveLength(1)
  })

  it('renders long untrusted copy as text without HTML interpretation', () => {
    const body = '<img src=x onerror=alert(1)>\nhttps://example.com/' + 'A'.repeat(200)
    const view = renderStep(createStepSevenState({ body }))
    expect(view.container.querySelector('.final-results-copy__body')).toHaveTextContent(body, {
      normalizeWhitespace: false,
    })
    expect(view.container.querySelector('script')).toBeNull()
    expect(view.container.querySelector('img[src="x"]')).toBeNull()
  })

  it('shows the explicit fallback for an empty confirmed copy body', () => {
    renderStep(createStepSevenState({ body: '' }))
    expect(screen.getByText('（空）')).toBeVisible()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('supports repeated exact-Blob downloads with source filenames and leaves state unchanged', async () => {
    const state = createStepSevenState({ detailCount: 2 })
    const authority = selectFinalResultsViewModel(state)!
    const downloads: string[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click(this: HTMLAnchorElement) {
      downloads.push(this.download)
    })
    renderStep(state)
    await waitFor(() => expect(screen.getAllByRole('img')).toHaveLength(3))
    const before = observed
    const downloadButtons = screen.getAllByRole('button', { name: '下载' })
    fireEvent.click(downloadButtons[0])
    downloadButtons.forEach((button) => {
      fireEvent.click(button)
    })
    expect(downloads).toEqual([
      'poster-final.png',
      'poster-final.png',
      'detail-final-1.png',
      'detail-final-2.png',
    ])
    expect(createObjectURL.mock.calls.slice(-4).map(([blob]) => blob)).toEqual([
      authority.gallery[0].blob,
      ...authority.gallery.map((item) => item.blob),
    ])
    expect(revokeObjectURL.mock.calls.slice(-4).map(([url]) => url)).toEqual([
      'blob:final-owned-4',
      'blob:final-owned-5',
      'blob:final-owned-6',
      'blob:final-owned-7',
    ])
    expect(observed).toBe(before)
    expect(observed?.currentStep).toBe(7)
  })

  it('Back returns to Step 6 and releases every Step 7 preview URL once', async () => {
    renderStep(createStepSevenState({ detailCount: 2 }))
    await waitFor(() => expect(screen.getAllByRole('img')).toHaveLength(3))
    fireEvent.click(screen.getByRole('button', { name: '上一步' }))
    expect(screen.getByTestId('final-state')).toHaveAttribute('data-step', '6')
    expect(screen.queryByRole('heading', { name: '步骤 7：最终结果' })).not.toBeInTheDocument()
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledTimes(3))
    expect(new Set(revokeObjectURL.mock.calls.map(([url]) => url)).size).toBe(3)
  })

  it('reset releases workflow and Step 7 URLs and restores canonical Step 1 state', async () => {
    const state = createStepSevenState({ detailCount: 2 })
    renderStep(state)
    await waitFor(() => expect(screen.getAllByRole('img')).toHaveLength(3))
    fireEvent.click(screen.getByRole('button', { name: '重新开始一轮创作' }))
    expect(screen.getByTestId('final-state')).toHaveAttribute('data-step', '1')
    expect(observed?.completedSteps.size).toBe(0)
    expect(observed?.productInfo.productImage).toBeNull()
    expect(observed?.posterEditor.confirmedPoster).toBeNull()
    expect(observed?.detailEditor.confirmedDetails).toBeNull()
    expect(observed?.marketingStrategyStep.completion).toBeNull()
    await waitFor(() => {
      expect(revokeObjectURL.mock.calls.map(([url]) => url)).toEqual(
        expect.arrayContaining([
          'blob:product-image',
          'blob:final-owned-1',
          'blob:final-owned-2',
          'blob:final-owned-3',
        ]),
      )
    })
    const revoked = revokeObjectURL.mock.calls.map(([url]) => url)
    expect(revoked.filter((url) => url.startsWith('blob:final-owned-'))).toHaveLength(3)
  })

  it('performs no API, storage, interval, or image-recomposition side effect', () => {
    const fetchMock = vi.fn()
    const intervalSpy = vi.spyOn(globalThis, 'setInterval')
    const storageSpy = vi.spyOn(Storage.prototype, 'setItem')
    const bitmapMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('createImageBitmap', bitmapMock)
    renderStep()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(intervalSpy).not.toHaveBeenCalled()
    expect(storageSpy).not.toHaveBeenCalled()
    expect(bitmapMock).not.toHaveBeenCalled()
  })

  it('renders zero result DOM for an invalid direct Step 7 state', () => {
    const state = createStepSevenState()
    renderStep({
      ...state,
      detailEditor: { ...state.detailEditor, confirmedDetails: null },
    })
    expect(screen.queryByRole('heading', { name: '步骤 7：最终结果' })).not.toBeInTheDocument()
    expect(document.querySelector('.final-results-board')).toBeNull()
  })
})

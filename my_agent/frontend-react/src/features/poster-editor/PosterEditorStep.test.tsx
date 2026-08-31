import { StrictMode } from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { WorkflowProvider } from '../../state/WorkflowProvider'
import { useWorkflowDispatch, useWorkflowState } from '../../state/use-workflow'
import type { CompletePosterLayout } from '../../types/poster-editor'
import type { WorkflowState } from '../../state/workflow-types'
import {
  createBasicAuthority,
  createPosterProjectInput,
  createPresentAdviceAuthority,
} from '../../state/workflow-v2/workflow-v2-authorities'
import type { AdviceResult } from '../../state/workflow-v2/workflow-v2-types'
import { PNG_BYTES } from '../poster-generation/poster-test-utils'
import { createStepFourState } from './poster-editor-test-utils'

const rendererMocks = vi.hoisted(() => ({
  preview: vi.fn(async () => undefined),
  prepare: vi.fn(async (snapshot: { active: unknown }) => ({
    key: 'step-four-preview',
    active: snapshot.active,
    base: {},
    overlays: new Map(),
    close: vi.fn(),
  })),
  prepared: vi.fn(),
  previewKey: vi.fn(() => 'step-four-preview'),
  compose: vi.fn(async () => new Blob([new Uint8Array([137, 80, 78, 71, 1])], { type: 'image/png' })),
  white: vi.fn(async () => new Blob([new Uint8Array([137, 80, 78, 71, 2])], { type: 'image/png' })),
}))

const V2_DRAFT_KEY = 'v2:poster-project-a:generation-a:poster-a:base-a'

const V2_ADVICE: AdviceResult = {
  category_id: 'fmcg',
  category_name: 'Fixture category',
  confidence: 'high',
  matched_keywords: ['fixture'],
  reason: 'Fixture advice for the V2 Poster Editor confirmation regression.',
  score: 9,
  strategy: {
    id: 'fmcg',
    name: 'Fixture strategy',
    examples: 'Fixture example',
    traits: ['clear'],
    tactics: ['show proof'],
    one_liner: 'Fixture one-liner',
  },
  source: 'desktop_ai_different_product_marketing_strategies',
}

vi.mock('./poster-renderer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./poster-renderer')>()
  return {
    ...actual,
    renderPosterPreview: rendererMocks.preview,
    preparePosterPreviewResources: rendererMocks.prepare,
    renderPreparedPosterPreview: rendererMocks.prepared,
    posterPreviewResourceKey: rendererMocks.previewKey,
    composePosterPng: rendererMocks.compose,
  }
})

vi.mock('./white-removal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./white-removal')>()
  return { ...actual, removeNearWhiteBackground: rendererMocks.white }
})

function StateProbe() {
  const state = useWorkflowState()
  const active = state.posterEditor.active
  const draftKey = active?.draftKey ?? active?.generationId
  const draft = draftKey ? state.posterEditor.drafts[draftKey] : null
  return (
    <output data-testid="step-four-state">
      {JSON.stringify({
        currentStep: state.currentStep,
        completedSteps: [...state.completedSteps],
        revision: state.posterEditor.compositionRevision,
        resourceRevision: state.posterEditor.resourceRevision,
        layout: draft?.layout ?? null,
        confirmed: state.posterEditor.confirmedPoster
          ? {
              generationId: state.posterEditor.confirmedPoster.generationId,
              posterId: state.posterEditor.confirmedPoster.posterId,
              revision: state.posterEditor.confirmedPoster.confirmedRevision,
              pngSha256: state.posterEditor.confirmedPoster.pngBlobSha256,
            }
          : null,
        completion: state.posterEditor.completion,
        resources: Object.keys(state.posterEditor.resources),
        draftKeys: Object.keys(state.posterEditor.drafts),
        selectedTextId: state.posterEditor.selectedTextId,
        v2: {
          view: state.workflowV2.view,
          confirmedPoster: state.workflowV2.confirmedPoster
            ? {
                projectInputSignatureSha256: state.workflowV2.confirmedPoster.project.inputSignatureSha256,
                generationId: state.workflowV2.confirmedPoster.generationId,
                posterId: state.workflowV2.confirmedPoster.posterId,
                layoutSha256: state.workflowV2.confirmedPoster.layoutSha256,
              }
            : null,
        },
      })}
    </output>
  )
}

function ExternalMutation() {
  const state = useWorkflowState()
  const dispatch = useWorkflowDispatch()
  return (
    <button
      onClick={() => {
        const active = state.posterEditor.active
        if (!active) return
        const draft = state.posterEditor.drafts[active.draftKey ?? active.generationId]
        if (!draft) return
        const layout = draft.layout
        dispatch({
          type: 'COMMIT_STEP_FOUR_MUTATION',
          layout: {
            ...layout,
            textBoxes: layout.textBoxes.map((box, index) =>
              index === 0 ? { ...box, text: `${box.text}并发编辑` } : box,
            ),
          },
        })
      }}
      type="button"
    >
      测试并发编辑
    </button>
  )
}

function createV2DraftKeyState() {
  const state = createStepFourState()
  const active = state.posterEditor.active!
  const legacyDraft = state.posterEditor.drafts[active.generationId]
  return {
    ...state,
    posterEditor: {
      ...state.posterEditor,
      active: { ...active, draftKey: V2_DRAFT_KEY },
      drafts: {
        [V2_DRAFT_KEY]: { ...legacyDraft, draftKey: V2_DRAFT_KEY },
      },
    },
  }
}

async function createCurrentV2EditorState(): Promise<WorkflowState> {
  const state = createStepFourState()
  const active = state.posterEditor.active!
  const legacyDraft = state.posterEditor.drafts[active.generationId]
  const basic = await createBasicAuthority({
    ...state.productInfo.values,
    platform: state.platformCopy.platform,
    style: state.platformCopy.style,
    productImage: {
      byteSha256: '1'.repeat(64),
      mimeType: state.productInfo.productImage!.mimeType,
      byteSize: state.productInfo.productImage!.size,
    },
  })
  const advice = await createPresentAdviceAuthority({
    api_version: 'v1',
    advice_version: 'catalog-v1',
    status: 'present',
    input_signature_sha256: basic.text.adviceInputSignatureSha256,
    advice_signature_sha256: '2'.repeat(64),
    advice: V2_ADVICE,
  }, basic)
  const project = await createPosterProjectInput({
    projectId: 'poster-editor-v2-draft-key-regression',
    basic,
    advice,
    copySource: 'poster_owned',
  })
  const draftKey = `v2:${project.inputSignatureSha256}:${active.generationId}:${active.posterId}:${active.baseBlobSha256}`
  return {
    ...state,
    posterEditor: {
      ...state.posterEditor,
      active: {
        ...active,
        draftKey,
        posterProjectInputSignatureSha256: project.inputSignatureSha256,
        posterCopySource: 'poster_owned',
      },
      drafts: {
        [draftKey]: { ...legacyDraft, draftKey },
      },
    },
    workflowV2: {
      ...state.workflowV2,
      phase: 'active',
      view: 'poster',
      resumeView: 'poster',
      epoch: 17,
      basicAuthority: basic,
      adviceAuthority: advice,
      confirmedCopy: null,
      posterProject: project,
    },
  }
}

function renderEditor(withExternalMutation = false, useV2DraftKey = false, strictMode = false) {
  const contents = (
    <WorkflowProvider initialState={useV2DraftKey ? createV2DraftKeyState() : createStepFourState()}>
      <App />
      <StateProbe />
      {withExternalMutation ? <ExternalMutation /> : null}
    </WorkflowProvider>
  )
  return render(
    strictMode ? <StrictMode>{contents}</StrictMode> : contents,
  )
}

function renderV2Editor(initialState: WorkflowState) {
  return render(
    <WorkflowProvider initialState={initialState}>
      <App />
      <StateProbe />
    </WorkflowProvider>,
  )
}

function readState() {
  return JSON.parse(screen.getByTestId('step-four-state').textContent ?? '{}') as {
    currentStep: number
    completedSteps: number[]
    revision: number
    resourceRevision: number
    layout: CompletePosterLayout
    confirmed: null | { generationId: string; posterId: string; revision: number; pngSha256: string }
    completion: null | { confirmedRevision: number }
    resources: string[]
    draftKeys: string[]
    selectedTextId: string | null
    v2: {
      view: string
      confirmedPoster: null | {
        projectInputSignatureSha256: string
        generationId: string
        posterId: string
        layoutSha256: string
      }
    }
  }
}

function getTextListButton(summary: string) {
  const button = screen.getAllByRole('button').find((candidate) =>
    candidate.classList.contains('poster-object-list__item') && candidate.textContent?.includes(summary),
  )
  if (!button) throw new Error(`text list button not found for ${summary}`)
  return button
}

describe('real Step 4 editor controls and transactions', () => {
  beforeEach(() => {
    rendererMocks.preview.mockReset().mockResolvedValue(undefined)
    rendererMocks.prepare.mockReset().mockImplementation(async (snapshot: { active: unknown }) => ({
      key: 'step-four-preview',
      active: snapshot.active,
      base: {},
      overlays: new Map(),
      close: vi.fn(),
    }))
    rendererMocks.prepared.mockReset()
    rendererMocks.previewKey.mockReset().mockReturnValue('step-four-preview')
    rendererMocks.compose.mockReset().mockResolvedValue(
      new Blob([new Uint8Array([137, 80, 78, 71, 1])], { type: 'image/png' }),
    )
    rendererMocks.white.mockReset().mockResolvedValue(
      new Blob([new Uint8Array([137, 80, 78, 71, 2])], { type: 'image/png' }),
    )
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 64, height: 32, close: vi.fn() })))
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:step-four-download') })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { configurable: true, value: vi.fn() })
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      font: '',
      measureText: (text: string) => ({
        width: text.length * 12,
        actualBoundingBoxAscent: 14,
        actualBoundingBoxDescent: 4,
      }),
    } as unknown as CanvasRenderingContext2D)
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, top: 0, left: 0, right: 352, bottom: 528, width: 352, height: 528, toJSON: () => ({}),
    })
  })

  it('renders exact tabs, text controls, ranges, alignment order, and no Step 5 surface', () => {
    renderEditor()
    expect(screen.getByRole('heading', { name: '步骤 4：文字编辑' })).toBeVisible()
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['文字', '图形', '图片'])
    expect(screen.getByRole('button', { name: '➕ 添加文本框' })).toBeVisible()
    expect(screen.getByLabelText('默认字体（未单独设置的文本框）')).toBeVisible()
    expect(screen.getByLabelText('文案')).toHaveAttribute('maxlength', '60')
    expect(screen.getByLabelText('字号')).toHaveAttribute('min', '12')
    expect(screen.getByLabelText('字号')).toHaveAttribute('max', '160')
    expect(screen.getByLabelText('字号')).toHaveAttribute('step', '2')
    expect(within(screen.getByLabelText('对齐')).getAllByRole('option').map((item) => item.textContent)).toEqual(['居中', '左对齐'])
    expect(screen.queryByRole('option', { name: /右/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '下一步：详情页制作' })).toBeDisabled()
    expect(screen.queryByRole('heading', { name: /步骤 5/ })).not.toBeInTheDocument()
  })

  it('adds, edits, and deletes only custom text while AI fill overwrites exact default roles', async () => {
    const user = userEvent.setup()
    renderEditor()
    expect(screen.queryByRole('button', { name: '删除此文本框' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '➕ 添加文本框' }))
    const textarea = screen.getByLabelText('文案')
    await user.type(textarea, '自定义保留')
    await user.click(screen.getByRole('button', { name: '填入 AI 标语' }))
    let state = readState()
    expect(state.layout.textBoxes.slice(0, 3).map((box) => box.text)).toEqual(['保留标题', '保留主标', '保留副标'])
    expect(state.layout.textBoxes.at(-1)?.text).toBe('自定义保留')
    expect(screen.getByRole('button', { name: '删除此文本框' })).toHaveClass('poster-action--destructive')
    await user.click(screen.getByRole('button', { name: '删除此文本框' }))
    state = readState()
    expect(state.layout.textBoxes).toHaveLength(3)
    expect(state.layout.textBoxes.map((box) => box.role)).toEqual(['title', 'headline', 'subline'])
  })

  it('persists V2 text, selection, tab, style, position, and added-box edits under the exact draftKey', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    renderEditor(false, true)

    const title = getTextListButton('保留标题')
    await user.click(title)
    const textarea = screen.getByLabelText('文案')
    await user.clear(textarea)
    await user.type(textarea, '通勤新主张-修复验证')
    expect(textarea).toHaveValue('通勤新主张-修复验证')
    expect(textarea).toHaveFocus()
    await waitFor(() => expect(readState().layout.textBoxes[0].text).toBe('通勤新主张-修复验证'))
    expect(readState().draftKeys).toEqual([V2_DRAFT_KEY])

    await user.click(getTextListButton('保留主标'))
    await user.click(getTextListButton('通勤新主张-修复验证'))
    expect(screen.getByLabelText('文案')).toHaveValue('通勤新主张-修复验证')

    await user.click(screen.getByRole('tab', { name: '图形' }))
    await user.click(screen.getByRole('tab', { name: '图片' }))
    await user.click(screen.getByRole('tab', { name: '文字' }))
    expect(screen.getByLabelText('文案')).toHaveValue('通勤新主张-修复验证')

    const originalCount = readState().layout.textBoxes.length
    await user.click(screen.getByRole('button', { name: '➕ 添加文本框' }))
    await waitFor(() => expect(readState().layout.textBoxes).toHaveLength(originalCount + 1))
    const customId = readState().selectedTextId
    expect(customId).toMatch(/^box-custom-/)
    const customTextarea = screen.getByLabelText('文案')
    await user.clear(customTextarea)
    await user.type(customTextarea, '新增文本框-持久化验证')
    fireEvent.change(screen.getByLabelText('字号'), { target: { value: '72' } })
    fireEvent.change(screen.getByLabelText('水平'), { target: { value: '0.25' } })
    await waitFor(() => {
      const custom = readState().layout.textBoxes.find((box) => box.id === customId)
      expect(custom).toMatchObject({ text: '新增文本框-持久化验证', fontSize: 72, x: 0.25 })
    })

    await user.click(getTextListButton('保留副标'))
    await user.click(getTextListButton('新增文本框-持久化验证'))
    expect(readState().selectedTextId).toBe(customId)
    expect(screen.getByLabelText('文案')).toHaveValue('新增文本框-持久化验证')
    expect(readState().draftKeys).toEqual([V2_DRAFT_KEY])
    expect(screen.getByRole('button', { name: '下一步：详情页制作' })).toBeDisabled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('uses one automatic-activation roving tab stop without mutating the V2 draft or issuing a request', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    renderEditor(false, true)

    const [textTab, shapeTab, imageTab] = screen.getAllByRole('tab')
    expect(textTab).toHaveAttribute('tabindex', '0')
    expect(shapeTab).toHaveAttribute('tabindex', '-1')
    expect(imageTab).toHaveAttribute('tabindex', '-1')
    expect(textTab).toHaveAttribute('aria-controls', 'poster-panel-text')
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'poster-tab-text')

    textTab.focus()
    await user.keyboard('{ArrowRight}')
    await waitFor(() => expect(shapeTab).toHaveFocus())
    expect(shapeTab).toHaveAttribute('aria-selected', 'true')
    expect(shapeTab).toHaveAttribute('tabindex', '0')
    expect(screen.getByTestId('shape-inspector')).toBeVisible()

    await user.keyboard('{ArrowRight}')
    await waitFor(() => expect(imageTab).toHaveFocus())
    expect(imageTab).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('image-inspector')).toBeVisible()

    await user.keyboard('{ArrowRight}')
    await waitFor(() => expect(textTab).toHaveFocus())
    expect(screen.getByTestId('text-inspector')).toBeVisible()

    await user.keyboard('{ArrowLeft}')
    await waitFor(() => expect(imageTab).toHaveFocus())
    await user.keyboard('{Home}')
    await waitFor(() => expect(textTab).toHaveFocus())
    await user.keyboard('{End}')
    await waitFor(() => expect(imageTab).toHaveFocus())

    await user.keyboard('{ArrowLeft}')
    await waitFor(() => expect(shapeTab).toHaveFocus())
    await user.keyboard('{Enter}')
    expect(shapeTab).toHaveAttribute('aria-selected', 'true')
    await user.keyboard(' ')
    expect(shapeTab).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{Home}')
    await waitFor(() => expect(textTab).toHaveFocus())
    await user.tab()
    expect(screen.getByTestId('text-inspector').querySelector('button')).toHaveFocus()
    expect(readState().draftKeys).toEqual([V2_DRAFT_KEY])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('buffers numeric input safely, commits valid coordinates, reverts invalid input, and keeps Arrow keys scoped to the field', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    renderEditor(false, true)

    const coordinate = screen.getByLabelText('水平')
    await user.click(coordinate)
    await user.clear(coordinate)
    await user.type(coordinate, '0.')
    expect(coordinate).toHaveValue('0.')
    expect(readState().layout.textBoxes[0].x).toBe(0)
    await user.type(coordinate, '25')
    expect(coordinate).toHaveValue('0.25')
    await waitFor(() => expect(readState().layout.textBoxes[0].x).toBe(0.25))

    await user.clear(coordinate)
    await user.type(coordinate, '2')
    expect(coordinate).toHaveAttribute('aria-invalid', 'true')
    expect(readState().layout.textBoxes[0].x).toBe(0.25)
    await user.keyboard('{Escape}')
    expect(coordinate).toHaveValue('0.25')
    expect(readState().layout.textBoxes[0].x).toBe(0.25)

    await user.keyboard('{ArrowUp}')
    await waitFor(() => expect(readState().layout.textBoxes[0].x).toBe(0.26))
    expect(screen.getAllByRole('tab')[0]).toHaveAttribute('aria-selected', 'true')

    await user.clear(coordinate)
    await user.type(coordinate, '0.')
    const textItems = screen.getAllByRole('button').filter((candidate) =>
      candidate.classList.contains('poster-object-list__item'),
    )
    await user.click(textItems[1])
    await user.click(textItems[0])
    expect(screen.getByLabelText('水平')).toHaveValue('0')
    expect(readState().draftKeys).toEqual([V2_DRAFT_KEY])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not duplicate V2 custom text boxes under React StrictMode', async () => {
    const user = userEvent.setup()
    renderEditor(false, true, true)
    const countBefore = readState().layout.textBoxes.length
    await user.click(screen.getByRole('button', { name: '➕ 添加文本框' }))
    await waitFor(() => expect(readState().layout.textBoxes).toHaveLength(countBefore + 1))
    expect(readState().layout.textBoxes.filter((box) => box.role === 'custom-1')).toHaveLength(1)
    expect(readState().draftKeys).toEqual([V2_DRAFT_KEY])
  })

  it('confirms the exact edited V2 draft once and admits only that confirmed Poster to Detail', async () => {
    const user = userEvent.setup()
    rendererMocks.compose.mockReset().mockResolvedValue(new Blob([PNG_BYTES], { type: 'image/png' }))
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 1024, height: 1536, close: vi.fn() })))
    renderV2Editor(await createCurrentV2EditorState())

    await user.clear(screen.getByLabelText('文案'))
    await user.type(screen.getByLabelText('文案'), 'V2 定稿草稿键验证')
    await waitFor(() => expect(readState().layout.textBoxes[0].text).toBe('V2 定稿草稿键验证'))
    const expectedDraftKey = readState().draftKeys[0]
    const confirm = screen.getByRole('button', { name: '确认海报' })
    await user.dblClick(confirm)
    await waitFor(() => expect(readState().v2.confirmedPoster).not.toBeNull())
    expect(rendererMocks.compose).toHaveBeenCalledTimes(1)
    expect(readState().draftKeys).toEqual([expectedDraftKey])
    expect(readState().v2.confirmedPoster).toMatchObject({
      generationId: readState().confirmed?.generationId,
      posterId: readState().confirmed?.posterId,
    })
    expect(screen.getByRole('button', { name: '下一步：详情页制作' })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: '下一步：详情页制作' }))
    await waitFor(() => expect(readState().v2.view).toBe('detail'))
    expect(await screen.findByRole('heading', { name: '详情页编辑' })).toBeVisible()
  })

  it('shows stroke controls only when enabled and showBox invalidates pixels', async () => {
    const user = userEvent.setup()
    renderEditor()
    const initial = readState().revision
    expect(screen.queryByLabelText('描边粗细')).not.toBeInTheDocument()
    await user.click(screen.getByLabelText('启用字体描边'))
    expect(screen.getByLabelText('描边粗细')).toHaveAttribute('min', '1')
    expect(screen.getByLabelText('描边粗细')).toHaveAttribute('max', '24')
    expect(screen.getByLabelText('描边颜色')).toBeVisible()
    await user.click(screen.getByLabelText('导出半透明底框（会像灰边，默认关）'))
    expect(readState().revision).toBe(initial + 2)
  })

  it('adds, copies with exact offset, styles, and deletes all five shape types; line hides fill', async () => {
    const user = userEvent.setup()
    renderEditor()
    await user.click(screen.getByRole('tab', { name: '图形' }))
    for (const label of ['矩形', '椭圆', '直线', '五角星', '菱形']) {
      await user.click(screen.getByRole('button', { name: label }))
    }
    let state = readState()
    expect(state.layout.shapes.map((shape) => shape.type)).toEqual(['rect', 'ellipse', 'line', 'star', 'diamond'])
    const selected = state.layout.shapes.at(-1)!
    await user.click(screen.getByRole('button', { name: '复制图形' }))
    state = readState()
    const copy = state.layout.shapes.at(-1)!
    expect(copy.x).toBe(Math.min(0.92, selected.x + 0.03))
    expect(copy.y).toBe(Math.min(0.92, selected.y + 0.03))
    fireEvent.change(screen.getByLabelText('线宽'), { target: { value: '9' } })
    expect(readState().layout.shapes.at(-1)?.strokeWidth).toBe(9)
    expect(screen.getByRole('button', { name: '删除图形' })).toHaveClass('poster-action--destructive')
    await user.click(screen.getByRole('button', { name: '删除图形' }))
    expect(readState().layout.shapes).toHaveLength(5)
    await user.selectOptions(screen.getByLabelText('图形列表'), screen.getByRole('option', { name: '直线 3' }))
    expect(screen.queryByLabelText('填充颜色')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('填充透明度')).not.toBeInTheDocument()
    expect(screen.getByLabelText('线条颜色')).toBeVisible()
  })

  it('uploads, hashes, processes, moves, resizes, and deletes a valid raster atomically', async () => {
    const user = userEvent.setup()
    renderEditor()
    await user.click(screen.getByRole('tab', { name: '图片' }))
    const file = new File([new Uint8Array([1, 2, 3])], '安全标志.png', { type: 'image/png' })
    await user.upload(screen.getByLabelText('上传商标或其他图片'), file)
    await waitFor(() => expect(readState().layout.images).toHaveLength(1))
    let state = readState()
    expect(state.layout.images[0]).toMatchObject({ name: '安全标志.png', x: 0.08, y: 0.08, w: 0.22, h: 0.14 })
    expect(state.layout.images[0].sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(state.resources).toHaveLength(2)
    fireEvent.change(screen.getByLabelText('水平'), { target: { value: '0.2' } })
    fireEvent.change(screen.getByLabelText('宽度'), { target: { value: '0.3' } })
    expect(screen.getByRole('button', { name: '一键去除白底' })).not.toHaveClass('poster-action--destructive')
    await user.click(screen.getByRole('button', { name: '一键去除白底' }))
    await waitFor(() => expect(screen.getByText('已去除近白背景。')).toBeVisible())
    expect(rendererMocks.white).toHaveBeenCalledTimes(1)
    state = readState()
    expect(state.layout.images[0]).toMatchObject({ x: 0.2, w: 0.3 })
    expect(state.resources).toHaveLength(2)
    expect(screen.getByRole('button', { name: '删除图片' })).toHaveClass('poster-action--destructive')
    await user.click(screen.getByRole('button', { name: '删除图片' }))
    expect(readState().layout.images).toHaveLength(0)
    expect(readState().resources).toHaveLength(1)
    expect(screen.getByText('暂无图片。')).toBeVisible()
  })

  it('rejects unsupported and malformed raster uploads without partial mutation or unsafe HTML', async () => {
    const user = userEvent.setup()
    renderEditor()
    await user.click(screen.getByRole('tab', { name: '图片' }))
    fireEvent.change(screen.getByLabelText('上传商标或其他图片'), {
      target: {
        files: [new File(['<html/>'], '<img onerror=alert(1)>.png', { type: 'text/html' })],
      },
    })
    expect(await screen.findByText(/上传失败：仅支持 PNG/)).toBeVisible()
    expect(readState().layout.images).toHaveLength(0)
    vi.stubGlobal('createImageBitmap', vi.fn(async () => { throw new Error('bad bytes') }))
    fireEvent.change(screen.getByLabelText('上传商标或其他图片'), {
      target: {
        files: [new File([new Uint8Array([0])], 'malformed.png', { type: 'image/png' })],
      },
    })
    await waitFor(() => expect(screen.getByText(/上传失败：图片无法解码/)).toBeVisible())
    expect(readState().layout.images).toHaveLength(0)
    expect(document.querySelector('[onerror]')).toBeNull()
  })

  it('exports a fresh intrinsic PNG with exact filename without confirming', async () => {
    const user = userEvent.setup()
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    renderEditor()
    await user.click(screen.getByRole('button', { name: '导出 PNG' }))
    await waitFor(() => expect(rendererMocks.compose).toHaveBeenCalledTimes(1))
    const anchor = click.mock.instances[0] as HTMLAnchorElement
    expect(anchor.download).toBe('poster-composed-1.png')
    expect(readState().confirmed).toBeNull()
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:step-four-download')
  })

  it('confirms once on double activation, stores completion on Next, and remains Step 4', async () => {
    const user = userEvent.setup()
    let resolveCompose!: (blob: Blob) => void
    rendererMocks.compose.mockImplementationOnce(() => new Promise((resolve) => { resolveCompose = resolve }))
    renderEditor()
    const confirm = screen.getByRole('button', { name: '确认保存海报与文案' })
    await user.dblClick(confirm)
    expect(rendererMocks.compose).toHaveBeenCalledTimes(1)
    await act(async () => resolveCompose(new Blob([new Uint8Array([137, 80, 78, 71, 9])], { type: 'image/png' })))
    await waitFor(() => expect(screen.getByText('已确认保存定稿海报与文案，可以进入下一步。')).toBeVisible())
    const next = screen.getByRole('button', { name: '下一步：详情页制作' })
    expect(next).toBeEnabled()
    await user.click(next)
    const state = readState()
    expect(state.currentStep).toBe(4)
    expect(state.completion?.confirmedRevision).toBe(state.confirmed?.revision)
    expect(state.completedSteps).toContain(4)
    expect(screen.queryByRole('heading', { name: /步骤 5/ })).not.toBeInTheDocument()
  })

  it('selection, focus, and tab changes preserve confirmation while showBox invalidates immediately', async () => {
    const user = userEvent.setup()
    renderEditor()
    await user.click(screen.getByRole('button', { name: '确认保存海报与文案' }))
    await screen.findByText('已确认保存定稿海报与文案，可以进入下一步。')
    const revision = readState().revision
    await user.click(screen.getByRole('button', { name: /主卖点/ }))
    await user.click(screen.getByRole('tab', { name: '图形' }))
    await user.click(screen.getByRole('tab', { name: '文字' }))
    screen.getByLabelText('文案').focus()
    expect(readState().revision).toBe(revision)
    expect(screen.getByRole('button', { name: '下一步：详情页制作' })).toBeEnabled()
    await user.click(screen.getByLabelText('导出半透明底框（会像灰边，默认关）'))
    expect(screen.getByText('编辑完成后，请点击下方按钮确认保存。')).toBeVisible()
    expect(screen.getByRole('button', { name: '下一步：详情页制作' })).toBeDisabled()
  })

  it('discards confirmation if an edit lands during the async composition', async () => {
    const user = userEvent.setup()
    let resolveCompose!: (blob: Blob) => void
    rendererMocks.compose.mockImplementationOnce(() => new Promise((resolve) => { resolveCompose = resolve }))
    renderEditor(true)
    await user.click(screen.getByRole('button', { name: '确认保存海报与文案' }))
    await waitFor(() => expect(rendererMocks.compose).toHaveBeenCalledTimes(1))
    await user.click(screen.getByRole('button', { name: '测试并发编辑' }))
    await act(async () => resolveCompose(new Blob([new Uint8Array([137, 80, 78, 71, 3])], { type: 'image/png' })))
    await waitFor(() => expect(screen.getByText(/保存失败：编辑内容已变化/)).toBeVisible())
    expect(readState().confirmed).toBeNull()
    expect(screen.getByRole('button', { name: '下一步：详情页制作' })).toBeDisabled()
  })

  it('discards the fresh PNG when an edit lands during its SHA-256 await', async () => {
    const user = userEvent.setup()
    const originalDigest = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle)
    let digestCalls = 0
    let releasePngDigest!: () => void
    const digestSpy = vi.spyOn(globalThis.crypto.subtle, 'digest').mockImplementation(
      async (algorithm, data) => {
        digestCalls += 1
        if (digestCalls === 3) {
          await new Promise<void>((resolve) => {
            releasePngDigest = resolve
          })
        }
        return originalDigest(algorithm, data)
      },
    )
    renderEditor(true)
    await user.click(screen.getByRole('button', { name: '确认保存海报与文案' }))
    await waitFor(() => expect(digestCalls).toBe(3))
    await user.click(screen.getByRole('button', { name: '测试并发编辑' }))
    await act(async () => releasePngDigest())
    await waitFor(() => expect(screen.getByText(/保存失败：编辑内容已变化/)).toBeVisible())
    expect(readState().confirmed).toBeNull()
    expect(screen.getByRole('button', { name: '下一步：详情页制作' })).toBeDisabled()
    digestSpy.mockRestore()
  })

  it('commits final drag geometry before immediate confirmation and renders that immutable candidate', async () => {
    const user = userEvent.setup()
    renderEditor()
    const title = screen.getByRole('button', { name: '选择并拖动title文本框' })
    const stage = screen.getByTestId('poster-stage-outer')
    fireEvent.pointerDown(title, { pointerId: 1, button: 0, clientX: 20, clientY: 20 })
    fireEvent.pointerMove(stage, { pointerId: 1, clientX: 55.2, clientY: 72.8 })
    fireEvent.pointerUp(stage, { pointerId: 1, clientX: 55.2, clientY: 72.8 })
    await user.click(screen.getByRole('button', { name: '确认保存海报与文案' }))
    await waitFor(() => expect(rendererMocks.compose).toHaveBeenCalledTimes(1))
    const captured = (
      rendererMocks.compose.mock.calls as unknown as Array<[
        { layout: CompletePosterLayout },
      ]>
    )[0][0]
    expect(captured.layout.textBoxes[0].x).toBeCloseTo(0.18, 2)
    expect(captured.layout.textBoxes[0].y).toBeCloseTo(0.18, 2)
    expect(readState().confirmed).not.toBeNull()
  })

  it('uses the canonical direct-preview text target without changing the V2 draft or issuing a request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    renderEditor(false, true)
    const target = await screen.findByRole('button', { name: '选择并拖动title文本框' })
    expect(Number.parseFloat(target.style.width)).toBeGreaterThanOrEqual(44)
    expect(Number.parseFloat(target.style.height)).toBeGreaterThanOrEqual(44)
    fireEvent.click(target, { detail: 0 })
    expect(readState().selectedTextId).toBe('box-title')
    expect(screen.getByTestId('poster-text-selection-box-title').style.pointerEvents).toBe('none')
    expect(screen.getByTestId('poster-text-selection-badge-box-title').style.pointerEvents).toBe('none')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(readState().draftKeys).toEqual([V2_DRAFT_KEY])
  })

  it('keeps Back available after a safe compose failure and cannot confirm on a null/export failure', async () => {
    const user = userEvent.setup()
    rendererMocks.compose.mockRejectedValueOnce(new Error('canvas unavailable'))
    renderEditor()
    await user.click(screen.getByRole('button', { name: '确认保存海报与文案' }))
    expect(await screen.findByText('保存失败：无法生成 PNG，请重试。')).toBeVisible()
    expect(screen.getByRole('button', { name: '上一步' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '下一步：详情页制作' })).toBeDisabled()
    expect(readState().confirmed).toBeNull()
    await user.click(screen.getByRole('button', { name: '上一步' }))
    expect(screen.getByRole('heading', { name: '步骤 3：生成海报' })).toBeVisible()
  })
})

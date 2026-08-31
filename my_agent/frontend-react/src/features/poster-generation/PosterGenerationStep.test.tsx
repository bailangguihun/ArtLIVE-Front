import { forwardRef, useImperativeHandle } from 'react'
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { WorkflowProvider } from '../../state/WorkflowProvider'
import { workflowReducer } from '../../state/workflow-reducer'
import type { WorkflowState } from '../../state/workflow-types'
import { useWorkflowState } from '../../state/use-workflow'
import {
  copyRefFromConfirmedCopy,
  createBasicAuthority,
  createConfirmedCopy,
  createCopyInputAuthority,
  createPosterProjectInput,
  createPresentAdviceAuthority,
} from '../../state/workflow-v2/workflow-v2-authorities'
import type { AdviceResult } from '../../state/workflow-v2/workflow-v2-types'
import {
  canonicalSequenceJson,
  sequenceIntentFingerprint,
} from './poster-fingerprint'
import {
  createStepThreeState,
  jsonResponse,
  normalizedSequence,
  PNG_BYTES,
  sequenceDocument,
  TEST_GENERATION_ID,
  TEST_POSTER_IDS,
  ZIP_BYTES,
} from './poster-test-utils'
import { buildPosterSequencePayload } from './sequence-payload'

vi.mock('../poster-editor/PosterEditorCanvas', () => ({
  PosterEditorCanvas: forwardRef(function MockPosterEditorCanvas(
    props: { snapshot: { layout: unknown } },
    ref,
  ) {
    useImperativeHandle(ref, () => ({
      materializeLayout: () => props.snapshot.layout,
    }))
    return <div data-testid="mock-poster-editor-canvas" />
  }),
}))

vi.mock('../creation-history/creation-history-archive', () => ({
  syncCreationHistoryFromWorkflow: vi.fn(async () => undefined),
}))

function WorkflowStateProbe() {
  const state = useWorkflowState()
  const activePoster = state.posterEditor.active
  const activeDraft = activePoster
    ? state.posterEditor.drafts[activePoster.draftKey ?? activePoster.generationId]
    : null
  return (
    <output data-testid="workflow-state">
      {JSON.stringify({
        currentStep: state.currentStep,
        completedSteps: [...state.completedSteps],
        platformCopy: {
          copyDraft: state.platformCopy.copyDraft,
          platformCopy: state.platformCopy.platformCopy,
          completedDraft: state.platformCopy.completedDraft,
        },
        posterGeneration: {
          consent: state.posterGeneration.consent,
          admissionBusy: state.posterGeneration.admissionBusy,
          admissionError: state.posterGeneration.errors.admission,
          pollingError: state.posterGeneration.errors.polling,
          resultStatus: state.posterGeneration.result?.status ?? null,
          activeGenerationId: state.posterGeneration.activeGenerationId,
          pendingFingerprint: state.posterGeneration.pendingFingerprint,
          pendingIdempotencyKey:
            state.posterGeneration.pendingIdempotencyKey,
          pendingIntentPhase: state.posterGeneration.pendingIntentPhase,
          selectedIndex: state.posterGeneration.selectedIndex,
          selectedPosterId: state.posterGeneration.selectedPosterId,
          succeededOnce: state.posterGeneration.succeededOnce,
          completedDraft: state.posterGeneration.completedDraft,
        },
        posterEditor: {
          active: activePoster,
          draftLayout: activeDraft?.layout ?? null,
        },
        workflowV2: {
          phase: state.workflowV2.phase,
          view: state.workflowV2.view,
          epoch: state.workflowV2.epoch,
          basicTextSignatureSha256:
            state.workflowV2.basicAuthority?.text.signatureSha256 ?? null,
          adviceSignatureSha256:
            state.workflowV2.adviceAuthority?.adviceSignatureSha256 ?? null,
          confirmedCopy: state.workflowV2.confirmedCopy
            ? {
                revision: state.workflowV2.confirmedCopy.revision,
                outputSignatureSha256:
                  state.workflowV2.confirmedCopy.outputSignatureSha256,
              }
            : null,
          posterProject: state.workflowV2.posterProject
            ? {
                projectId: state.workflowV2.posterProject.projectId,
                projectIdentitySha256:
                  state.workflowV2.posterProject.projectIdentitySha256,
                inputSignatureSha256:
                  state.workflowV2.posterProject.inputSignatureSha256,
                copySource: state.workflowV2.posterProject.copySource,
                copyRef: state.workflowV2.posterProject.copyRef,
                generationKind: state.workflowV2.posterProject.generationKind,
                typographyMode: state.workflowV2.posterProject.typographyMode,
                styleTemplateId: state.workflowV2.posterProject.styleTemplateId,
              }
            : null,
          confirmedPoster: state.workflowV2.confirmedPoster,
        },
      })}
    </output>
  )
}

function renderApp(initialState: WorkflowState = createStepThreeState()) {
  return render(
    <WorkflowProvider initialState={initialState}>
      <App />
      <WorkflowStateProbe />
    </WorkflowProvider>,
  )
}

function readState() {
  return JSON.parse(screen.getByTestId('workflow-state').textContent ?? '{}')
}

function binaryResponse(kind: 'png' | 'zip' = 'png') {
  return new Response(kind === 'png' ? PNG_BYTES : ZIP_BYTES, {
    status: 200,
    headers: {
      'Content-Type': kind === 'png' ? 'image/png' : 'application/zip',
    },
  })
}

function requestKey(call: [RequestInfo | URL, RequestInit?]) {
  return new Headers(call[1]?.headers).get('X-Idempotency-Key')
}

function postCalls(fetchMock: ReturnType<typeof vi.fn<typeof fetch>>) {
  return fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

const V2_ADVICE: AdviceResult = {
  category_id: 'fmcg',
  category_name: 'Fixture category',
  confidence: 'high',
  matched_keywords: ['fixture'],
  reason: 'Fixture advice for rendered Poster source-switch coverage.',
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

async function createV2PosterState(
  options:
    | 'confirmed_copy'
    | 'poster_owned'
    | {
        copySource?: 'confirmed_copy' | 'poster_owned'
        generationKind?: 'blank_base' | 'template'
        typographyMode?: 'textless' | 'with_text'
        styleTemplateId?: 'paper_doodle_grid' | null
        includeConfirmedCopy?: boolean
      } = 'confirmed_copy',
) {
  const resolved =
    typeof options === 'string'
      ? {
          copySource: options,
          generationKind: 'blank_base' as const,
          typographyMode: 'textless' as const,
          styleTemplateId: null,
          includeConfirmedCopy: options === 'confirmed_copy',
        }
      : {
          copySource: options.copySource ?? 'confirmed_copy',
          generationKind: options.generationKind ?? 'blank_base',
          typographyMode: options.typographyMode ?? 'textless',
          styleTemplateId: options.styleTemplateId ?? null,
          includeConfirmedCopy: options.includeConfirmedCopy ?? true,
        }
  const state = createStepThreeState()
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
  const copyInput = await createCopyInputAuthority(basic, advice)
  const confirmedCopy = resolved.includeConfirmedCopy
    ? await createConfirmedCopy({
        copyInput,
        revision: 7,
        source: {
          kind: 'generated',
          requestFingerprintSha256: '3'.repeat(64),
          selectedVariantIndex: 0,
          variantSignatureSha256: '4'.repeat(64),
        },
        fields: {
          body: 'Frozen confirmed Copy body',
          title: 'Frozen title',
          headline: 'Frozen headline',
          subline: 'Frozen subline',
        },
      })
    : null
  const project = await createPosterProjectInput({
    projectId: `fixture-${resolved.copySource}-project`,
    basic,
    advice,
    copySource: resolved.copySource,
    copyRef:
      resolved.copySource === 'confirmed_copy' && confirmedCopy
        ? copyRefFromConfirmedCopy(confirmedCopy)
        : undefined,
    generationKind: resolved.generationKind,
    typographyMode: resolved.typographyMode,
    styleTemplateId: resolved.styleTemplateId,
  })
  return {
    ...state,
    workflowV2: {
      ...state.workflowV2,
      phase: 'active' as const,
      view: 'poster' as const,
      resumeView: 'workflow' as const,
      epoch: 17,
      basicAuthority: basic,
      adviceAuthority: advice,
      confirmedCopy,
      posterProject: project,
    },
  }
}

async function createV2PosterResultState(
  typographyMode: 'textless' | 'with_text',
  status: 'running' | 'completed' | 'failed' | 'partial_failed',
  slotStatuses: Array<'waiting' | 'generating' | 'ready' | 'failed' | 'blocked'>,
  selectFirst = false,
) {
  let state: WorkflowState = await createV2PosterState({
    generationKind: 'template',
    typographyMode,
    styleTemplateId: 'paper_doodle_grid',
  })
  state = workflowReducer(state, {
    type: 'APPLY_POSTER_RESULT',
    result: normalizedSequence(status, slotStatuses),
    source: 'admission',
    fingerprint: `fixture-${typographyMode}-${status}`,
  })
  if (selectFirst) {
    state = workflowReducer(state, { type: 'SELECT_POSTER_SLOT', index: 0 })
  }
  return state
}

function generationKindRadio(kind: 'blank_base' | 'template') {
  return screen.getByDisplayValue(kind) as HTMLInputElement
}

function typographyModeRadio(mode: 'textless' | 'with_text') {
  return screen.getByDisplayValue(mode) as HTMLInputElement
}

function templateRadio(option: 'smart_match' | 'paper_doodle_grid') {
  return screen.getByDisplayValue(option) as HTMLInputElement
}

describe('PosterGenerationStep', () => {
  let createObjectURL = vi.fn<(blob: Blob) => string>()
  let revokeObjectURL = vi.fn<(url: string) => void>()
  let anchorClick: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    createObjectURL = vi.fn<(blob: Blob) => string>()
    let objectUrlIndex = 0
    createObjectURL.mockImplementation(() => {
      objectUrlIndex += 1
      return `blob:poster-${objectUrlIndex}`
    })
    revokeObjectURL = vi.fn<(url: string) => void>()
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectURL,
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectURL,
    })
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ width: 1024, height: 1536, close: vi.fn() })),
    )
    anchorClick = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined)
  })

  afterEach(() => {
    anchorClick.mockRestore()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('renders exact initial consent, helper, active rail, and an enabled initial action', () => {
    renderApp(createStepThreeState({ consent: false }))
    expect(
      screen.getByRole('heading', { name: '步骤 3：生成海报' }),
    ).toBeVisible()
    expect(
      screen.getByLabelText(
        '我已知晓并同意：上传的商品参考图将发送至火山引擎方舟 Seedream，用于顺序生成三张完整广告海报。',
      ),
    ).not.toBeChecked()
    expect(
      screen.getByText('勾选授权后，点击「开始生成海报」。'),
    ).toBeVisible()
    expect(screen.getByRole('button', { name: '开始生成海报' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '上一步' })).toBeEnabled()
    expect(
      screen.getByRole('button', { name: '下一步：文字编辑' }),
    ).toBeDisabled()
    const rail = screen.getByRole('navigation', { name: 'Workflow V2 进度' })
    expect(within(rail).getAllByRole('listitem')).toHaveLength(3)
    expect(
      within(rail).getByRole('listitem', { name: '03 创作工作台' }),
    ).toHaveAttribute('aria-current', 'step')
    expect(within(rail).queryAllByRole('link')).toHaveLength(0)
    expect(screen.queryByRole('heading', { name: /步骤 4/ })).not.toBeInTheDocument()
  })

  it.each([
    { label: '无文字', typographyMode: 'textless' as const },
    { label: '有文字', typographyMode: 'with_text' as const },
  ])('renders the unified native-disabled footer before generation in $label mode', async ({ typographyMode }) => {
    renderApp(await createV2PosterState({
      generationKind: 'template',
      typographyMode,
      styleTemplateId: 'paper_doodle_grid',
    }))

    const previous = screen.getByRole('button', { name: '上一步' })
    const enterEditor = screen.getByRole('button', { name: '进入海报编辑' })
    const navigation = enterEditor.closest('.poster-generation-navigation')

    expect(previous).toBeEnabled()
    expect(enterEditor).toBeDisabled()
    expect(enterEditor).toHaveAttribute('disabled')
    expect(navigation).not.toBeNull()
    expect(within(navigation as HTMLElement).getAllByRole('button')).toEqual([
      previous,
      enterEditor,
    ])
    expect(screen.queryByRole('button', { name: '下载海报' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '确认使用并导出' })).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox')).toBeChecked()
    expect(screen.getByRole('button', { name: '生成海报' })).toBeEnabled()
  })

  it.each([
    { label: '无文字', typographyMode: 'textless' as const },
    { label: '有文字', typographyMode: 'with_text' as const },
  ])('keeps editor entry disabled while generation is pending and after failure in $label mode', async ({ typographyMode }) => {
    const user = userEvent.setup()
    const pendingPost = deferred<Response>()
    const fetchMock = vi.fn<typeof fetch>((_input, init) =>
      init?.method === 'POST'
        ? pendingPost.promise
        : Promise.resolve(binaryResponse()),
    )
    vi.stubGlobal('fetch', fetchMock)
    renderApp(await createV2PosterState({
      generationKind: 'template',
      typographyMode,
      styleTemplateId: 'paper_doodle_grid',
    }))

    const enterEditor = screen.getByRole('button', { name: '进入海报编辑' })
    await user.click(screen.getByRole('button', { name: '生成海报' }))
    await waitFor(() => expect(postCalls(fetchMock)).toHaveLength(1))
    expect(readState().posterGeneration.admissionBusy).toBe(true)
    expect(enterEditor).toBeDisabled()

    pendingPost.resolve(
      jsonResponse(sequenceDocument('failed', ['failed', 'failed', 'failed']), 202),
    )
    await waitFor(() => expect(readState().posterGeneration).toMatchObject({
      admissionBusy: false,
      resultStatus: 'failed',
      selectedIndex: null,
      selectedPosterId: null,
    }))
    expect(enterEditor).toBeDisabled()
    expect(postCalls(fetchMock)).toHaveLength(1)
  })

  it.each([
    { expectedTextBoxes: 'non-empty', label: '无文字', typographyMode: 'textless' as const },
    { expectedTextBoxes: 'empty', label: '有文字', typographyMode: 'with_text' as const },
  ])('uses the shared current-poster editor path after successful $label generation', async ({
    expectedTextBoxes,
    typographyMode,
  }) => {
    const user = userEvent.setup()
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) =>
      init?.method === 'POST'
        ? jsonResponse(sequenceDocument('completed', ['ready', 'ready', 'ready']), 202)
        : binaryResponse(),
    )
    vi.stubGlobal('fetch', fetchMock)
    renderApp(await createV2PosterState({
      generationKind: 'template',
      typographyMode,
      styleTemplateId: 'paper_doodle_grid',
    }))

    const enterEditor = screen.getByRole('button', { name: '进入海报编辑' })
    await user.click(screen.getByRole('button', { name: '生成海报' }))
    const selectPoster = (await screen.findAllByRole('button', { name: '选用此底图' }))[0]
    expect(enterEditor).toBeDisabled()
    await user.click(selectPoster)
    expect(enterEditor).toBeEnabled()
    expect(screen.queryByRole('button', { name: '下载海报' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '确认使用并导出' })).not.toBeInTheDocument()

    await user.click(enterEditor)
    await waitFor(() => expect(readState().currentStep).toBe(4))
    expect(window.location.pathname).toBe('/poster')
    expect(screen.getByTestId('mock-poster-editor-canvas')).toBeInTheDocument()

    const editor = readState().posterEditor
    expect(Object.keys(editor.active).sort()).toEqual([
      'baseBlobId',
      'baseBlobSha256',
      'copySnapshot',
      'downloadUrl',
      'draftKey',
      'generationId',
      'intrinsicHeight',
      'intrinsicWidth',
      'posterCopySource',
      'posterId',
      'posterProjectInputSignatureSha256',
      'resourceRevision',
      'slot',
      'upstreamSha256',
    ])
    expect(editor.active).toMatchObject({
      generationId: TEST_GENERATION_ID,
      posterId: TEST_POSTER_IDS[0],
      slot: 1,
      posterCopySource: 'confirmed_copy',
    })
    if (expectedTextBoxes === 'empty') {
      expect(editor.draftLayout.textBoxes).toEqual([])
    } else {
      expect(editor.draftLayout.textBoxes.length).toBeGreaterThan(0)
    }
  })

  it('invalidates a selected successful poster when the typography mode changes', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => binaryResponse()))
    renderApp(await createV2PosterResultState(
      'textless',
      'completed',
      ['ready', 'ready', 'ready'],
      true,
    ))

    const enterEditor = screen.getByRole('button', { name: '进入海报编辑' })
    expect(enterEditor).toBeEnabled()
    await user.click(typographyModeRadio('with_text'))
    expect(enterEditor).toBeDisabled()
    await waitFor(() => expect(typographyModeRadio('with_text')).toBeChecked())
    expect(readState().posterGeneration).toMatchObject({
      resultStatus: null,
      selectedIndex: null,
      selectedPosterId: null,
    })
    expect(enterEditor).toBeDisabled()
  })

  it('invalidates a selected successful poster when the style template changes', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => binaryResponse()))
    renderApp(await createV2PosterResultState(
      'textless',
      'completed',
      ['ready', 'ready', 'ready'],
      true,
    ))

    const enterEditor = screen.getByRole('button', { name: '进入海报编辑' })
    expect(enterEditor).toBeEnabled()
    await user.click(screen.getByDisplayValue('warm_collectible_poster'))
    expect(enterEditor).toBeDisabled()
    await waitFor(() => expect(screen.getByDisplayValue('warm_collectible_poster')).toBeChecked())
    expect(readState().posterGeneration).toMatchObject({
      resultStatus: null,
      selectedIndex: null,
      selectedPosterId: null,
    })
    expect(enterEditor).toBeDisabled()
  })

  it('renders accessible V2 template cards and switches semantic state without an API request', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetchMock)
    renderApp(await createV2PosterState({
      copySource: 'poster_owned',
      includeConfirmedCopy: false,
      generationKind: 'template',
      styleTemplateId: 'paper_doodle_grid',
    }))

    expect(screen.getByRole('group', { name: '海报风格模板' })).toBeVisible()
    expect(templateRadio('paper_doodle_grid')).toBeChecked()
    expect(screen.getByText('纸上奇想四格')).toBeVisible()
    expect(screen.getByText('暖白纸张、真实产品、黑色涂鸦与四宫格互动。')).toBeVisible()

    await user.click(generationKindRadio('blank_base'))
    await waitFor(() => expect(generationKindRadio('blank_base')).toBeChecked())
    expect(screen.queryByRole('group', { name: '海报风格模板' })).not.toBeInTheDocument()
    expect(readState().workflowV2.posterProject).toMatchObject({
      generationKind: 'blank_base',
      styleTemplateId: null,
      typographyMode: 'textless',
    })
    expect(postCalls(fetchMock)).toHaveLength(0)

    await user.click(generationKindRadio('template'))
    await waitFor(() => expect(generationKindRadio('template')).toBeChecked())
    expect(screen.getByRole('group', { name: '海报风格模板' })).toBeVisible()
    expect(readState().workflowV2.posterProject.styleTemplateId).toBe('paper_doodle_grid')
    expect(postCalls(fetchMock)).toHaveLength(0)
  })

  it('moves valid Step 2 Next into the real Step 3 and preserves edited body plus complete copy', async () => {
    const user = userEvent.setup()
    const initial = createStepThreeState()
    initial.currentStep = 2
    initial.completedSteps = new Set([1])
    initial.platformCopy.completedDraft = null
    initial.platformCopy.copyDraft = '最终手动正文'
    initial.platformCopy.platformCopy = {
      ...initial.platformCopy.platformCopy!,
      body: '最终手动正文',
      future: { still: 'here' },
    }
    initial.platformCopy.variants = [
      {
        ...initial.platformCopy.variants[0],
        future: { still: 'here' },
      },
    ]
    renderApp(initial)

    await user.click(screen.getByRole('button', { name: '下一步' }))

    expect(screen.getByRole('heading', { name: '步骤 3：生成海报' })).toBeVisible()
    const state = readState()
    expect(state.currentStep).toBe(3)
    expect(state.completedSteps).toEqual([1, 2])
    expect(state.platformCopy.completedDraft.platformCopy).toMatchObject({
      body: '最终手动正文',
      title: '保留标题',
      headline: '保留主标',
      subline: '保留副标',
      future: { still: 'here' },
    })
    expect(screen.queryByRole('heading', { name: /步骤 4/ })).not.toBeInTheDocument()
  })

  it('keeps Back enabled during accepted work and restores Step 3 state on return', async () => {
    const user = userEvent.setup()
    const result = normalizedSequence('running', [
      'ready',
      'generating',
      'waiting',
    ])
    const initial = createStepThreeState({
      result,
      activeGenerationId: result.generationId,
      selectedIndex: 0,
      selectedPosterId: result.posters[0].posterId,
      selectedSlot: result.posters[0],
    })
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(binaryResponse()),
    )
    renderApp(initial)

    const previous = screen.getByRole('button', { name: '上一步' })
    expect(previous).toBeEnabled()
    await user.click(previous)
    expect(screen.getByRole('heading', { name: '步骤 2：平台与文案' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: '下一步' }))
    expect(screen.getByRole('heading', { name: '步骤 3：生成海报' })).toBeVisible()
    expect(readState().posterGeneration).toMatchObject({
      resultStatus: 'running',
      activeGenerationId: TEST_GENERATION_ID,
      selectedIndex: 0,
      selectedPosterId: TEST_POSTER_IDS[0],
    })
  })

  it('shows sequence-disabled and unconfigured capability states with correct button rules', () => {
    const disabled = createStepThreeState()
    disabled.posterGeneration.capabilities = {
      status: 'ready',
      sequenceEnabled: false,
      seedreamConfigured: true,
      error: '',
    }
    const first = renderApp(disabled)
    expect(
      screen.getByText('Seedream 顺序生成当前未启用，无法生成海报。'),
    ).toBeVisible()
    expect(screen.getByRole('button', { name: '开始生成海报' })).toBeDisabled()
    first.unmount()

    const unconfigured = createStepThreeState()
    unconfigured.posterGeneration.capabilities = {
      status: 'ready',
      sequenceEnabled: true,
      seedreamConfigured: false,
      error: '',
    }
    renderApp(unconfigured)
    expect(
      screen.getByText('Seedream 当前未配置，完整海报顺序生成不可用。'),
    ).toBeVisible()
    expect(screen.getByRole('button', { name: '开始生成海报' })).toBeEnabled()
  })

  it('keeps health/capability failure local to Step 3', async () => {
    const initial = createStepThreeState()
    initial.posterGeneration.capabilities = {
      status: 'idle',
      sequenceEnabled: null,
      seedreamConfigured: null,
      error: '',
    }
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError('raw network failure'))
    vi.stubGlobal('fetch', fetchMock)
    renderApp(initial)
    expect(
      await screen.findByText('后端服务未启动，请先启动本地 API 服务。'),
    ).toBeVisible()
    expect(screen.getByRole('button', { name: '开始生成海报' })).toBeEnabled()
    expect(screen.getByRole('heading', { name: '步骤 3：生成海报' })).toBeVisible()
  })

  it.each([
    ['copy', '请先在上一步生成平台文案。'],
    ['product', '请填写产品信息。'],
    ['image', '请上传商品参考图。'],
    ['consent', '请先确认并同意商品参考图发送授权。'],
  ])('blocks missing %s before hashing, key creation, or fetch', async (kind, message) => {
    const user = userEvent.setup()
    const initial = createStepThreeState()
    if (kind === 'copy') {
      initial.platformCopy.completedDraft = null
    }
    if (kind === 'product') {
      initial.productInfo.values.productInfo = '  '
    }
    if (kind === 'image') {
      initial.productInfo.productImage = null
    }
    if (kind === 'consent') {
      initial.posterGeneration.consent = false
    }
    const fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetchMock)
    const randomUUID = vi.spyOn(globalThis.crypto, 'randomUUID')
    renderApp(initial)

    await user.click(screen.getByRole('button', { name: '开始生成海报' }))
    expect(screen.getByText(message)).toBeVisible()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(randomUUID).not.toHaveBeenCalled()
    randomUUID.mockRestore()
  })

  it('submits one valid sequence POST and displays queued state', async () => {
    const user = userEvent.setup()
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(sequenceDocument('queued'), 202))
    vi.stubGlobal('fetch', fetchMock)
    renderApp()

    await user.click(screen.getByRole('button', { name: '开始生成海报' }))
    expect(await screen.findByText('任务排队中…')).toBeVisible()
    expect(screen.getByText('正在为您加急生成中，请耐心等待哦~')).toBeVisible()
    expect(postCalls(fetchMock)).toHaveLength(1)
    expect(requestKey(postCalls(fetchMock)[0])).toMatch(/^[0-9a-f-]{36}$/i)
    expect(readState().posterGeneration).toMatchObject({
      resultStatus: 'queued',
      activeGenerationId: TEST_GENERATION_ID,
      pendingIntentPhase: 'accepted',
      admissionBusy: false,
    })
    expect(screen.getByRole('button', { name: '开始生成海报' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '上一步' })).toBeEnabled()
  })

  it('uses a synchronous lock across hashing and prevents duplicate-click POSTs', async () => {
    const user = userEvent.setup()
    let resolvePost: (response: Response) => void = () => undefined
    const fetchMock = vi.fn<typeof fetch>().mockReturnValue(
      new Promise<Response>((resolve) => {
        resolvePost = resolve
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    renderApp()
    const button = screen.getByRole('button', { name: '开始生成海报' })

    await user.dblClick(button)
    await waitFor(() => expect(postCalls(fetchMock)).toHaveLength(1))
    expect(button).toBeDisabled()
    resolvePost(jsonResponse(sequenceDocument('queued'), 202))
    await screen.findByText('任务排队中…')
    expect(postCalls(fetchMock)).toHaveLength(1)
  })

  it('lets an off-screen admission resolve and restores it with exactly one POST', async () => {
    const user = userEvent.setup()
    let resolvePost: (response: Response) => void = () => undefined
    const fetchMock = vi.fn<typeof fetch>().mockReturnValue(
      new Promise<Response>((resolve) => {
        resolvePost = resolve
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    renderApp()

    await user.click(screen.getByRole('button', { name: '开始生成海报' }))
    await waitFor(() => expect(postCalls(fetchMock)).toHaveLength(1))
    await user.click(screen.getByRole('button', { name: '上一步' }))
    expect(screen.getByRole('heading', { name: '步骤 2：平台与文案' })).toBeVisible()
    resolvePost(jsonResponse(sequenceDocument('queued'), 202))
    await waitFor(() => expect(readState().posterGeneration.admissionBusy).toBe(false))
    await user.click(screen.getByRole('button', { name: '下一步' }))
    expect(screen.getByText('任务排队中…')).toBeVisible()
    expect(postCalls(fetchMock)).toHaveLength(1)
  })

  it('keeps an off-screen safe admission error and makes no duplicate POST', async () => {
    const user = userEvent.setup()
    let rejectPost: (error: Error) => void = () => undefined
    const fetchMock = vi.fn<typeof fetch>().mockReturnValue(
      new Promise<Response>((_resolve, reject) => {
        rejectPost = reject
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    renderApp()

    await user.click(screen.getByRole('button', { name: '开始生成海报' }))
    await waitFor(() => expect(postCalls(fetchMock)).toHaveLength(1))
    await user.click(screen.getByRole('button', { name: '上一步' }))
    rejectPost(new TypeError('raw network'))
    await waitFor(() => expect(readState().posterGeneration.admissionBusy).toBe(false))
    await user.click(screen.getByRole('button', { name: '下一步' }))
    expect(
      screen.getByText('后端服务未启动，请先启动本地 API 服务。'),
    ).toBeVisible()
    expect(postCalls(fetchMock)).toHaveLength(1)
  })

  it('keeps V2 generation mode operable during a held generation and rejects a late Poster-owned result after switching to template mode', async () => {
    const user = userEvent.setup()
    const initial = await createV2PosterState({
      copySource: 'poster_owned',
      includeConfirmedCopy: false,
      generationKind: 'blank_base',
    })
    const oldProject = initial.workflowV2.posterProject!
    const pendingPost = deferred<Response>()
    const fetchMock = vi.fn<typeof fetch>((_input, init) =>
      init?.method === 'POST'
        ? pendingPost.promise
        : Promise.reject(new Error('unexpected request')),
    )
    vi.stubGlobal('fetch', fetchMock)
    renderApp(initial)

    await user.click(screen.getByRole('button', { name: '生成海报' }))
    await waitFor(() => expect(postCalls(fetchMock)).toHaveLength(1))
    expect(generationKindRadio('blank_base')).toBeEnabled()
    expect(generationKindRadio('template')).toBeEnabled()

    await user.click(generationKindRadio('template'))
    await waitFor(() => expect(generationKindRadio('template')).toBeChecked())
    const switched = readState()
    expect(switched.workflowV2.posterProject).toMatchObject({
      generationKind: 'template',
      styleTemplateId: 'paper_doodle_grid',
    })
    expect(switched.workflowV2.posterProject.projectId).not.toBe(oldProject.projectId)
    expect(switched.workflowV2.posterProject.projectIdentitySha256)
      .not.toBe(oldProject.projectIdentitySha256)

    pendingPost.resolve(jsonResponse(sequenceDocument('completed', ['ready', 'ready', 'ready']), 202))
    await waitFor(() => {
      const current = readState()
      expect(current.posterGeneration).toMatchObject({
        resultStatus: null,
        activeGenerationId: null,
        admissionBusy: false,
        admissionError: '',
        pollingError: '',
      })
    })
    expect(postCalls(fetchMock)).toHaveLength(1)
    expect(createObjectURL).not.toHaveBeenCalled()
  })

  it('rejects a late result after a template switch and leaves the new template project clean', async () => {
    const user = userEvent.setup()
    const initial = await createV2PosterState({
      copySource: 'poster_owned',
      includeConfirmedCopy: false,
      generationKind: 'template',
      styleTemplateId: 'paper_doodle_grid',
      typographyMode: 'textless',
    })
    const pendingPost = deferred<Response>()
    const fetchMock = vi.fn<typeof fetch>((_input, init) =>
      init?.method === 'POST'
        ? pendingPost.promise
        : Promise.reject(new Error('unexpected request')),
    )
    vi.stubGlobal('fetch', fetchMock)
    renderApp(initial)

    await user.click(screen.getByRole('button', { name: '生成海报' }))
    await waitFor(() => expect(postCalls(fetchMock)).toHaveLength(1))
    await user.click(typographyModeRadio('with_text'))
    await waitFor(() => expect(typographyModeRadio('with_text')).toBeChecked())
    expect(readState().workflowV2.posterProject.typographyMode).toBe('with_text')

    pendingPost.resolve(jsonResponse(sequenceDocument('completed', ['ready', 'ready', 'ready']), 202))
    await waitFor(() => expect(readState().posterGeneration).toMatchObject({
      resultStatus: null,
      activeGenerationId: null,
      admissionBusy: false,
      admissionError: '',
      pollingError: '',
    }))
    expect(postCalls(fetchMock)).toHaveLength(1)
    expect(createObjectURL).not.toHaveBeenCalled()
  })

  it('keeps V2 typography mode operable during a held generation and rejects a late failure after switching to textless', async () => {
    const user = userEvent.setup()
    const initial = await createV2PosterState({
      generationKind: 'template',
      styleTemplateId: 'paper_doodle_grid',
      typographyMode: 'with_text',
    })
    const oldProject = initial.workflowV2.posterProject!
    const pendingPost = deferred<Response>()
    const fetchMock = vi.fn<typeof fetch>((_input, init) =>
      init?.method === 'POST'
        ? pendingPost.promise
        : Promise.reject(new Error('unexpected request')),
    )
    vi.stubGlobal('fetch', fetchMock)
    renderApp(initial)

    await user.click(screen.getByRole('button', { name: '生成海报' }))
    await waitFor(() => expect(postCalls(fetchMock)).toHaveLength(1))
    expect(typographyModeRadio('with_text')).toBeEnabled()
    expect(typographyModeRadio('textless')).toBeEnabled()

    typographyModeRadio('textless').focus()
    await user.keyboard('[Space]')
    await waitFor(() => expect(typographyModeRadio('textless')).toBeChecked())
    const switched = readState()
    expect(switched.workflowV2.posterProject).toMatchObject({
      typographyMode: 'textless',
    })
    expect(switched.workflowV2.posterProject.projectId).not.toBe(oldProject.projectId)
    expect(switched.workflowV2.posterProject.projectIdentitySha256)
      .not.toBe(oldProject.projectIdentitySha256)

    pendingPost.reject(new Error('late old source failure'))
    await waitFor(() => {
      const current = readState()
      expect(current.posterGeneration).toMatchObject({
        resultStatus: null,
        activeGenerationId: null,
        admissionBusy: false,
        admissionError: '',
        pollingError: '',
      })
    })
    expect(postCalls(fetchMock)).toHaveLength(1)
    expect(createObjectURL).not.toHaveBeenCalled()
  })

  it('invalidates a late V2 Poster admission after the real return-to-Workspace control unmounts the module', async () => {
    const user = userEvent.setup()
    const initial = await createV2PosterState({
      copySource: 'poster_owned',
      includeConfirmedCopy: false,
    })
    const pendingPost = deferred<Response>()
    const fetchMock = vi.fn<typeof fetch>((_input, init) =>
      init?.method === 'POST'
        ? pendingPost.promise
        : Promise.reject(new Error('unexpected request')),
    )
    vi.stubGlobal('fetch', fetchMock)
    renderApp(initial)

    await user.click(screen.getByRole('button', { name: '生成海报' }))
    await waitFor(() => expect(postCalls(fetchMock)).toHaveLength(1))
    await user.click(screen.getByRole('button', { name: '上一步' }))
    expect(await screen.findByRole('heading', { name: '创作工作台' })).toBeVisible()

    pendingPost.resolve(jsonResponse(sequenceDocument('completed', ['ready', 'ready', 'ready']), 202))
    await waitFor(() => expect(readState().posterGeneration).toMatchObject({
      resultStatus: null,
      activeGenerationId: null,
      admissionBusy: false,
      admissionError: '',
      pollingError: '',
    }))
    expect(readState().workflowV2).toMatchObject({
      view: 'workspace',
      confirmedCopy: initial.workflowV2.confirmedCopy && {
        revision: initial.workflowV2.confirmedCopy.revision,
        outputSignatureSha256: initial.workflowV2.confirmedCopy.outputSignatureSha256,
      },
    })
    expect(createObjectURL).not.toHaveBeenCalled()
  })

  it('keeps V2 generation mode operable while polling and rejects a late successful poll after a mode switch', async () => {
    const user = userEvent.setup()
    const initial = await createV2PosterState({
      copySource: 'poster_owned',
      includeConfirmedCopy: false,
    })
    const pendingPoll = deferred<Response>()
    const fetchMock = vi.fn<typeof fetch>((input, init) => {
      if (init?.method === 'POST') {
        return Promise.resolve(jsonResponse(sequenceDocument('queued'), 202))
      }
      if (String(input) === `/api/v1/generations/${TEST_GENERATION_ID}`) {
        return pendingPoll.promise
      }
      return Promise.reject(new Error(`unexpected request ${String(input)}`))
    })
    vi.stubGlobal('fetch', fetchMock)
    renderApp(initial)

    await user.click(screen.getByRole('button', { name: '生成海报' }))
    await waitFor(() => expect(readState().posterGeneration.resultStatus).toBe('queued'))
    await waitFor(() => expect(
      fetchMock.mock.calls.filter(
        ([input, init]) => !init?.method && String(input) === `/api/v1/generations/${TEST_GENERATION_ID}`,
      ),
    ).toHaveLength(1), { timeout: 4_000 })
    expect(generationKindRadio('blank_base')).toBeEnabled()
    expect(generationKindRadio('template')).toBeEnabled()

    await user.click(generationKindRadio('template'))
    await waitFor(() => expect(generationKindRadio('template')).toBeChecked())
    pendingPoll.resolve(jsonResponse(sequenceDocument('completed', ['ready', 'ready', 'ready'])))
    await waitFor(() => expect(readState().posterGeneration).toMatchObject({
      resultStatus: null,
      activeGenerationId: null,
      pollingError: '',
    }))
    expect(postCalls(fetchMock)).toHaveLength(1)
    expect(createObjectURL).not.toHaveBeenCalled()
  })

  it('rejects a late failed poll after a keyboard typography switch without installing an error in the new project', async () => {
    const user = userEvent.setup()
    const initial = await createV2PosterState({
      generationKind: 'template',
      styleTemplateId: 'paper_doodle_grid',
      typographyMode: 'with_text',
    })
    const pendingPoll = deferred<Response>()
    const fetchMock = vi.fn<typeof fetch>((input, init) => {
      if (init?.method === 'POST') {
        return Promise.resolve(jsonResponse(sequenceDocument('queued'), 202))
      }
      if (String(input) === `/api/v1/generations/${TEST_GENERATION_ID}`) {
        return pendingPoll.promise
      }
      return Promise.reject(new Error(`unexpected request ${String(input)}`))
    })
    vi.stubGlobal('fetch', fetchMock)
    renderApp(initial)

    await user.click(screen.getByRole('button', { name: '生成海报' }))
    await waitFor(() => expect(readState().posterGeneration.resultStatus).toBe('queued'))
    await waitFor(() => expect(
      fetchMock.mock.calls.filter(
        ([input, init]) => !init?.method && String(input) === `/api/v1/generations/${TEST_GENERATION_ID}`,
      ),
    ).toHaveLength(1), { timeout: 4_000 })
    expect(typographyModeRadio('with_text')).toBeEnabled()
    expect(typographyModeRadio('textless')).toBeEnabled()

    typographyModeRadio('textless').focus()
    await user.keyboard('[Space]')
    await waitFor(() => expect(typographyModeRadio('textless')).toBeChecked())
    pendingPoll.resolve(jsonResponse({ error: { code: 'late_failure' } }, 500))
    await waitFor(() => expect(readState().posterGeneration).toMatchObject({
      resultStatus: null,
      activeGenerationId: null,
      admissionError: '',
      pollingError: '',
    }))
    expect(postCalls(fetchMock)).toHaveLength(1)
    expect(createObjectURL).not.toHaveBeenCalled()
  })

  it('reuses an ambiguous same-intent key and creates a new key after intent changes', async () => {
    const user = userEvent.setup()
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('ambiguous network loss'))
      .mockRejectedValueOnce(new TypeError('same intent retry'))
      .mockRejectedValueOnce(new TypeError('changed intent retry'))
    vi.stubGlobal('fetch', fetchMock)
    renderApp()
    const generate = screen.getByRole('button', { name: '开始生成海报' })

    await user.click(generate)
    await screen.findByText('后端服务未启动，请先启动本地 API 服务。')
    const firstKey = requestKey(postCalls(fetchMock)[0])
    await user.click(generate)
    await waitFor(() => expect(postCalls(fetchMock)).toHaveLength(2))
    expect(requestKey(postCalls(fetchMock)[1])).toBe(firstKey)

    await user.click(screen.getByRole('button', { name: '上一步' }))
    fireEvent.change(screen.getByLabelText('最终文案（可编辑）'), {
      target: { value: '变化后的手动正文' },
    })
    await user.click(screen.getByRole('button', { name: '下一步' }))
    await user.click(screen.getByRole('button', { name: '开始生成海报' }))
    await waitFor(() => expect(postCalls(fetchMock)).toHaveLength(3))
    expect(requestKey(postCalls(fetchMock)[2])).not.toBe(firstKey)
  })

  it('accepts a completed same-key 202 replay, clears intent, skips polling, and regenerates with a new key', async () => {
    const user = userEvent.setup()
    const initial = createStepThreeState()
    const payload = buildPosterSequencePayload(
      initial.productInfo.values,
      initial.platformCopy.completedDraft!,
    )
    const fingerprint = await sequenceIntentFingerprint(
      canonicalSequenceJson(payload),
      await initial.productInfo.productImage!.file.arrayBuffer(),
    )
    initial.posterGeneration.pendingFingerprint = fingerprint
    initial.posterGeneration.pendingIdempotencyKey = 'replay-key'
    initial.posterGeneration.pendingIntentPhase = 'ambiguous'

    let replayPostCount = 0
    const fetchMock = vi.fn<typeof fetch>((input, init): Promise<Response> => {
      if (init?.method === 'POST') {
        replayPostCount += 1
        return Promise.resolve(
          jsonResponse(
            replayPostCount === 1
              ? sequenceDocument('completed', ['ready', 'ready', 'ready'])
              : sequenceDocument('queued'),
            202,
          ),
        )
      }
      if (String(input).includes('/posters/')) {
        return Promise.resolve(binaryResponse())
      }
      return Promise.reject(new Error(`unexpected poll ${String(input)}`))
    })
    vi.stubGlobal('fetch', fetchMock)
    renderApp(initial)

    await user.click(screen.getByRole('button', { name: '开始生成海报' }))
    expect(await screen.findByText('三张海报已全部生成完成')).toBeVisible()
    expect(requestKey(postCalls(fetchMock)[0])).toBe('replay-key')
    expect(readState().posterGeneration).toMatchObject({
      pendingFingerprint: null,
      pendingIdempotencyKey: null,
      succeededOnce: true,
    })
    expect(screen.getByRole('button', { name: '重新生成' })).toBeEnabled()
    expect(
      fetchMock.mock.calls.filter(
        ([url, init]) =>
          !init?.method &&
          String(url) === `/api/v1/generations/${TEST_GENERATION_ID}`,
      ),
    ).toHaveLength(0)

    await user.click(screen.getByRole('button', { name: '重新生成' }))
    await waitFor(() => expect(postCalls(fetchMock)).toHaveLength(2))
    expect(requestKey(postCalls(fetchMock)[1])).not.toBe('replay-key')
  })

  it.each(['failed', 'partial_failed', 'interrupted'] as const)(
    'applies terminal same-key 202 replay %s, clears intent, performs no poll, and allows retry',
    async (status) => {
      const user = userEvent.setup()
      const initial = createStepThreeState({
        pendingFingerprint: 'pending-fingerprint',
        pendingIdempotencyKey: 'pending-key',
        pendingIntentPhase: 'ambiguous',
      })
      const imageBytes = await initial.productInfo.productImage!.file.arrayBuffer()
      const payload = buildPosterSequencePayload(
        initial.productInfo.values,
        initial.platformCopy.completedDraft!,
      )
      initial.posterGeneration.pendingFingerprint = await sequenceIntentFingerprint(
        canonicalSequenceJson(payload),
        imageBytes,
      )
      const slots =
        status === 'partial_failed'
          ? ['ready', 'failed', 'blocked']
          : ['failed', 'blocked', 'blocked']
      const fetchMock = vi.fn<typeof fetch>((input, init) => {
        if (init?.method === 'POST') {
          return Promise.resolve(jsonResponse(sequenceDocument(status, slots), 202))
        }
        if (String(input).includes('/posters/')) {
          return Promise.resolve(binaryResponse())
        }
        return Promise.reject(new Error(`unexpected poll ${String(input)}`))
      })
      vi.stubGlobal('fetch', fetchMock)
      renderApp(initial)
      await user.click(screen.getByRole('button', { name: '开始生成海报' }))
      await waitFor(() => expect(readState().posterGeneration.resultStatus).toBe(status))
      expect(requestKey(postCalls(fetchMock)[0])).toBe('pending-key')
      expect(readState().posterGeneration).toMatchObject({
        pendingFingerprint: null,
        pendingIdempotencyKey: null,
        succeededOnce: false,
      })
      expect(screen.getByRole('button', { name: '开始生成海报' })).toBeEnabled()
      expect(
        fetchMock.mock.calls.filter(
          ([url, init]) =>
            !init?.method &&
            String(url) === `/api/v1/generations/${TEST_GENERATION_ID}`,
        ),
      ).toHaveLength(0)
    },
  )
})

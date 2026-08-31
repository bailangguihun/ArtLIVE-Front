import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { WorkflowProvider } from '../../state/WorkflowProvider'
import { createInitialWorkflowState } from '../../state/workflow-reducer'
import type { WorkflowState } from '../../state/workflow-types'
import { useWorkflowState } from '../../state/use-workflow'
import {
  domainSeparatedSignatureSha256,
  marketingAdviceInputSignatureSha256,
} from '../../state/workflow-v2/workflow-v2-signatures'
import type { AdviceResult } from '../../state/workflow-v2/workflow-v2-types'
import {
  COPY_PLATFORM_MISMATCH_MESSAGE,
  COPY_STYLE_MISMATCH_MESSAGE,
  COPY_DRAFT_REQUIRED_MESSAGE,
  PRODUCT_INFO_MISSING_FOR_COPY_MESSAGE,
} from './validation'

const requestId = '123e4567-e89b-42d3-a456-426614174000'

function createStepTwoState(productInfo = '低温慢烘精品咖啡豆'): WorkflowState {
  const initial = createInitialWorkflowState()
  const values = {
    productInfo,
    productShortName: '晨光咖啡',
    creativeNote: '突出细腻香气',
  }
  return {
    ...initial,
    currentStep: 2,
    completedSteps: new Set([1]),
    productInfo: {
      ...initial.productInfo,
      values,
      errors: productInfo.trim() ? {} : { productInfo: '请先填写产品信息。' },
      completedDraft: productInfo.trim()
        ? { ...values, productImage: null }
        : null,
    },
    posterGeneration: {
      ...initial.posterGeneration,
      capabilities: {
        status: 'ready',
        sequenceEnabled: true,
        seedreamConfigured: true,
        error: '',
      },
    },
  }
}

function WorkflowStateProbe() {
  const state = useWorkflowState()
  return (
    <output data-testid="workflow-state">
      {JSON.stringify({
        currentStep: state.currentStep,
        completedSteps: [...state.completedSteps],
        productInfo: {
          values: state.productInfo.values,
          imageName: state.productInfo.productImage?.name ?? null,
        },
        platformCopy: state.platformCopy,
        workflowV2: {
          epoch: state.workflowV2.epoch,
          view: state.workflowV2.view,
          confirmedCopy: state.workflowV2.confirmedCopy,
          pendingCopy: state.workflowV2.pendingCopyRequest,
        },
      })}
    </output>
  )
}

function renderApp(initialState: WorkflowState = createStepTwoState()) {
  const result = render(
    <WorkflowProvider initialState={initialState}>
      <App />
      <WorkflowStateProbe />
    </WorkflowProvider>,
  )
  if (initialState.currentStep === 1) {
    fireEvent.click(screen.getByRole('button', { name: '开始新创作' }))
  }
  return result
}

function jsonResponse(document: unknown, status = 200) {
  return new Response(JSON.stringify(document), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function generatedResponse(bodies: string[], strategyName = '策略一') {
  return {
    request_id: requestId,
    marketing_copy_variants: bodies.map((body, index) => ({
      body,
      title: `标题${index + 1}`,
      headline: `主标${index + 1}`,
      subline: `副标${index + 1}`,
      preserved: { index },
    })),
    marketing_copy: { body: '主文案回退' },
    marketing_strategy: {
      name: strategyName,
      nested: { preserved: true },
    },
  }
}

const bridgeAdvice: AdviceResult = {
  category_id: 'luxury',
  category_name: '高端美妆',
  confidence: 'high',
  matched_keywords: ['口红'],
  reason: '测试桥接建议。',
  score: 1,
  strategy: {
    id: 'luxury',
    name: '桥接策略',
    examples: '测试方向。',
    traits: ['精致'],
    tactics: ['强调质感'],
    one_liner: '测试。',
  },
  source: 'desktop_ai_different_product_marketing_strategies',
}

async function marketingAdviceResponse(payload: {
  readonly product_info: string
  readonly product_short_name: string
  readonly creative_note: string
}) {
  const [input_signature_sha256, advice_signature_sha256] = await Promise.all([
    marketingAdviceInputSignatureSha256({
      productInfo: payload.product_info,
      productShortName: payload.product_short_name,
      creativeNote: payload.creative_note,
    }),
    domainSeparatedSignatureSha256('marketing-advice-output-v1', bridgeAdvice),
  ])
  return {
    api_version: 'v1',
    advice_version: 'catalog-v1',
    status: 'present',
    input_signature_sha256,
    advice_signature_sha256,
    advice: bridgeAdvice,
  }
}

function readState() {
  return JSON.parse(screen.getByTestId('workflow-state').textContent ?? '{}')
}

function requestKey(fetchMock: ReturnType<typeof vi.fn<typeof fetch>>, index: number) {
  return new Headers(fetchMock.mock.calls[index]?.[1]?.headers).get(
    'X-Idempotency-Key',
  )
}

describe('PlatformCopyStep', () => {
  let fetchMock = vi.fn<typeof fetch>()
  const createObjectURL = vi.fn<(blob: Blob) => string>()
  const revokeObjectURL = vi.fn<(url: string) => void>()

  beforeEach(() => {
    fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetchMock)
    createObjectURL.mockReset()
    revokeObjectURL.mockReset()
    createObjectURL
      .mockReturnValueOnce('blob:step-one-image')
      .mockReturnValueOnce('blob:step-one-image-restored')
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
    vi.unstubAllGlobals()
  })

  it('renders exact platform/style order, IDs, labels, and defaults', () => {
    renderApp()

    const platformGroup = screen.getByRole('group', { name: '投放平台' })
    const platformRadios = within(platformGroup).getAllByRole('radio')
    expect(platformRadios.map((radio) => radio.id)).toEqual([
      'xiaohongshu',
      'douyin',
      'taobao',
      'pinduoduo',
    ])
    expect(platformRadios.map((radio) => radio.parentElement?.textContent)).toEqual([
      '小红书',
      '抖音',
      '淘宝',
      '拼多多',
    ])
    expect(platformRadios[0]).toBeChecked()

    const styleGroup = screen.getByRole('group', { name: '文案风格' })
    const styleRadios = within(styleGroup).getAllByRole('radio')
    expect(styleRadios.map((radio) => radio.id)).toEqual(['premium', 'vibrant'])
    expect(styleRadios.map((radio) => radio.parentElement?.textContent)).toEqual([
      '高级质感',
      '爆款吸睛',
    ])
    expect(styleRadios[0]).toBeChecked()
  })

  it('starts empty with only the first validation message and disabled Next', () => {
    renderApp()

    expect(screen.queryByRole('group', { name: '选择文案' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('最终文案（可编辑）')).toHaveValue('')
    expect(screen.getByText(COPY_DRAFT_REQUIRED_MESSAGE)).toBeVisible()
    expect(screen.queryByText('请先点击「生成三版文案」。')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '下一步' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '生成三版文案' })).toBeEnabled()
  })

  it('uses the Round 5 Advice-to-Workspace bridge and preserves Basic values and the V2 Copy draft', async () => {
    const user = userEvent.setup()
    renderApp(createInitialWorkflowState())
    const image = new File(['retained-image'], 'retained.webp', {
      type: 'image/webp',
    })

    await user.type(screen.getByLabelText('产品信息'), '丝绒质感口红')
    await user.upload(screen.getByLabelText(/商品参考图上传 选择图片/), image)
    fetchMock.mockImplementation(async (url, init) => {
      if (String(url) === '/api/v1/marketing-advice') {
        return jsonResponse(await marketingAdviceResponse(JSON.parse(String(init?.body))))
      }
      return jsonResponse(generatedResponse(['初始候选文案']))
    })
    await user.click(screen.getByRole('button', { name: '下一步' }))

    expect(await screen.findByText('桥接策略')).toBeVisible()
    await user.click(screen.getByRole('button', { name: '继续创作' }))
    expect(await screen.findByRole('heading', { name: '创作工作台' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: '进入宣传文案' }))
    await user.click(screen.getByLabelText('抖音'))
    await user.click(screen.getByLabelText('爆款吸睛'))
    expect(await screen.findByRole('heading', { name: '宣传文案' })).toBeVisible()
    expect(screen.getByRole('button', { name: '确认生成' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: '确认生成' }))
    await screen.findByLabelText('最终文案')
    await user.clear(screen.getByLabelText('最终文案'))
    await user.type(screen.getByLabelText('最终文案'), '保留中的草稿')
    await user.click(screen.getByRole('button', { name: '返回创作工作台' }))
    await user.click(screen.getByRole('button', { name: '返回营销建议' }))
    await user.click(screen.getByRole('button', { name: '返回修改基本信息' }))

    expect(screen.getByLabelText('产品信息')).toHaveValue('丝绒质感口红')
    expect(screen.queryByLabelText('产品短名（可选）')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('创意补充（可选）')).not.toBeInTheDocument()
    expect(screen.getByText('已选择：retained.webp')).toBeVisible()
    expect(
      screen.getByRole('img', { name: '商品参考图预览：retained.webp' }),
    ).toHaveAttribute('src', 'blob:step-one-image')
    expect(createObjectURL).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: '下一步' }))
    expect(await screen.findByText('桥接策略')).toBeVisible()
    await user.click(screen.getByRole('button', { name: '继续创作' }))
    await user.click(screen.getByRole('button', { name: '进入宣传文案' }))
    expect(screen.getByLabelText('抖音')).toBeChecked()
    expect(screen.getByLabelText('爆款吸睛')).toBeChecked()
    expect(screen.getByText('您可以在此自由编辑选择的文案。')).toBeVisible()
    expect(screen.getByLabelText('最终文案')).toHaveValue(
      '保留中的草稿',
    )
    expect(readState().productInfo.imageName).toBe('retained.webp')
  })

  it('sends one exact Advice reference, confirms an owned Copy snapshot, and enables the Poster compatibility entry', async () => {
    const user = userEvent.setup()
    renderApp(createInitialWorkflowState())
    await user.type(screen.getByLabelText('产品信息'), '丝绒质感哑光口红')
    await user.upload(
      screen.getByLabelText(/商品参考图上传 选择图片/),
      new File(['copy-owned-image'], 'copy-owned.webp', { type: 'image/webp' }),
    )
    fetchMock.mockImplementation(async (url, init) => {
      if (String(url) === '/api/v1/marketing-advice') {
        return jsonResponse(await marketingAdviceResponse(JSON.parse(String(init?.body))))
      }
      return jsonResponse(generatedResponse(['当前营销方向下的宣传文案']))
    })

    await user.click(screen.getByRole('button', { name: '下一步' }))
    await screen.findByText('桥接策略')
    await user.click(screen.getByRole('button', { name: '继续创作' }))
    await user.click(screen.getByRole('button', { name: '进入宣传文案' }))

    expect(screen.getByRole('button', { name: '确认生成' })).toBeEnabled()
    expect(screen.queryByText('正在生成宣传文案…')).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: '确认生成' }))

    expect(await screen.findByLabelText('最终文案')).toHaveValue('当前营销方向下的宣传文案')
    expect(screen.queryByRole('button', { name: '生成宣传文案' })).toBeNull()
    expect(screen.queryByText('正在生成宣传文案…')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重新生成' })).toBeEnabled()
    expect(screen.queryByText('营销策略')).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const copyRequest = fetchMock.mock.calls[1]?.[1]
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe('/api/v1/generations')
    const payload = JSON.parse(String((copyRequest?.body as FormData).get('payload')))
    expect(payload).toMatchObject({
      product_info: '丝绒质感哑光口红',
      product_short_name: '',
      creative_note: '',
      visual_style: 'premium',
      target_platform: 'xiaohongshu',
      generate_poster: false,
      marketing_advice_ref: {
        advice_version: 'catalog-v1',
      },
    })
    expect(Object.keys(payload.marketing_advice_ref).sort()).toEqual([
      'advice_signature_sha256',
      'advice_version',
      'input_signature_sha256',
    ])
    expect(JSON.stringify(payload)).not.toContain('copy-owned.webp')
    expect(JSON.stringify(payload)).not.toContain('copy-owned-image')

    await user.clear(screen.getByLabelText('最终文案'))
    await user.type(screen.getByLabelText('最终文案'), '首次编辑、尚未确认的宣传文案')
    expect(screen.getByText('当前修改尚未确认')).toBeVisible()
    await user.click(screen.getByRole('button', { name: '确认宣传文案' }))
    expect(await screen.findByRole('heading', { name: '创作工作台' })).toBeVisible()
    const confirmed = readState().workflowV2.confirmedCopy
    expect(confirmed).toMatchObject({
      revision: 1,
      body: '首次编辑、尚未确认的宣传文案',
      platform: 'xiaohongshu',
      style: 'premium',
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await user.click(screen.getByRole('button', { name: '查看创作成果' }))
    expect(await screen.findByRole('heading', { name: '创作成果' })).toBeVisible()
    expect(await screen.findByRole('heading', { name: '推广文案' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: '返回创作工作台' }))
    await user.click(screen.getByRole('button', { name: '查看宣传文案' }))
    await user.clear(screen.getByLabelText('最终文案'))
    await user.type(screen.getByLabelText('最终文案'), '已编辑并确认的宣传文案')
    expect(screen.getByText('当前修改尚未确认')).toBeVisible()
    await user.click(screen.getByRole('button', { name: '确认宣传文案' }))
    expect(await screen.findByRole('heading', { name: '创作工作台' })).toBeVisible()
    await waitFor(() => expect(readState().workflowV2.confirmedCopy).toMatchObject({
      revision: 2,
      body: '已编辑并确认的宣传文案',
    }))
    expect(readState().platformCopy.completedDraft).toMatchObject({
      platform: 'xiaohongshu',
      style: 'premium',
      copyDraft: '已编辑并确认的宣传文案',
      platformCopy: { body: '已编辑并确认的宣传文案' },
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const copyTrigger = await screen.findByRole('button', { name: '查看宣传文案' })
    await waitFor(() => expect(copyTrigger).toHaveFocus())
    expect(screen.getByRole('button', { name: '进入海报创作' })).toBeEnabled()
  })

  it('confirms a generated V2 Copy into Workspace with copy-only Results and no duplicate request', async () => {
    const user = userEvent.setup()
    renderApp(createInitialWorkflowState())
    await user.type(screen.getByLabelText('产品信息'), 'Round 8B 确认导航商品')
    fetchMock.mockImplementation(async (url, init) => {
      if (String(url) === '/api/v1/marketing-advice') {
        return jsonResponse(await marketingAdviceResponse(JSON.parse(String(init?.body))))
      }
      return jsonResponse(generatedResponse(['Round 8B 当前确认文案']))
    })

    await user.click(screen.getByRole('button', { name: '下一步' }))
    await screen.findByText('桥接策略')
    await user.click(screen.getByRole('button', { name: '继续创作' }))
    await user.click(screen.getByRole('button', { name: '进入宣传文案' }))
    await user.click(screen.getByRole('button', { name: '确认生成' }))
    expect(await screen.findByLabelText('最终文案')).toHaveValue('Round 8B 当前确认文案')
    const beforeConfirmation = readState()

    await user.click(screen.getByRole('button', { name: '确认宣传文案' }))
    expect(await screen.findByRole('heading', { name: '创作工作台' })).toBeVisible()
    const afterConfirmation = readState()
    expect(afterConfirmation.workflowV2.confirmedCopy).toMatchObject({
      revision: 1,
      body: 'Round 8B 当前确认文案',
    })
    expect(afterConfirmation.workflowV2.view).toBe('workspace')
    expect(afterConfirmation.workflowV2.basicAuthority).toEqual(beforeConfirmation.workflowV2.basicAuthority)
    expect(afterConfirmation.workflowV2.adviceAuthority).toEqual(beforeConfirmation.workflowV2.adviceAuthority)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await user.click(screen.getByRole('button', { name: '查看创作成果' }))
    expect(await screen.findByRole('heading', { name: '推广文案' })).toBeVisible()
    expect(screen.queryByRole('heading', { name: '海报设计' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '详情页' })).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('fails safely, retries only on an explicit action, and ignores a late response after returning to the Workspace', async () => {
    let resolveCopy: ((value: Response) => void) | undefined
    const user = userEvent.setup()
    renderApp(createInitialWorkflowState())
    await user.type(screen.getByLabelText('产品信息'), '丝绒质感哑光口红')
    fetchMock
      .mockImplementationOnce(async (_url, init) => jsonResponse(
        await marketingAdviceResponse(JSON.parse(String(init?.body))),
      ))
      .mockRejectedValueOnce(new Error('offline copy provider'))
      .mockResolvedValueOnce(jsonResponse(generatedResponse(['重试后的文案'])))
    await user.click(screen.getByRole('button', { name: '下一步' }))
    await screen.findByText('桥接策略')
    await user.click(screen.getByRole('button', { name: '继续创作' }))
    await user.click(screen.getByRole('button', { name: '进入宣传文案' }))
    expect(screen.getByRole('button', { name: '确认生成' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: '确认生成' }))

    expect(await screen.findByRole('heading', { name: '宣传文案生成失败' })).toBeVisible()
    expect(screen.getByText('无法连接生成服务，请稍后重试。')).toBeVisible()
    await user.dblClick(screen.getByRole('button', { name: '重新生成' }))
    expect(await screen.findByLabelText('最终文案')).toHaveValue('重试后的文案')
    expect(fetchMock).toHaveBeenCalledTimes(3)

    await user.click(screen.getByRole('button', { name: '返回创作工作台' }))
    await user.click(screen.getByRole('button', { name: '返回营销建议' }))
    await user.click(screen.getByRole('button', { name: '返回修改基本信息' }))
    await user.click(screen.getByRole('button', { name: '下一步' }))
    await screen.findByText('桥接策略')
    await user.click(screen.getByRole('button', { name: '继续创作' }))
    await user.click(screen.getByRole('button', { name: '进入宣传文案' }))
    await user.click(screen.getByLabelText('抖音'))
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => {
      resolveCopy = resolve
    }))
    await user.click(screen.getByRole('button', { name: '确认生成' }))
    await waitFor(() => {
      expect(screen.getByText('正在生成宣传文案…')).toBeVisible()
    })
    await user.click(screen.getByRole('button', { name: '返回创作工作台' }))
    expect(await screen.findByRole('heading', { name: '创作工作台' })).toBeVisible()
    resolveCopy?.(jsonResponse(generatedResponse(['不得提交的迟到文案'])))
    await waitFor(() => expect(readState().workflowV2.pendingCopy).toBeNull())
    expect(readState().workflowV2.confirmedCopy).toBeNull()
    expect(screen.queryByText('不得提交的迟到文案')).not.toBeInTheDocument()
  })

  it('rejects an abnormal missing-product state without fetch', async () => {
    const user = userEvent.setup()
    renderApp(createStepTwoState('   '))

    await user.click(screen.getByRole('button', { name: '生成三版文案' }))

    expect(screen.getByText(PRODUCT_INFO_MISSING_FOR_COPY_MESSAGE)).toBeVisible()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([1, 2, 3])('renders %i valid returned variant(s)', async (count) => {
    const user = userEvent.setup()
    const bodies = Array.from({ length: count }, (_, index) => `返回方案${index + 1}`)
    fetchMock.mockResolvedValueOnce(jsonResponse(generatedResponse(bodies)))
    renderApp()

    await user.click(screen.getByRole('button', { name: '生成三版文案' }))

    const selector = await screen.findByRole('group', { name: '选择文案' })
    expect(within(selector).getAllByRole('radio')).toHaveLength(count)
    expect(within(selector).getAllByRole('button', { name: '选用' })).toHaveLength(
      count,
    )
    expect(screen.getByLabelText('最终文案（可编辑）')).toHaveValue('返回方案1')
  })

  it('uses marketing_copy when the variant list is unusable', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        request_id: requestId,
        marketing_copy_variants: [{ body: '   ' }, { invalid: true }],
        marketing_copy: {
          body: '单版回退文案',
          title: '回退标题',
          headline: '回退主标',
          subline: '回退副标',
        },
        marketing_strategy: { name: '回退策略' },
      }),
    )
    renderApp()

    await user.click(screen.getByRole('button', { name: '生成三版文案' }))

    await waitFor(() =>
      expect(screen.getByLabelText('最终文案（可编辑）')).toHaveValue(
        '单版回退文案',
      ),
    )
    const fallbackSelector = screen.getByRole('group', { name: '选择文案' })
    expect(within(fallbackSelector).getByText('单版回退文案')).toBeVisible()
    expect(within(fallbackSelector).getAllByRole('button', { name: '选用' })).toHaveLength(1)
    expect(readState().platformCopy.platformCopy).toMatchObject({
      body: '单版回退文案',
      title: '回退标题',
      headline: '回退主标',
      subline: '回退副标',
    })
  })

  it('filters blank bodies and preserves prior success after an empty result', async () => {
    const user = userEvent.setup()
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(generatedResponse(['保留方案一', '   ', '保留方案二'])),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          marketing_copy_variants: [{ body: ' ' }],
          marketing_copy: { body: '' },
          marketing_strategy: { name: '不应应用' },
        }),
      )
    renderApp()

    await user.click(screen.getByRole('button', { name: '生成三版文案' }))
    await waitFor(() =>
      expect(screen.getByLabelText('最终文案（可编辑）')).toHaveValue(
        '保留方案一',
      ),
    )
    expect(screen.getAllByRole('button', { name: '选用' })).toHaveLength(2)

    await user.click(screen.getByRole('button', { name: '生成三版文案' }))
    expect(await screen.findByText('文案生成结果为空，请重试。')).toBeVisible()
    const preservedSelector = screen.getByRole('group', { name: '选择文案' })
    expect(within(preservedSelector).getByText('保留方案一')).toBeVisible()
    expect(within(preservedSelector).getByText('保留方案二')).toBeVisible()
    expect(screen.getByLabelText('最终文案（可编辑）')).toHaveValue('保留方案一')
    expect(readState().platformCopy.marketingStrategy.name).toBe('策略一')
  })

  it('selects by native label and every Select button while preserving complete data', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(
      jsonResponse(generatedResponse(['方案正文一', '方案正文二', '方案正文三'])),
    )
    renderApp()
    await user.click(screen.getByRole('button', { name: '生成三版文案' }))
    await waitFor(() =>
      expect(screen.getByLabelText('最终文案（可编辑）')).toHaveValue(
        '方案正文一',
      ),
    )

    await user.click(screen.getByText('方案 2'))
    expect(screen.getByLabelText('最终文案（可编辑）')).toHaveValue('方案正文二')
    expect(readState().platformCopy.platformCopy).toMatchObject({
      body: '方案正文二',
      title: '标题2',
      headline: '主标2',
      subline: '副标2',
      preserved: { index: 1 },
    })

    const selectButtons = screen.getAllByRole('button', { name: '选用' })
    const expectedBodies = ['方案正文一', '方案正文二', '方案正文三']
    for (let index = 0; index < selectButtons.length; index += 1) {
      await user.click(selectButtons[index])
      expect(screen.getByLabelText('最终文案（可编辑）')).toHaveValue(
        expectedBodies[index],
      )
    }
  })

  it('edits only body, preserves title/headline/subline/strategy, and enforces 5000 chars', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(jsonResponse(generatedResponse(['原始正文'])))
    renderApp()
    await user.click(screen.getByRole('button', { name: '生成三版文案' }))
    const editor = await screen.findByLabelText('最终文案（可编辑）')

    await user.clear(editor)
    await user.type(editor, '手动编辑正文')
    expect(readState().platformCopy.platformCopy).toMatchObject({
      body: '手动编辑正文',
      title: '标题1',
      headline: '主标1',
      subline: '副标1',
    })
    expect(readState().platformCopy.marketingStrategy).toEqual({
      name: '策略一',
      nested: { preserved: true },
    })

    fireEvent.change(editor, { target: { value: '字'.repeat(5001) } })
    expect(editor).toHaveValue('字'.repeat(5000))
    expect(screen.getByText('5000 / 5000')).toBeVisible()
  })

  it('preserves results through platform/style mismatch and restores validity on return', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(jsonResponse(generatedResponse(['保留正文'])))
    renderApp()
    await user.click(screen.getByRole('button', { name: '生成三版文案' }))
    await waitFor(() =>
      expect(screen.getByLabelText('最终文案（可编辑）')).toHaveValue('保留正文'),
    )
    const next = screen.getByRole('button', { name: '下一步' })
    expect(next).toBeEnabled()

    await user.click(screen.getByLabelText('抖音'))
    expect(screen.getByText(COPY_PLATFORM_MISMATCH_MESSAGE)).toBeVisible()
    expect(
      within(screen.getByRole('group', { name: '选择文案' })).getByText(
        '保留正文',
      ),
    ).toBeVisible()
    expect(next).toBeDisabled()
    await user.click(screen.getByLabelText('小红书'))
    expect(screen.queryByText(COPY_PLATFORM_MISMATCH_MESSAGE)).not.toBeInTheDocument()
    expect(next).toBeEnabled()

    await user.click(screen.getByLabelText('爆款吸睛'))
    expect(screen.getByText(COPY_STYLE_MISMATCH_MESSAGE)).toBeVisible()
    expect(next).toBeDisabled()
    await user.click(screen.getByLabelText('高级质感'))
    expect(screen.queryByText(COPY_STYLE_MISMATCH_MESSAGE)).not.toBeInTheDocument()
    expect(next).toBeEnabled()
  })

  it('regeneration replaces variants, draft, markers, and strategy', async () => {
    const user = userEvent.setup()
    fetchMock
      .mockResolvedValueOnce(jsonResponse(generatedResponse(['旧正文'], '旧策略')))
      .mockResolvedValueOnce(
        jsonResponse(generatedResponse(['新正文一', '新正文二'], '新策略')),
      )
    renderApp()
    await user.click(screen.getByRole('button', { name: '生成三版文案' }))
    await waitFor(() =>
      expect(screen.getByLabelText('最终文案（可编辑）')).toHaveValue('旧正文'),
    )
    await user.click(screen.getByLabelText('爆款吸睛'))
    await user.click(screen.getByRole('button', { name: '生成三版文案' }))

    await waitFor(() =>
      expect(screen.getByLabelText('最终文案（可编辑）')).toHaveValue('新正文一'),
    )
    expect(screen.queryByText('旧正文')).not.toBeInTheDocument()
    expect(screen.getByLabelText('最终文案（可编辑）')).toHaveValue('新正文一')
    expect(readState().platformCopy).toMatchObject({
      generationPlatform: 'xiaohongshu',
      generationStyle: 'vibrant',
      marketingStrategy: { name: '新策略', nested: { preserved: true } },
    })
  })

  it('shows only safe API error fields plus a valid request ID', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          error: {
            code: 'copy_failed',
            message: '文案服务暂时不可用。',
            request_id: requestId,
            traceback: 'raw traceback must stay hidden',
          },
          body: '<html>secret</html>',
        },
        502,
      ),
    )
    renderApp()

    await user.click(screen.getByRole('button', { name: '生成三版文案' }))

    expect(
      await screen.findByText(`文案服务暂时不可用。（请求编号：${requestId}）`),
    ).toBeVisible()
    expect(screen.queryByText(/raw traceback|secret/)).not.toBeInTheDocument()
  })

  it('locks request intent and prevents a busy double-click from posting twice', async () => {
    const user = userEvent.setup()
    let fulfill: (response: Response) => void = () => undefined
    fetchMock.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        fulfill = resolve
      }),
    )
    renderApp()
    const generate = screen.getByRole('button', { name: '生成三版文案' })

    await user.dblClick(generate)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('button', { name: '正在生成三版文案…' })).toBeDisabled()
    expect(screen.getByLabelText('小红书')).toBeDisabled()
    expect(screen.getByLabelText('高级质感')).toBeDisabled()
    expect(screen.getByRole('button', { name: '上一步' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '下一步' })).toBeDisabled()

    fireEvent.change(screen.getByLabelText('抖音'), { target: { checked: true } })
    fulfill(jsonResponse(generatedResponse(['锁定结果'])))
    await waitFor(() =>
      expect(screen.getByLabelText('最终文案（可编辑）')).toHaveValue('锁定结果'),
    )
    expect(screen.getByLabelText('小红书')).toBeChecked()
    expect(readState().platformCopy.generationPlatform).toBe('xiaohongshu')
  })

  it('reuses a failed same-intent key, changes it with intent, and clears it on success', async () => {
    const user = userEvent.setup()
    fetchMock
      .mockRejectedValueOnce(new TypeError('network one'))
      .mockRejectedValueOnce(new TypeError('network two'))
      .mockRejectedValueOnce(new TypeError('network three'))
      .mockResolvedValueOnce(jsonResponse(generatedResponse(['成功结果'])))
    renderApp()
    const generate = screen.getByRole('button', { name: '生成三版文案' })

    await user.click(generate)
    await screen.findByText('无法连接生成服务，请稍后重试。')
    const firstKey = requestKey(fetchMock, 0)
    expect(firstKey).toBeTruthy()

    await user.click(generate)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(requestKey(fetchMock, 1)).toBe(firstKey)

    await user.click(screen.getByLabelText('爆款吸睛'))
    await user.click(generate)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    const changedKey = requestKey(fetchMock, 2)
    expect(changedKey).toBeTruthy()
    expect(changedKey).not.toBe(firstKey)

    await user.click(generate)
    await waitFor(() =>
      expect(screen.getByLabelText('最终文案（可编辑）')).toHaveValue('成功结果'),
    )
    expect(requestKey(fetchMock, 3)).toBe(changedKey)
    expect(readState().platformCopy.pendingCopyFingerprint).toBeNull()
    expect(readState().platformCopy.pendingIdempotencyKey).toBeNull()
  })

  it('stores a typed Step 2 completion and enters the real Step 3', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(jsonResponse(generatedResponse(['完成正文'])))
    renderApp()
    await user.click(screen.getByRole('button', { name: '生成三版文案' }))
    await waitFor(() =>
      expect(screen.getByLabelText('最终文案（可编辑）')).toHaveValue('完成正文'),
    )
    await user.click(screen.getByRole('button', { name: '下一步' }))

    const state = readState()
    expect(state.currentStep).toBe(3)
    expect(state.completedSteps).toEqual([1, 2])
    expect(state.platformCopy.completedDraft).toMatchObject({
      platform: 'xiaohongshu',
      style: 'premium',
      copyDraft: '完成正文',
      platformCopy: {
        body: '完成正文',
        title: '标题1',
        headline: '主标1',
        subline: '副标1',
      },
      selectedVariantIndex: 0,
      generationPlatform: 'xiaohongshu',
      generationStyle: 'premium',
      marketingStrategy: { name: '策略一', nested: { preserved: true } },
    })
    expect(screen.getByRole('heading', { name: '步骤 3：生成海报' })).toBeVisible()
    expect(screen.queryByRole('heading', { name: /步骤 4/ })).not.toBeInTheDocument()
  })
})

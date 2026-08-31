import { StrictMode } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { WorkflowProvider } from '../../state/WorkflowProvider'
import { useWorkflowDispatch, useWorkflowState } from '../../state/use-workflow'
import {
  domainSeparatedSignatureSha256,
  marketingAdviceInputSignatureSha256,
} from '../../state/workflow-v2/workflow-v2-signatures'
import type { AdviceResult } from '../../state/workflow-v2/workflow-v2-types'
import type {
  MarketingAdviceRequestPayload,
  MarketingAdviceResponsePayload,
} from './advice-api'
import { MarketingAdviceApiError } from './advice-api'

const apiMocks = vi.hoisted(() => ({
  fetchMarketingAdvice: vi.fn(),
}))
const createObjectURL = vi.fn(() => 'blob:marketing-advice-test')
const revokeObjectURL = vi.fn()

vi.mock('./advice-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./advice-api')>()
  return {
    ...actual,
    fetchMarketingAdvice: apiMocks.fetchMarketingAdvice,
  }
})

const baseAdvice: AdviceResult = {
  category_id: 'luxury',
  category_name: '高端美妆',
  confidence: 'high',
  matched_keywords: ['口红', '高级'],
  reason: '识别到口红与高级质感相关描述。',
  score: 12,
  strategy: {
    id: 'luxury',
    name: '质感价值表达',
    examples: '克制的黑金视觉与细节特写。',
    traits: ['克制', '精致'],
    tactics: ['强调材质', '突出仪式感'],
    one_liner: '以精致质感建立可信赖的高端印象。',
  },
  source: 'desktop_ai_different_product_marketing_strategies',
}

async function responseFor(
  request: MarketingAdviceRequestPayload,
  advice: AdviceResult = baseAdvice,
): Promise<MarketingAdviceResponsePayload> {
  const [input_signature_sha256, advice_signature_sha256] = await Promise.all([
    marketingAdviceInputSignatureSha256({
      productInfo: request.product_info,
      productShortName: request.product_short_name,
      creativeNote: request.creative_note,
    }),
    domainSeparatedSignatureSha256('marketing-advice-output-v1', advice),
  ])
  return {
    api_version: 'v1',
    advice_version: 'catalog-v1',
    status: 'present',
    input_signature_sha256,
    advice_signature_sha256,
    advice,
  }
}

function SessionResetProbe() {
  const dispatch = useWorkflowDispatch()
  const state = useWorkflowState()
  return (
    <>
      <button onClick={() => dispatch({ type: 'START_V2_CREATION' })} type="button">
        测试开始新创作
      </button>
      <output data-testid="advice-session-probe">
        {JSON.stringify({
          epoch: state.workflowV2.epoch,
          pending: state.workflowV2.pendingAdviceRequest?.requestId ?? null,
          view: state.workflowV2.view,
        })}
      </output>
    </>
  )
}

function renderApp({ strict = false, withResetProbe = false } = {}) {
  const content = (
    <WorkflowProvider>
      <App />
      {withResetProbe ? <SessionResetProbe /> : null}
    </WorkflowProvider>
  )
  return render(strict ? <StrictMode>{content}</StrictMode> : content)
}

async function startAndCompleteBasic(
  user: ReturnType<typeof userEvent.setup>,
  productInfo = '丝绒质感哑光口红',
) {
  await user.click(screen.getByRole('button', { name: '开始新创作' }))
  await user.type(screen.getByLabelText('产品信息'), productInfo)
  await user.click(screen.getByRole('button', { name: '下一步' }))
}

describe('MarketingAdviceStep', () => {
  beforeEach(() => {
    apiMocks.fetchMarketingAdvice.mockReset()
    apiMocks.fetchMarketingAdvice.mockImplementation((request) => responseFor(request))
    createObjectURL.mockClear()
    revokeObjectURL.mockClear()
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectURL,
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectURL,
    })
  })

  it('submits exactly the three Basic text fields once and renders a validated success result', async () => {
    const user = userEvent.setup()
    renderApp()

    await startAndCompleteBasic(user)

    await screen.findByText('质感价值表达')
    const adviceHeading = screen.getByRole('heading', { name: '营销建议' })
    await waitFor(() => expect(adviceHeading).toHaveFocus())
    expect(screen.getByText('推荐策略')).toBeVisible()
    expect(screen.getByText('质感价值表达')).toBeVisible()
    expect(screen.queryByText('商品类别')).toBeNull()
    expect(screen.queryByText('匹配置信度')).toBeNull()
    expect(apiMocks.fetchMarketingAdvice).toHaveBeenCalledTimes(1)
    expect(apiMocks.fetchMarketingAdvice.mock.calls[0]?.[0]).toEqual({
      product_info: '丝绒质感哑光口红',
      product_short_name: '',
      creative_note: '',
    })
    expect(Object.keys(apiMocks.fetchMarketingAdvice.mock.calls[0]?.[0] ?? {})).toEqual([
      'product_info',
      'product_short_name',
      'creative_note',
    ])
  })

  it('uses the same current advice after unchanged, platform-only, and image-only Basic submissions', async () => {
    const user = userEvent.setup()
    renderApp()

    await startAndCompleteBasic(user)
    await screen.findByText('质感价值表达')
    await user.click(screen.getByRole('button', { name: '返回修改基本信息' }))
    await user.click(screen.getByRole('button', { name: '下一步' }))
    await screen.findByText('质感价值表达')
    expect(apiMocks.fetchMarketingAdvice).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: '返回修改基本信息' }))
    await user.click(screen.getByRole('button', { name: '下一步' }))
    await screen.findByText('质感价值表达')
    expect(apiMocks.fetchMarketingAdvice).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: '继续创作' }))
    await screen.findByRole('heading', { name: '创作工作台' })
    await user.click(screen.getByRole('button', { name: '进入宣传文案' }))
    await user.click(screen.getByLabelText('抖音'))
    await user.click(screen.getByRole('button', { name: '返回创作工作台' }))
    await user.click(screen.getByRole('button', { name: '返回营销建议' }))
    await screen.findByText('质感价值表达')
    expect(apiMocks.fetchMarketingAdvice).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: '返回修改基本信息' }))
    await user.upload(
      screen.getByLabelText(/商品参考图上传 选择图片/),
      new File(['image-bytes'], 'same-metadata.png', { type: 'image/png' }),
    )
    await user.click(screen.getByRole('button', { name: '下一步' }))
    await screen.findByText('质感价值表达')
    expect(apiMocks.fetchMarketingAdvice).toHaveBeenCalledTimes(1)
  })

  it('requests new Advice after text changes, deduplicates double submit under StrictMode, and keeps loading announced', async () => {
    const first = await responseFor({
      product_info: '丝绒质感哑光口红',
      product_short_name: '',
      creative_note: '',
    })
    let resolveFirst: ((value: MarketingAdviceResponsePayload) => void) | undefined
    apiMocks.fetchMarketingAdvice.mockImplementationOnce(() => new Promise((resolve) => {
      resolveFirst = resolve
    }))
    apiMocks.fetchMarketingAdvice.mockImplementation((request) => responseFor(request))
    const user = userEvent.setup()
    renderApp({ strict: true })

    await user.click(screen.getByRole('button', { name: '开始新创作' }))
    await user.type(screen.getByLabelText('产品信息'), '丝绒质感哑光口红')
    const next = screen.getByRole('button', { name: '下一步' })
    await user.dblClick(next)
    expect(await screen.findByRole('status')).toHaveTextContent('正在生成营销建议…')
    expect(apiMocks.fetchMarketingAdvice).toHaveBeenCalledTimes(1)
    resolveFirst?.(first)
    await screen.findByText('质感价值表达')

    await user.click(screen.getByRole('button', { name: '返回修改基本信息' }))
    await user.clear(screen.getByLabelText('产品信息'))
    await user.type(screen.getByLabelText('产品信息'), '丝绒奶油腮红')
    await user.click(screen.getByRole('button', { name: '下一步' }))
    await screen.findByText('质感价值表达')
    expect(apiMocks.fetchMarketingAdvice).toHaveBeenCalledTimes(2)
  })

  it('shows safe error copy, retries once, and never treats an error as Advice authority', async () => {
    apiMocks.fetchMarketingAdvice
      .mockRejectedValueOnce(new MarketingAdviceApiError('network_server'))
      .mockImplementation((request) => responseFor(request))
    const user = userEvent.setup()
    renderApp()

    await startAndCompleteBasic(user)
    expect(await screen.findByRole('alert')).toHaveTextContent('暂时无法生成建议，请稍后重试。')
    await user.dblClick(screen.getByRole('button', { name: '重新生成' }))
    expect(await screen.findByText('质感价值表达')).toBeVisible()
    expect(apiMocks.fetchMarketingAdvice).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['validation', '商品信息不符合要求，请返回修改后重试。'],
    ['protocol', '建议数据校验失败，请重新生成。'],
  ] as const)('maps %s failures to safe, non-diagnostic UI copy', async (kind, message) => {
    apiMocks.fetchMarketingAdvice.mockRejectedValueOnce(new MarketingAdviceApiError(kind))
    const user = userEvent.setup()
    renderApp()

    await startAndCompleteBasic(user)
    expect(await screen.findByRole('alert')).toHaveTextContent(message)
  })

  it('renders low-confidence and empty-keyword guidance as a successful result', async () => {
    const lowAdvice: AdviceResult = {
      ...baseAdvice,
      category_id: 'fmcg',
      category_name: '快消品',
      confidence: 'low',
      matched_keywords: [],
      strategy: { ...baseAdvice.strategy, id: 'fmcg' },
    }
    apiMocks.fetchMarketingAdvice.mockImplementation((request) => responseFor(request, lowAdvice))
    const user = userEvent.setup()
    renderApp()

    await startAndCompleteBasic(user)
    expect(await screen.findByText('当前建议置信度较低，可返回补充商品信息后重新生成。')).toBeVisible()
    expect(screen.queryByText('商品类别')).toBeNull()
  })

  it('keeps response text as text and carries only current Advice into the Workspace', async () => {
    const unsafeAdvice: AdviceResult = {
      ...baseAdvice,
      strategy: {
        ...baseAdvice.strategy,
        name: '<img src=x onerror=alert(1)>',
      },
    }
    apiMocks.fetchMarketingAdvice.mockImplementation((request) => responseFor(request, unsafeAdvice))
    const user = userEvent.setup()
    renderApp()

    await startAndCompleteBasic(user)
    expect(await screen.findByText('<img src=x onerror=alert(1)>')).toBeVisible()
    expect(document.querySelector('img[src="x"]')).toBeNull()
    await user.click(screen.getByRole('button', { name: '继续创作' }))
    expect(await screen.findByRole('heading', { name: '创作工作台' })).toBeVisible()
    expect(screen.getByText('宣传文案')).toBeVisible()
    expect(screen.getByText('海报创作')).toBeVisible()
    expect(screen.getByText('详情页编辑')).toBeVisible()
    await user.click(screen.getByRole('button', { name: '进入宣传文案' }))
    const platformGroup = screen.getByRole('group', { name: '投放平台' })
    expect(within(platformGroup).getByText('小红书')).toBeVisible()
    const styleGroup = screen.getByRole('group', { name: '文案风格' })
    expect(within(styleGroup).getByText('高级质感')).toBeVisible()
  })

  it('aborts an owned pending request when returning to Basic and rejects its late completion', async () => {
    let resolveRequest: ((value: MarketingAdviceResponsePayload) => void) | undefined
    apiMocks.fetchMarketingAdvice.mockImplementation((_request) => new Promise((resolve) => {
      void _request
      resolveRequest = resolve
    }))
    const user = userEvent.setup()
    renderApp()

    await startAndCompleteBasic(user)
    await screen.findByText('正在生成营销建议…')
    await user.click(screen.getByRole('button', { name: '返回修改基本信息' }))
    expect(screen.getByRole('heading', { name: '01 基本信息' })).toBeVisible()
    resolveRequest?.(await responseFor({
      product_info: '丝绒质感哑光口红',
      product_short_name: '',
      creative_note: '',
    }))
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: '01 基本信息' })).toBeVisible()
    })
  })

  it('aborts a pending Advice request and raises the epoch on an atomic new creation', async () => {
    let signal: AbortSignal | undefined
    apiMocks.fetchMarketingAdvice.mockImplementation((_request, options) => {
      signal = options?.signal
      return new Promise(() => {})
    })
    const user = userEvent.setup()
    renderApp({ withResetProbe: true })

    await startAndCompleteBasic(user)
    await screen.findByText('正在生成营销建议…')
    expect(JSON.parse(screen.getByTestId('advice-session-probe').textContent ?? '')).toMatchObject({
      epoch: 1,
      pending: expect.any(String),
      view: 'advice',
    })
    await user.click(screen.getByRole('button', { name: '测试开始新创作' }))
    expect(signal?.aborted).toBe(true)
    expect(screen.getByRole('heading', { name: '01 基本信息' })).toBeVisible()
    expect(JSON.parse(screen.getByTestId('advice-session-probe').textContent ?? '')).toEqual({
      epoch: 2,
      pending: null,
      view: 'workflow',
    })
  })

  it('restores a current Advice screen from Home without refetching it', async () => {
    const user = userEvent.setup()
    renderApp()

    await startAndCompleteBasic(user)
    await screen.findByText('质感价值表达')
    await user.click(screen.getByRole('button', { name: '图文智绘，返回首页' }))
    expect(await screen.findByRole('heading', { name: '从营销建议，到完整视觉成品。' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: '继续本轮创作' }))
    expect(await screen.findByText('质感价值表达')).toBeVisible()
    expect(apiMocks.fetchMarketingAdvice).toHaveBeenCalledTimes(1)
  })

  it('does not duplicate editable platform or style controls on the Advice screen', async () => {
    const user = userEvent.setup()
    renderApp()

    await startAndCompleteBasic(user)
    await screen.findByText('质感价值表达')
    expect(screen.queryByRole('group', { name: '投放平台' })).toBeNull()
    expect(screen.queryByRole('group', { name: '文案风格' })).toBeNull()
  })
})

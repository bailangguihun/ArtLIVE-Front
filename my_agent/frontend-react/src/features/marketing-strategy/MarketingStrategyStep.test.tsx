import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkflowProvider } from '../../state/WorkflowProvider'
import { workflowReducer } from '../../state/workflow-reducer'
import { useWorkflowState } from '../../state/use-workflow'
import type { WorkflowState } from '../../state/workflow-types'
import { MISSING_STRATEGY_COPY } from '../../types/marketing-strategy'
import { MarketingStrategyStep } from './MarketingStrategyStep'
import { createStepSixState } from './marketing-strategy-test-utils'

let observed: WorkflowState | null = null

function StateProbe() {
  const state = useWorkflowState()
  useEffect(() => { observed = state }, [state])
  return (
    <output
      data-completion={state.marketingStrategyStep.completion ? 'true' : 'false'}
      data-step={state.currentStep}
      data-testid="strategy-state"
    />
  )
}

function renderStep(state = createStepSixState()) {
  return render(
    <WorkflowProvider initialState={state}>
      <MarketingStrategyStep />
      <StateProbe />
    </WorkflowProvider>,
  )
}

function populatedState(): WorkflowState {
  const base = createStepSixState()
  return {
    ...base,
    platformCopy: {
      ...base.platformCopy,
      marketingStrategy: {
        category_name: '食品饮料',
        confidence: 'high',
        reason: '根据关键词命中判定为「食品饮料」。',
        matched_keywords: ['咖啡', '精品豆'],
        strategy: {
          name: '食品饮料',
          examples: '咖啡、茶饮与轻食',
          one_liner: '让香气成为购买理由。',
          traits: ['高频消费', '感官决策'],
          tactics: ['强调产地与工艺', '用冲煮场景降低决策成本'],
        },
      },
    },
  }
}

describe('MarketingStrategyStep', () => {
  afterEach(() => {
    observed = null
    vi.unstubAllGlobals()
  })

  it('renders the exact populated Step 6 hierarchy and ordered legacy semantics', () => {
    renderStep(populatedState())
    expect(screen.getByRole('heading', { level: 1, name: '步骤 6：营销策略' })).toBeVisible()
    const platform = screen.getByRole('region', { name: '投放平台' })
    const strategy = screen.getByRole('region', { name: '产品品类与营销策略' })
    expect(within(platform).getByText('小红书')).toBeVisible()
    expect(strategy.querySelector('.marketing-strategy-summary')).toHaveTextContent(
      '判定品类：食品饮料｜置信度：high｜根据关键词命中判定为「食品饮料」。',
    )
    expect(strategy.querySelector('.marketing-strategy-keywords')).toHaveTextContent('命中关键词：咖啡、精品豆')
    expect(within(strategy).getByText('咖啡、茶饮与轻食')).toBeVisible()
    expect(within(strategy).getByText('让香气成为购买理由。')).toBeVisible()
    expect(within(strategy).getByRole('heading', { level: 3, name: '核心特点' })).toBeVisible()
    expect(within(strategy).getByRole('heading', { level: 3, name: '建议营销策略' })).toBeVisible()
    expect(within(strategy).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      '高频消费',
      '感官决策',
      '强调产地与工艺',
      '用冲煮场景降低决策成本',
    ])
    expect(screen.queryByText(MISSING_STRATEGY_COPY)).not.toBeInTheDocument()
  })

  it('renders the exact single missing presentation for absent strategy data', () => {
    const base = createStepSixState()
    const state: WorkflowState = {
      ...base,
      platformCopy: { ...base.platformCopy, marketingStrategy: {} },
      posterGeneration: {
        ...base.posterGeneration,
        result: { ...base.posterGeneration.result!, marketingStrategy: {} },
      },
    }
    renderStep(state)
    expect(screen.getAllByText(MISSING_STRATEGY_COPY)).toHaveLength(1)
    expect(screen.queryByRole('heading', { level: 3 })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '上一步' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '下一步：最终结果' })).toBeEnabled()
  })

  it('fails malformed higher-priority content closed without exposing raw JSON', () => {
    const base = createStepSixState()
    const state: WorkflowState = {
      ...base,
      platformCopy: {
        ...base.platformCopy,
        marketingStrategy: { provider_payload: { secret: 'raw-object-value' } },
      },
      posterGeneration: {
        ...base.posterGeneration,
        result: {
          ...base.posterGeneration.result!,
          marketingStrategy: { name: '不应回退显示' },
          targetPlatform: 'xiaohongshu',
          targetPlatformResolution: 'known',
        },
      },
    }
    renderStep(state)
    expect(screen.getByText(MISSING_STRATEGY_COPY)).toBeVisible()
    expect(screen.queryByText(/raw-object-value|不应回退显示/)).not.toBeInTheDocument()
  })

  it('escapes HTML and only activates safe inline Markdown links', () => {
    const base = createStepSixState()
    const state: WorkflowState = {
      ...base,
      platformCopy: {
        ...base.platformCopy,
        marketingStrategy: {
          name: '<img src=x onerror=alert(1)>',
          one_liner: '**可信强调** 与 `明确代码` [安全链接](https://example.com/path) [危险链接](javascript:alert(1)) <script>bad()</script>',
        },
      },
    }
    const view = renderStep(state)
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeVisible()
    expect(screen.getByText('可信强调', { selector: 'strong' })).toBeVisible()
    expect(screen.getByText('明确代码', { selector: 'code' })).toBeVisible()
    expect(screen.getByRole('link', { name: '安全链接' })).toHaveAttribute('href', 'https://example.com/path')
    expect(screen.queryByRole('link', { name: '危险链接' })).not.toBeInTheDocument()
    expect(screen.getByText(/<script>bad\(\)<\/script>/)).toBeVisible()
    expect(view.container.querySelector('img')).toBeNull()
    expect(view.container.querySelector('script')).toBeNull()
  })

  it('does not truncate long ordered source lists', () => {
    const base = createStepSixState()
    const tactics = Array.from({ length: 24 }, (_, index) => `策略 ${index + 1}`)
    renderStep({
      ...base,
      platformCopy: {
        ...base.platformCopy,
        marketingStrategy: { name: '长内容', tactics },
      },
    })
    const list = screen.getByRole('heading', { name: '建议营销策略' }).parentElement!
    expect(within(list).getAllByRole('listitem')).toHaveLength(24)
    expect(within(list).getByText('策略 24')).toBeVisible()
  })

  it('stores completion, enters Step 7 once, and makes double activation harmless', async () => {
    const user = userEvent.setup()
    renderStep(populatedState())
    const next = screen.getByRole('button', { name: '下一步：最终结果' })
    await user.dblClick(next)
    expect(screen.getByTestId('strategy-state')).toHaveAttribute('data-step', '7')
    expect(screen.getByTestId('strategy-state')).toHaveAttribute('data-completion', 'true')
    expect(document.querySelector('.marketing-strategy-step')).not.toBeInTheDocument()
    expect(observed?.completedSteps.has(7)).toBe(false)
  })

  it('returns from a retained Step 6 completion to Step 5 without discarding drafts', async () => {
    const user = userEvent.setup()
    const completed = workflowReducer(populatedState(), { type: 'COMPLETE_STEP_SIX' })
    const stepSix = workflowReducer(completed, { type: 'GO_TO_STEP_SIX' })
    renderStep(stepSix)
    const completion = observed?.marketingStrategyStep.completion
    const pages = observed?.detailEditor.pages
    await user.click(screen.getByRole('button', { name: '上一步' }))
    expect(screen.getByTestId('strategy-state')).toHaveAttribute('data-step', '5')
    expect(screen.queryByRole('heading', { name: '步骤 6：营销策略' })).not.toBeInTheDocument()
    expect(observed?.marketingStrategyStep.completion).toBe(completion)
    expect(observed?.detailEditor.pages).toBe(pages)
  })

  it('does not issue API requests, timers, or generation side effects', () => {
    const fetchMock = vi.fn()
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout')
    const intervalSpy = vi.spyOn(globalThis, 'setInterval')
    vi.stubGlobal('fetch', fetchMock)
    renderStep(populatedState())
    fireEvent.click(screen.getByRole('button', { name: '下一步：最终结果' }))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(timeoutSpy).not.toHaveBeenCalled()
    expect(intervalSpy).not.toHaveBeenCalled()
    timeoutSpy.mockRestore()
    intervalSpy.mockRestore()
  })

  it('renders no Step 6 surface for a direct state without Step 5 authority', () => {
    const base = createStepSixState()
    renderStep({
      ...base,
      completedSteps: new Set([...base.completedSteps].filter((step) => step !== 5)),
    })
    expect(screen.queryByRole('heading', { name: '步骤 6：营销策略' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '下一步：最终结果' })).not.toBeInTheDocument()
  })
})

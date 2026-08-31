import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import App from '../App'
import { createInitialWorkflowState } from '../state/workflow-reducer'
import { WorkflowProvider } from '../state/WorkflowProvider'
import type { WorkflowState } from '../state/workflow-types'
import { WorkflowRail } from './WorkflowRail'

const expectedStageLabels = [
  '01 基本信息',
  '02 营销建议',
  '03 创作工作台',
]

const obsoleteLabels = [
  '1. 产品信息',
  '2. 平台与文案',
  '3. 生成海报',
  '4. 文字编辑',
  '5. 详情页制作',
  '6. 营销策略',
  '7. 最终结果',
]

function activeState(
  view: Exclude<WorkflowState['workflowV2']['view'], 'home'>,
): WorkflowState {
  const initial = createInitialWorkflowState()
  return {
    ...initial,
    workflowV2: {
      ...initial.workflowV2,
      phase: 'active',
      view,
      resumeView: view,
      epoch: 1,
    },
  }
}

function renderRail(view: Exclude<WorkflowState['workflowV2']['view'], 'home'>) {
  return render(
    <WorkflowProvider initialState={activeState(view)}>
      <WorkflowRail />
    </WorkflowProvider>,
  )
}

function renderApp() {
  const result = render(
    <WorkflowProvider>
      <App />
    </WorkflowProvider>,
  )
  fireEvent.click(screen.getByRole('button', { name: '开始新创作' }))
  return result
}

describe('WorkflowRail', () => {
  it('renders exactly the three Workflow V2 stages and none of the obsolete seven labels', () => {
    renderRail('workflow')
    const rail = screen.getByRole('navigation', { name: 'Workflow V2 进度' })
    const items = within(rail).getAllByRole('listitem')

    expect(items).toHaveLength(3)
    expect(items.map((item) => item.getAttribute('aria-label'))).toEqual(expectedStageLabels)
    for (const label of obsoleteLabels) {
      expect(within(rail).queryByText(label)).not.toBeInTheDocument()
    }
  })

  it.each([
    ['workflow', '01 基本信息', []],
    ['advice', '02 营销建议', ['01 基本信息']],
    ['workspace', '03 创作工作台', ['01 基本信息', '02 营销建议']],
    ['copy', '03 创作工作台', ['01 基本信息', '02 营销建议']],
    ['poster', '03 创作工作台', ['01 基本信息', '02 营销建议']],
    ['detail', '03 创作工作台', ['01 基本信息', '02 营销建议']],
    ['results', '03 创作工作台', ['01 基本信息', '02 营销建议']],
  ] as const)('maps %s to the correct shared stage', (view, activeLabel, completeLabels) => {
    renderRail(view)
    const rail = screen.getByRole('navigation', { name: 'Workflow V2 进度' })
    const current = within(rail).getByRole('listitem', { name: activeLabel })

    expect(current).toHaveAttribute('aria-current', 'step')
    expect(within(rail).getAllByRole('listitem', { current: 'step' })).toHaveLength(1)
    for (const label of completeLabels) {
      expect(within(rail).getByRole('listitem', { name: label })).toHaveClass('workflow-rail__item--complete')
    }
  })

  it('keeps the progress indicator informational rather than creating a navigation path', () => {
    renderRail('workspace')
    const rail = screen.getByRole('navigation', { name: 'Workflow V2 进度' })

    expect(within(rail).queryAllByRole('button')).toHaveLength(0)
    expect(within(rail).queryAllByRole('link')).toHaveLength(0)
  })

  it('keeps the legacy reducer path compatible while presenting the V2 stage shell', async () => {
    const user = userEvent.setup()
    renderApp()
    await user.type(screen.getByLabelText('产品信息'), '有效产品信息')
    await user.click(screen.getByRole('button', { name: '下一步' }))

    expect(
      await screen.findByRole('heading', { name: '营销建议生成失败' }),
    ).toBeVisible()
    expect(screen.getByRole('navigation', { name: 'Workflow V2 进度' })).toBeVisible()
    expect(
      screen.getByRole('listitem', { name: '02 营销建议' }),
    ).toHaveAttribute('aria-current', 'step')
  })

})

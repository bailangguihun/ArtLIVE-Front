import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { WorkflowProvider } from '../../state/WorkflowProvider'
import { useWorkflowState } from '../../state/use-workflow'

function Probe() {
  const state = useWorkflowState()
  return <output data-testid="session">{JSON.stringify({ ...state.workflowV2, currentStep: state.currentStep })}</output>
}

function renderApp() {
  return render(<WorkflowProvider><App /><Probe /></WorkflowProvider>)
}

describe('Home and Round 3 session shell', () => {
  it('renders the exact no-session Home contract without a request', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    renderApp()
    expect(screen.getByRole('heading', { name: '从营销建议，到完整视觉成品。' })).toBeVisible()
    expect(screen.getByText('您的一站式电商营销助手')).toBeVisible()
    expect(screen.getByRole('button', { name: '开始新创作' })).toBeVisible()
    expect(screen.getByRole('button', { name: '历史记录' })).toBeVisible()
    expect(screen.queryByRole('button', { name: '继续本轮创作' })).not.toBeInTheDocument()
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('starts, returns Home, continues, and confirms a new epoch', async () => {
    const user = userEvent.setup()
    renderApp()
    await user.click(screen.getByRole('button', { name: '开始新创作' }))
    expect(screen.getByRole('heading', { name: '01 基本信息' })).toBeVisible()
    const first = JSON.parse(screen.getByTestId('session').textContent ?? '{}')
    expect(first.phase).toBe('active')
    expect(first.epoch).toBe(1)
    await user.click(screen.getByRole('button', { name: /返回首页/ }))
    expect(screen.getByRole('button', { name: '继续本轮创作' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: '继续本轮创作' }))
    expect(screen.getByRole('heading', { name: '01 基本信息' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: /返回首页/ }))
    await user.click(screen.getByRole('button', { name: '开始新创作' }))
    expect(screen.getByRole('dialog', { name: '开始新的创作？' })).toBeVisible()
    expect(screen.getByRole('button', { name: '确认开始' })).toHaveClass('home-button--destructive')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '开始新创作' }))
    await user.click(screen.getByRole('button', { name: '确认开始' }))
    const second = JSON.parse(screen.getByTestId('session').textContent ?? '{}')
    expect(second.epoch).toBe(2)
    expect(second.phase).toBe('active')
  })

  it('keeps dialog focus contained and restores the trigger after cancel', async () => {
    const user = userEvent.setup()
    renderApp()
    await user.click(screen.getByRole('button', { name: '开始新创作' }))
    await user.click(screen.getByRole('button', { name: /返回首页/ }))
    const trigger = screen.getByRole('button', { name: '开始新创作' })
    await user.click(trigger)
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    await user.keyboard('{Shift>}{Tab}{/Shift}')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '确认开始' }))
    await user.click(screen.getByRole('button', { name: '取消' }))
    expect(document.activeElement).toBe(trigger)
  })

  it('opens history from Home without starting a session', async () => {
    const user = userEvent.setup()
    renderApp()
    await user.click(screen.getByRole('button', { name: '历史记录' }))
    expect(screen.getByRole('heading', { name: '历史记录' })).toBeVisible()
    await waitFor(() => {
      expect(screen.getByText('这里保存你确认过的文案、海报和详情页成果，按创作批次归档。')).toBeVisible()
    })
    const session = JSON.parse(screen.getByTestId('session').textContent ?? '{}')
    expect(session.view).toBe('history')
    expect(session.phase).toBe('none')
    await user.click(screen.getByRole('button', { name: '返回首页' }))
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: '从营销建议，到完整视觉成品。' })).toBeVisible()
    })
  })
})

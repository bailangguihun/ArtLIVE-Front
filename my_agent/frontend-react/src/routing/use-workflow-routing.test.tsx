import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkflowProvider } from '../state/WorkflowProvider'
import { createInitialWorkflowState } from '../state/workflow-reducer'
import type { WorkflowState } from '../state/workflow-types'
import { useWorkflowDispatch, useWorkflowState } from '../state/use-workflow'
import {
  createBasicAuthority,
  createPresentAdviceAuthority,
} from '../state/workflow-v2/workflow-v2-authorities'
import type { AdviceResult } from '../state/workflow-v2/workflow-v2-types'
import { routeForWorkflowState, routeHeadingId, routeReasonMessage } from './workflow-routes'
import { useWorkflowRouting } from './use-workflow-routing'

const ADVICE: AdviceResult = {
  category_id: 'fmcg', category_name: '快消品', confidence: 'low',
  matched_keywords: [], reason: 'fixture', score: 0,
  strategy: { id: 'fmcg', name: '策略', examples: '示例', traits: ['清晰'], tactics: ['说明'], one_liner: '方向' },
  source: 'desktop_ai_different_product_marketing_strategies',
}

async function workspaceState(): Promise<WorkflowState> {
  const initial = createInitialWorkflowState()
  const basic = await createBasicAuthority({
    productInfo: '测试商品', productShortName: '商品', creativeNote: '说明',
    platform: 'xiaohongshu', style: 'premium',
    productImage: { byteSha256: '1'.repeat(64), mimeType: 'image/png', byteSize: 64 },
  })
  const advice = await createPresentAdviceAuthority({
    api_version: 'v1', advice_version: 'catalog-v1', status: 'present',
    input_signature_sha256: basic.text.adviceInputSignatureSha256,
    advice_signature_sha256: '2'.repeat(64), advice: ADVICE,
  }, basic)
  return {
    ...initial,
    workflowV2: {
      ...initial.workflowV2,
      phase: 'active', view: 'workspace', resumeView: 'workspace', epoch: 7,
      basicAuthority: basic, adviceAuthority: advice,
    },
  }
}

function RoutingProbe() {
  const state = useWorkflowState()
  const dispatch = useWorkflowDispatch()
  const routing = useWorkflowRouting(state, dispatch)
  const { notice, setNoticeElement } = routing
  const route = routeForWorkflowState(state)
  return (
    <>
      {notice ? <p ref={setNoticeElement} role="status" tabIndex={-1}>{notice.message}</p> : null}
      <h1 id={routeHeadingId(route)}>
        {route}
      </h1>
      <output data-testid="route">{route}</output>
      <output data-testid="epoch">{state.workflowV2.epoch}</output>
      <button onClick={() => routing.navigate('copy')} type="button">copy</button>
      <button onClick={() => routing.navigate('workspace')} type="button">workspace</button>
      <button onClick={() => routing.startNew()} type="button">new</button>
      <button onClick={() => dispatch({ type: 'ENTER_V2_RESULTS' })} type="button">results-action</button>
    </>
  )
}

function renderProbe(initialState?: WorkflowState, strict = false) {
  const content = <WorkflowProvider initialState={initialState}><RoutingProbe /></WorkflowProvider>
  return render(strict ? <StrictMode>{content}</StrictMode> : content)
}

afterEach(() => {
  window.history.replaceState(null, '', '/')
  vi.restoreAllMocks()
})

describe('native Workflow V2 history adapter', () => {
  it('starts a fresh Basic session from /basic and writes only route metadata', async () => {
    window.history.replaceState(null, '', '/basic')
    renderProbe()
    expect(await screen.findByTestId('route')).toHaveTextContent('basic')
    expect(window.location.pathname).toBe('/basic')
    expect(window.history.state).toEqual(expect.objectContaining({
      app: 'workflow-v2-routing', version: 1, route: 'basic', workflowEpoch: 1,
    }))
    expect(Object.keys(window.history.state).sort()).toEqual(['app', 'entryId', 'route', 'version', 'workflowEpoch'])
  })

  it('canonicalizes an initial trailing-slash route with replace rather than a new entry', async () => {
    window.history.replaceState(null, '', '/basic/')
    const replace = vi.spyOn(window.history, 'replaceState')
    renderProbe()
    expect(await screen.findByTestId('route')).toHaveTextContent('basic')
    expect(window.location.pathname).toBe('/basic')
    expect(replace).toHaveBeenCalled()
  })

  it('safely replaces a fresh protected deep link with Basic without a session notice', async () => {
    window.history.replaceState(null, '', '/results')
    renderProbe()
    expect(await screen.findByTestId('route')).toHaveTextContent('basic')
    expect(window.location.pathname).toBe('/basic')
    expect(document.querySelector('p[role="status"]')).not.toBeInTheDocument()
    expect(document.activeElement).toBe(document.getElementById('product-info-heading'))
  })

  it('safely replaces an unknown initial path with Home and a user-facing explanation', async () => {
    window.history.replaceState(null, '', '/not-a-workflow-page')
    renderProbe()
    expect(await screen.findByTestId('route')).toHaveTextContent('home')
    expect(window.location.pathname).toBe('/')
    const notice = document.querySelector('p[role="status"]')
    expect(notice).toHaveTextContent(routeReasonMessage('unknown_path'))
    expect(document.activeElement).toBe(notice)
  })

  it('uses one push for accepted navigation, none for the same route, and updates focus and title', async () => {
    const user = userEvent.setup()
    window.history.replaceState(null, '', '/workspace')
    const state = await workspaceState()
    const push = vi.spyOn(window.history, 'pushState')
    renderProbe(state)
    expect(await screen.findByTestId('route')).toHaveTextContent('workspace')
    const before = push.mock.calls.length
    await user.click(screen.getByRole('button', { name: 'copy' }))
    expect(await screen.findByTestId('route')).toHaveTextContent('copy')
    expect(push).toHaveBeenCalledTimes(before + 1)
    expect(window.location.pathname).toBe('/copy')
    expect(document.title).toContain('推广文案')
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'copy' }))
    await user.click(screen.getByRole('button', { name: 'copy' }))
    expect(push).toHaveBeenCalledTimes(before + 1)
  })

  it('handles valid Back without a second history write and preserves the in-memory session', async () => {
    const user = userEvent.setup()
    window.history.replaceState(null, '', '/workspace')
    const state = await workspaceState()
    const push = vi.spyOn(window.history, 'pushState')
    renderProbe(state)
    await user.click(await screen.findByRole('button', { name: 'copy' }))
    const countAfterPush = push.mock.calls.length
    act(() => window.history.back())
    await waitFor(() => expect(screen.getByTestId('route')).toHaveTextContent('workspace'))
    expect(window.location.pathname).toBe('/workspace')
    expect(push).toHaveBeenCalledTimes(countAfterPush)
  })

  it('replaces an invalid popstate with the safe Workspace fallback and focuses the reason', async () => {
    window.history.replaceState(null, '', '/workspace')
    const state = await workspaceState()
    const replace = vi.spyOn(window.history, 'replaceState')
    renderProbe(state)
    await screen.findByTestId('route')
    window.history.pushState({ app: 'workflow-v2-routing', version: 1, route: 'results', workflowEpoch: 7, entryId: 'invalid-results' }, '', '/results')
    act(() => window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state })))
    await waitFor(() => expect(window.location.pathname).toBe('/workspace'))
    const notice = screen.getByText('当前没有可安全展示的已确认创作成果。')
    expect(notice).toHaveAttribute('role', 'status')
    expect(document.activeElement).toBe(notice)
    expect(replace).toHaveBeenCalled()
  })

  it('rejects old-epoch entries after New Creation without restoring their route or authority', async () => {
    const user = userEvent.setup()
    window.history.replaceState({ app: 'workflow-v2-routing', version: 1, route: 'workspace', workflowEpoch: 7, entryId: 'old' }, '', '/workspace')
    renderProbe(await workspaceState())
    await screen.findByTestId('route')
    await user.click(screen.getByRole('button', { name: 'new' }))
    await waitFor(() => expect(screen.getByTestId('epoch')).toHaveTextContent('8'))
    expect(window.location.pathname).toBe('/basic')
    window.history.pushState({ app: 'workflow-v2-routing', version: 1, route: 'copy', workflowEpoch: 7, entryId: 'older' }, '', '/copy')
    act(() => window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state })))
    await waitFor(() => expect(window.location.pathname).toBe('/basic'))
    expect(screen.getByText('此前历史记录属于较早的创作会话，已返回本轮安全入口。')).toHaveAttribute('role', 'status')
    expect(screen.getByTestId('epoch')).toHaveTextContent('8')
  })

  it('owns one effective popstate handler under StrictMode and cleans it on unmount', async () => {
    window.history.replaceState(null, '', '/basic')
    const remove = vi.spyOn(window, 'removeEventListener')
    const rendered = renderProbe(undefined, true)
    await screen.findByTestId('route')
    rendered.unmount()
    expect(remove).toHaveBeenCalledWith('popstate', expect.any(Function))
  })

  it('does not add duplicate popstate handlers after state-driven route changes', async () => {
    const user = userEvent.setup()
    window.history.replaceState(null, '', '/workspace')
    const add = vi.spyOn(window, 'addEventListener')
    renderProbe(await workspaceState())
    await user.click(await screen.findByRole('button', { name: 'copy' }))
    await user.click(screen.getByRole('button', { name: 'workspace' }))
    const popAdds = add.mock.calls.filter(([type]) => type === 'popstate')
    expect(popAdds).toHaveLength(1)
  })
})

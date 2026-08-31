import { Component, Suspense, lazy } from 'react'
import type { ReactNode } from 'react'
import { AppShell } from './app/AppShell'
import { HomeScreen } from './features/home/HomeScreen'
import { PlatformCopyStep } from './features/platform-copy/PlatformCopyStep'
import { PosterGenerationStep } from './features/poster-generation/PosterGenerationStep'
import { PosterEditorStep } from './features/poster-editor/PosterEditorStep'
import { ProductInfoStep } from './features/product-info/ProductInfoStep'
import { MarketingAdviceStep } from './features/marketing-advice/MarketingAdviceStep'
import { CreationWorkspace } from './features/creation-workspace/CreationWorkspace'
import { useWorkflowDispatch, useWorkflowState } from './state/use-workflow'
import { useWorkflowRouting } from './routing/use-workflow-routing'
import './styles/home.css'
import './styles/creation-history.css'

const DetailEditorStep = lazy(async () => {
  const module = await import('./features/detail-editor/DetailEditorStep')
  return { default: module.DetailEditorStep }
})

const CreationHistoryView = lazy(async () => {
  const module = await import('./features/creation-history/CreationHistoryView')
  return { default: module.CreationHistoryView }
})

const MarketingStrategyStep = lazy(async () => {
  const module = await import('./features/marketing-strategy/MarketingStrategyStep')
  return { default: module.MarketingStrategyStep }
})

const FinalResultsStep = lazy(async () => {
  const module = await import('./features/final-results/FinalResultsStep')
  return { default: module.FinalResultsStep }
})

const ProgressiveResultsView = lazy(async () => {
  const module = await import('./features/progressive-results/ProgressiveResultsView')
  return { default: module.ProgressiveResultsView }
})

class DetailEditorBoundary extends Component<{ children: ReactNode }, { failed: boolean; retryKey: number }> {
  state = { failed: false, retryKey: 0 }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch() {
    // The visible boundary intentionally does not expose runtime details.
  }

  private retry = () => this.setState((state) => ({ failed: false, retryKey: state.retryKey + 1 }))

  render() {
    if (this.state.failed) {
      return (
        <section aria-labelledby="detail-editor-heading" className="detail-editor-step detail-editor-step--guard">
          <h1 id="detail-editor-heading">步骤 5：详情页制作</h1>
          <p role="alert">详情页编辑器加载失败，请重试。</p>
          <button onClick={this.retry} type="button">重试加载编辑器</button>
        </section>
      )
    }
    return <div key={this.state.retryKey}>{this.props.children}</div>
  }
}

export default function App() {
  const state = useWorkflowState()
  const dispatch = useWorkflowDispatch()
  const routing = useWorkflowRouting(state, dispatch)
  const { notice, setNoticeElement } = routing
  const { currentStep, workflowV2 } = state
  const legacySeeded = workflowV2.phase === 'none' && currentStep !== 1
  const workflowVisible =
    (workflowV2.phase === 'active' && workflowV2.view === 'workflow') || legacySeeded
  const showWorkflowRail =
    (workflowV2.phase === 'active' && workflowV2.view !== 'home') || legacySeeded
  const showBasicHomeControl =
    workflowV2.phase === 'active' &&
    workflowV2.view === 'workflow' &&
    currentStep === 1
  const adviceVisible = workflowV2.phase === 'active' && workflowV2.view === 'advice'
  const workspaceVisible = workflowV2.phase === 'active' && workflowV2.view === 'workspace'
  const copyVisible = workflowV2.phase === 'active' && workflowV2.view === 'copy'
  const posterVisible = workflowV2.phase === 'active' && workflowV2.view === 'poster'
  const detailVisible = workflowV2.phase === 'active' && workflowV2.view === 'detail'
  const resultsVisible = workflowV2.phase === 'active' && workflowV2.view === 'results'
  const historyVisible = workflowV2.view === 'history'
  const homeVisible =
    ((workflowV2.phase === 'none' && !legacySeeded) || workflowV2.view === 'home') &&
    !historyVisible
  const onHome = () => {
    routing.navigate('home')
    if (state.detailEditor.operations.imageBusy) {
      dispatch({ type: 'SET_STEP_FIVE_OPERATIONS', operations: { imageBusy: false, imageStatus: '' } })
    }
  }

  return (
    <AppShell
      onHome={workflowV2.phase === 'active' ? onHome : undefined}
      showBasicHomeControl={showBasicHomeControl}
      showWorkflowRail={showWorkflowRail}
    >
      {notice ? (
        <p className="route-notice" ref={setNoticeElement} role="status" tabIndex={-1}>
          {notice.message}
        </p>
      ) : null}
      {homeVisible ? (
        <HomeScreen
          hasActiveSession={workflowV2.phase === 'active'}
          onContinue={() => {
            const route = workflowV2.resumeView === 'workflow'
              ? 'basic'
              : workflowV2.resumeView
            routing.navigate(route)
          }}
          onConfirmNew={() => routing.startNew('replace')}
          onHistory={() => routing.navigate('history')}
          onStart={() => routing.startNew('push')}
        />
      ) : null}
      {historyVisible ? (
        <Suspense fallback={(
          <section aria-labelledby="creation-history-heading" className="creation-history creation-history--loading">
            <h1 id="creation-history-heading">历史记录</h1>
            <p role="status">正在加载历史记录…</p>
          </section>
        )}>
          <CreationHistoryView onBackHome={() => routing.navigate('home')} />
        </Suspense>
      ) : null}
      {workflowVisible && currentStep === 1 ? <ProductInfoStep /> : null}
      {adviceVisible ? <MarketingAdviceStep /> : null}
      {workspaceVisible ? <CreationWorkspace /> : null}
      {copyVisible ? <PlatformCopyStep /> : null}
      {posterVisible && currentStep === 3 ? <PosterGenerationStep /> : null}
      {posterVisible && currentStep === 4 ? <PosterEditorStep /> : null}
      {detailVisible ? (
        <DetailEditorBoundary>
          <Suspense fallback={(
            <section aria-labelledby="detail-editor-heading" className="detail-editor-step detail-editor-step--guard">
              <h1 id="detail-editor-heading">详情页编辑</h1>
              <p role="status">正在加载详情页编辑器…</p>
            </section>
          )}>
            <DetailEditorStep />
          </Suspense>
        </DetailEditorBoundary>
      ) : null}
      {resultsVisible ? (
        <Suspense fallback={(
          <section aria-labelledby="progressive-results-heading" className="progressive-results progressive-results--loading">
            <h1 id="progressive-results-heading">创作成果</h1>
            <p role="status">正在加载创作成果…</p>
          </section>
        )}>
          <ProgressiveResultsView />
        </Suspense>
      ) : null}
      {workflowVisible && currentStep === 2 ? <PlatformCopyStep /> : null}
      {workflowVisible && currentStep === 3 ? <PosterGenerationStep /> : null}
      {workflowVisible && currentStep === 4 ? <PosterEditorStep /> : null}
      {workflowVisible && currentStep === 5 ? (
        <DetailEditorBoundary>
          <Suspense fallback={(
            <section aria-labelledby="detail-editor-heading" className="detail-editor-step detail-editor-step--guard">
              <h1 id="detail-editor-heading">步骤 5：详情页制作</h1>
              <p role="status">正在加载详情页编辑器…</p>
            </section>
          )}>
            <DetailEditorStep />
          </Suspense>
        </DetailEditorBoundary>
      ) : null}
      {workflowVisible && currentStep === 6 ? (
        <Suspense fallback={null}>
          <MarketingStrategyStep />
        </Suspense>
      ) : null}
      {workflowVisible && currentStep === 7 ? (
        <Suspense fallback={null}>
          <FinalResultsStep />
        </Suspense>
      ) : null}
    </AppShell>
  )
}

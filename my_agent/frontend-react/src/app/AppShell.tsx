import type { ReactNode } from 'react'
import { WorkflowRail } from '../components/WorkflowRail'

interface AppShellProps {
  children: ReactNode
  onHome?: () => void
  homeDisabled?: boolean
  homeDisabledReason?: string
  showBasicHomeControl?: boolean
  showWorkflowRail?: boolean
}

export function AppShell({
  children,
  onHome,
  homeDisabled = false,
  homeDisabledReason,
  showBasicHomeControl = false,
  showWorkflowRail = true,
}: AppShellProps) {
  return (
    <div className="app-shell">
      <header className={`app-header${showBasicHomeControl ? ' app-header--basic' : ''}`}>
        {showBasicHomeControl && onHome ? (
          <>
            <div className="app-identity">图文智绘</div>
            <button
              aria-label="返回首页"
              className="app-header__home"
              disabled={homeDisabled}
              onClick={onHome}
              title={homeDisabled ? homeDisabledReason : undefined}
              type="button"
            >
              ← 返回首页
            </button>
          </>
        ) : onHome ? (
          <button
            aria-label="图文智绘，返回首页"
            className="app-identity app-identity--button"
            disabled={homeDisabled}
            onClick={onHome}
            title={homeDisabled ? homeDisabledReason : undefined}
            type="button"
          >
            图文智绘
          </button>
        ) : (
          <div className="app-identity">图文智绘</div>
        )}
      </header>

      {showWorkflowRail ? <WorkflowRail /> : null}

      <main className="app-main" id="main-content">
        {children}
      </main>
    </div>
  )
}

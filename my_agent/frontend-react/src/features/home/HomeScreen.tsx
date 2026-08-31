import { useEffect, useRef, useState } from 'react'

interface HomeScreenProps {
  readonly hasActiveSession: boolean
  readonly onStart: () => void
  readonly onContinue: () => void
  readonly onConfirmNew: () => void
  readonly onHistory: () => void
}

export function HomeScreen({
  hasActiveSession,
  onStart,
  onContinue,
  onConfirmNew,
  onHistory,
}: HomeScreenProps) {
  const dialogTriggerRef = useRef<HTMLButtonElement | null>(null)
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const dialog = dialogRef.current
    const previouslyFocused = document.activeElement as HTMLElement | null
    const focusables = () => dialog?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled])',
    )
    const first = focusables()?.[0]
    first?.focus()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setOpen(false)
        return
      }
      if (event.key !== 'Tab') return
      const items = focusables()
      if (!items?.length) return
      const firstItem = items[0]
      const lastItem = items[items.length - 1]
      if (event.shiftKey && document.activeElement === firstItem) {
        event.preventDefault()
        lastItem.focus()
      } else if (!event.shiftKey && document.activeElement === lastItem) {
        event.preventDefault()
        firstItem.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      const target = dialogTriggerRef.current ?? previouslyFocused
      target?.focus()
    }
  }, [open])

  return (
    <section aria-labelledby="home-heading" className="home-screen">
      <div className="home-hero">
        <div className="home-hero__copy">
          <h1 id="home-heading">从营销建议，到完整视觉成品。</h1>
          <p className="home-hero__body">
            您的一站式电商营销助手
          </p>
          <div className="home-hero__actions">
            {hasActiveSession ? (
              <>
                <button className="home-button home-button--primary" onClick={onContinue} type="button">
                  继续本轮创作
                </button>
                <button
                  className="home-button home-button--secondary"
                  onClick={(event) => {
                    dialogTriggerRef.current = event.currentTarget
                    setOpen(true)
                  }}
                  type="button"
                >
                  开始新创作
                </button>
              </>
            ) : (
              <button className="home-button home-button--primary" onClick={onStart} type="button">
                开始新创作
              </button>
            )}
            <button className="home-button home-button--secondary" onClick={onHistory} type="button">
              历史记录
            </button>
          </div>
        </div>

        <div aria-label="创作流程预览" className="home-panels">
          <div className="home-panel home-panel--copy"><span>宣传文案</span></div>
          <div className="home-panel home-panel--poster"><span>海报设计</span></div>
          <div className="home-panel home-panel--detail"><span>详情页编辑</span></div>
        </div>
      </div>

      <div aria-label="创作流程说明" className="home-process-rail">
        <span>01 基本信息</span><i aria-hidden="true">→</i>
        <span>02 营销建议</span><i aria-hidden="true">→</i>
        <span>03 创作工作台</span><i aria-hidden="true">→</i>
        <span>成果中心</span>
      </div>

      {open ? (
        <div aria-hidden="false" className="home-dialog-backdrop">
          <div
            aria-describedby="new-creation-description"
            aria-labelledby="new-creation-title"
            aria-modal="true"
            className="home-dialog"
            ref={dialogRef}
            role="dialog"
          >
            <h2 id="new-creation-title">开始新的创作？</h2>
            <p id="new-creation-description">当前创作内容将被清除，此操作无法撤销。</p>
            <div className="home-dialog__actions">
              <button className="home-button home-button--secondary" onClick={() => setOpen(false)} type="button">取消</button>
              <button className="home-button home-button--primary home-button--destructive" onClick={() => { setOpen(false); onConfirmNew() }} type="button">确认开始</button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}

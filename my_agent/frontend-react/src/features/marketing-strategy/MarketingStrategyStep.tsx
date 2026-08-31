import { Fragment, useRef } from 'react'
import type { ReactNode } from 'react'
import { useWorkflowDispatch, useWorkflowState } from '../../state/use-workflow'
import type { StrategyDisplayBlock } from '../../types/marketing-strategy'
import { MISSING_STRATEGY_COPY } from '../../types/marketing-strategy'
import { isCurrentStep6Completion, selectStep6ViewModel } from './marketing-strategy-model'

const INLINE_MARKDOWN = /(\*\*[^*\n]+\*\*|`[^`\n]+`|\[[^\]\n]+\]\(https?:\/\/[^\s)]+\))/g

function safeInlineMarkdown(value: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let cursor = 0
  let key = 0

  for (const match of value.matchAll(INLINE_MARKDOWN)) {
    const index = match.index ?? 0
    if (index > cursor) nodes.push(value.slice(cursor, index))
    const token = match[0]
    if (token.startsWith('**')) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>)
    } else if (token.startsWith('`')) {
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>)
    } else {
      const link = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/.exec(token)
      nodes.push(link
        ? <a href={link[2]} key={key} rel="noreferrer" target="_blank">{link[1]}</a>
        : token)
    }
    cursor = index + token.length
    key += 1
  }

  if (cursor < value.length) nodes.push(value.slice(cursor))
  return nodes
}

function StrategyBlock({ block, index }: { block: StrategyDisplayBlock; index: number }) {
  if (block.kind === 'summary') {
    return (
      <p className="marketing-strategy-summary">
        判定品类：<strong>{safeInlineMarkdown(block.categoryName)}</strong>
        <span aria-hidden="true">｜</span>
        置信度：<strong>{safeInlineMarkdown(block.confidence)}</strong>
        {block.reason ? <><span aria-hidden="true">｜</span>{safeInlineMarkdown(block.reason)}</> : null}
      </p>
    )
  }

  if (block.kind === 'keywords') {
    return (
      <p className="marketing-strategy-keywords">
        <strong>命中关键词：</strong>
        {block.items.map((item, itemIndex) => (
          <Fragment key={`${index}-${itemIndex}`}>
            {itemIndex > 0 ? '、' : null}
            {safeInlineMarkdown(item)}
          </Fragment>
        ))}
      </p>
    )
  }

  if (block.kind === 'paragraph') {
    return (
      <p className={block.emphasis ? 'marketing-strategy-one-liner' : undefined}>
        {block.label ? <strong>{block.label}：</strong> : null}
        {safeInlineMarkdown(block.text)}
      </p>
    )
  }

  const List = block.ordered ? 'ol' : 'ul'
  const headingId = `marketing-strategy-list-${index}`
  return (
    <section aria-labelledby={headingId} className="marketing-strategy-list">
      <h3 id={headingId}>{block.heading}</h3>
      <List>
        {block.items.map((item, itemIndex) => (
          <li key={`${index}-${itemIndex}`}>{safeInlineMarkdown(item)}</li>
        ))}
      </List>
    </section>
  )
}

export function MarketingStrategyStep() {
  const workflow = useWorkflowState()
  const dispatch = useWorkflowDispatch()
  const transitionLock = useRef(false)
  const view = selectStep6ViewModel(workflow)

  if (workflow.currentStep !== 6 || !view.validEntry || !view.step5Authority) return null

  const strategyPresent = view.strategy.status === 'present'
  const completionCurrent = isCurrentStep6Completion(workflow)
  const handleNext = () => {
    if (transitionLock.current) return
    transitionLock.current = true
    dispatch({ type: 'COMPLETE_STEP_SIX' })
  }

  return (
    <section
      aria-labelledby="marketing-strategy-heading"
      className="marketing-strategy-step"
      data-completion-current={completionCurrent ? 'true' : 'false'}
      data-platform-id={view.platform.id}
      data-platform-owner-signature={view.platform.sourceOwnerSignatureSha256}
      data-platform-source={view.platform.sourceKind}
      data-step5-signature={view.step5Authority.groupSignatureSha256}
      data-step6-signature={view.step6SignatureSha256}
      data-strategy-owner-signature={view.strategy.sourceOwnerSignatureSha256}
      data-strategy-signature={view.strategy.strategySignatureSha256}
      data-strategy-source={view.strategy.sourceKind}
      data-strategy-status={view.strategy.status}
    >
      <h1 id="marketing-strategy-heading">步骤 6：营销策略</h1>

      <div className="marketing-strategy-board">
        <section aria-labelledby="marketing-platform-heading" className="marketing-strategy-platform">
          <h2 id="marketing-platform-heading">投放平台</h2>
          <p className="marketing-strategy-platform__value">{view.platform.label}</p>
        </section>

        <section aria-labelledby="marketing-content-heading" className="marketing-strategy-content">
          <h2 id="marketing-content-heading">产品品类与营销策略</h2>
          {strategyPresent ? (
            <div className="marketing-strategy-blocks">
              {view.strategy.blocks.map((block, index) => (
                <StrategyBlock block={block} index={index} key={`${block.kind}-${index}`} />
              ))}
            </div>
          ) : (
            <p className="marketing-strategy-missing">{MISSING_STRATEGY_COPY}</p>
          )}
        </section>
      </div>

      <div className="marketing-strategy-footer">
        <button
          className="marketing-strategy-footer__previous"
          onClick={() => dispatch({ type: 'GO_TO_STEP_FIVE' })}
          type="button"
        >
          上一步
        </button>
        <button
          className="marketing-strategy-footer__next"
          onClick={handleNext}
          type="button"
        >
          下一步：最终结果
        </button>
      </div>
    </section>
  )
}

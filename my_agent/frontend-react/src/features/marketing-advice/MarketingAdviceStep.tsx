import { useEffect, useRef } from 'react'
import { useWorkflowAdviceCommands, useWorkflowDispatch, useWorkflowState } from '../../state/use-workflow'
import { isAdviceCurrentForBasic } from '../../state/workflow-v2/workflow-v2-authorities'

function errorMessage(kind: 'validation' | 'network_server' | 'protocol' | null) {
  if (kind === 'validation') return '商品信息不符合要求，请返回修改后重试。'
  if (kind === 'protocol') return '建议数据校验失败，请重新生成。'
  return '暂时无法生成建议，请稍后重试。'
}

export function MarketingAdviceStep() {
  const { workflowV2 } = useWorkflowState()
  const dispatch = useWorkflowDispatch()
  const { retryAdvice } = useWorkflowAdviceCommands()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const basic = workflowV2.basicAuthority
  const advice = workflowV2.adviceAuthority
  const currentAdvice = Boolean(basic && advice && isAdviceCurrentForBasic(advice, basic))
  const screenState = workflowV2.pendingAdviceRequest
    ? 'loading'
    : currentAdvice && advice?.kind === 'present'
      ? 'success'
      : 'error'

  useEffect(() => {
    headingRef.current?.focus()
  }, [screenState])

  if (workflowV2.pendingAdviceRequest) {
    return (
      <section aria-labelledby="marketing-advice-heading" className="marketing-advice-step marketing-advice-step--loading">
        <h1 id="marketing-advice-heading" ref={headingRef} tabIndex={-1}>营销建议</h1>
        <div aria-live="polite" className="marketing-advice-loading" role="status">
          <strong>正在生成营销建议…</strong>
          <p>系统正在分析商品类别与营销方向。</p>
        </div>
        <button className="text-action" onClick={() => dispatch({ type: 'GO_TO_STEP_ONE' })} type="button">
          返回修改基本信息
        </button>
      </section>
    )
  }

  if (!currentAdvice || !advice || advice.kind !== 'present') {
    return (
      <section aria-labelledby="marketing-advice-heading" className="marketing-advice-step marketing-advice-step--error">
        <h1 id="marketing-advice-heading" ref={headingRef} tabIndex={-1}>营销建议生成失败</h1>
        <p role="alert">{errorMessage(workflowV2.adviceRequestError)}</p>
        <div className="marketing-advice-actions">
          <button className="home-button home-button--primary" onClick={retryAdvice} type="button">
            重新生成
          </button>
          <button className="home-button home-button--secondary" onClick={() => dispatch({ type: 'GO_TO_STEP_ONE' })} type="button">
            返回修改基本信息
          </button>
        </div>
      </section>
    )
  }

  const { advice: result } = advice

  return (
    <section aria-labelledby="marketing-advice-heading" className="marketing-advice-step">
      <header className="marketing-advice-intro">
        <h1 id="marketing-advice-heading" ref={headingRef} tabIndex={-1}>营销建议</h1>
        <div className="marketing-advice-actions">
          <button className="home-button home-button--secondary" onClick={() => dispatch({ type: 'GO_TO_STEP_ONE' })} type="button">
            返回修改基本信息
          </button>
          <button className="home-button home-button--primary" onClick={() => dispatch({ type: 'CONTINUE_FROM_V2_ADVICE' })} type="button">
            继续创作
          </button>
        </div>
      </header>

      <div className="marketing-advice-layout">
        <div className="marketing-advice-strategy">
          <span>推荐策略</span>
          <h2>{result.strategy.name}</h2>
          <p className="marketing-advice-one-liner">{result.strategy.one_liner}</p>
          {result.confidence === 'low' ? (
            <p className="marketing-advice-low-confidence">
              当前建议置信度较低，可返回补充商品信息后重新生成。
            </p>
          ) : null}
          <div className="marketing-advice-list-block">
            <h3>策略特点</h3>
            <ul>{result.strategy.traits.map((trait) => <li key={trait}>{trait}</li>)}</ul>
          </div>
          <div className="marketing-advice-list-block">
            <h3>执行建议</h3>
            <ul>{result.strategy.tactics.map((tactic) => <li key={tactic}>{tactic}</li>)}</ul>
          </div>
          <div className="marketing-advice-list-block">
            <h3>参考方向</h3>
            <p>{result.strategy.examples}</p>
          </div>
        </div>
      </div>
    </section>
  )
}

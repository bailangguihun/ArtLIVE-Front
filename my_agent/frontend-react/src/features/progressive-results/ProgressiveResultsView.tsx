import { useCallback, useEffect, useRef, useState } from 'react'
import { triggerPngDownload } from '../poster-editor/poster-resources'
import { useWorkflowDispatch, useWorkflowState } from '../../state/use-workflow'
import type { ProgressiveImageAsset } from './progressive-results-model'
import {
  hasExactProgressiveArtifact,
  selectCurrentProgressiveResultsView,
} from './progressive-results-model'

function downloadText(body: string, fileName: string) {
  const objectUrl = URL.createObjectURL(new Blob([body], { type: 'text/plain;charset=utf-8' }))
  try {
    const anchor = document.createElement('a')
    anchor.href = objectUrl
    anchor.download = fileName
    anchor.rel = 'noopener'
    anchor.style.display = 'none'
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

function ResultImagePreview({ asset }: { asset: ProgressiveImageAsset }) {
  const attachPreview = useCallback((image: HTMLImageElement | null) => {
    if (!image) return
    let objectUrl: string
    try {
      objectUrl = URL.createObjectURL(asset.blob)
      image.src = objectUrl
    } catch {
      image.removeAttribute('src')
      return
    }
    return () => {
      image.removeAttribute('src')
      URL.revokeObjectURL(objectUrl)
    }
  }, [asset.blob])

  return (
    <img
      alt={`${asset.title}预览（${asset.width} × ${asset.height}）`}
      height={asset.height}
      ref={attachPreview}
      width={asset.width}
    />
  )
}

function modeMessage(mode: ReturnType<typeof selectCurrentProgressiveResultsView>['selection']['mode']) {
  if (mode === 'all_current') return '全部当前确认成果已收集。'
  if (mode === 'none') return '尚无可进入成果；请先确认至少一项当前创作输出。'
  return '已收集部分当前确认成果；无需完成全部创作模块。'
}

export function ProgressiveResultsView() {
  const workflow = useWorkflowState()
  const dispatch = useWorkflowDispatch()
  const latestWorkflow = useRef(workflow)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const [actionMessage, setActionMessage] = useState('')
  const view = selectCurrentProgressiveResultsView(workflow)

  useEffect(() => {
    latestWorkflow.current = workflow
  }, [workflow])

  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  if (workflow.workflowV2.phase !== 'active' || workflow.workflowV2.view !== 'results') {
    return null
  }

  const requireCurrent = <T,>(find: (fresh: ReturnType<typeof selectCurrentProgressiveResultsView>) => T | null) => {
    const value = find(selectCurrentProgressiveResultsView(latestWorkflow.current))
    if (value === null) {
      setActionMessage('该成果已不再属于当前创作，未执行下载。请返回工作台查看当前状态。')
      return null
    }
    setActionMessage('')
    return value
  }

  const returnToWorkspace = () => dispatch({ type: 'RETURN_FROM_V2_RESULTS' })

  return (
    <section aria-labelledby="progressive-results-heading" className="progressive-results">
      <header className="progressive-results__intro">
        <p className="progressive-results__eyebrow">RESULTS</p>
        <h1 id="progressive-results-heading" ref={headingRef} tabIndex={-1}>创作成果</h1>
        <p>这里逐步汇集本轮已确认且仍然有效的输出；不需要完成每个创作模块。</p>
        <p aria-live="polite" className="progressive-results__status">
          {view.artifactCount} 项创作成果 · {modeMessage(view.selection.mode)}
        </p>
      </header>

      {view.selection.mode === 'none' ? (
        <section aria-label="成果当前不可用" className="progressive-results__empty">
          <p>当前没有可安全展示或下载的确认成果。已有较早结果会被保留，但不会被当作当前成果。</p>
        </section>
      ) : (
        <div className="progressive-results__sections">
          {view.poster || view.selection.promotionalCopy ? (
            <div className="progressive-results__primary">
              {view.poster ? (
                <section aria-labelledby="progressive-poster-heading" className="progressive-results__section">
                  <div className="progressive-results__section-heading">
                    <div>
                      <p className="progressive-results__kind">当前确认成果</p>
                      <h2 id="progressive-poster-heading">海报设计</h2>
                    </div>
                    <button
                      onClick={() => {
                        const asset = requireCurrent((fresh) => {
                          const currentPoster = fresh.poster
                          return currentPoster &&
                            currentPoster.sha256 === view.poster?.sha256 &&
                            currentPoster.sourceSignatureSha256 === view.poster?.sourceSignatureSha256
                            ? currentPoster
                            : null
                        })
                        if (asset) triggerPngDownload(asset.blob, asset.fileName)
                      }}
                      type="button"
                    >
                      下载海报
                    </button>
                  </div>
                  <figure className="progressive-results__figure">
                    <div className="progressive-results__preview"><ResultImagePreview asset={view.poster} /></div>
                    <figcaption>已确认海报设计 · {view.poster.width} × {view.poster.height}</figcaption>
                  </figure>
                  {view.selection.posterCopySnapshots[0] ? (
                    <aside aria-labelledby="poster-copy-snapshot-heading" className="progressive-results__snapshot">
                      <h3 id="poster-copy-snapshot-heading">海报文案快照</h3>
                      <p>这是海报溯源快照，不是“最终文案”。</p>
                      <p>{view.selection.posterCopySnapshots[0].fields.body || '（空快照）'}</p>
                    </aside>
                  ) : null}
                </section>
              ) : null}

              {view.selection.promotionalCopy ? (
                <section aria-labelledby="progressive-copy-heading" className="progressive-results__section">
                  <div className="progressive-results__section-heading">
                    <div>
                      <p className="progressive-results__kind">当前确认成果</p>
                      <h2 id="progressive-copy-heading">推广文案</h2>
                    </div>
                    <button
                      onClick={() => {
                        const artifact = requireCurrent((fresh) => {
                          const copy = fresh.selection.promotionalCopy
                          return copy && hasExactProgressiveArtifact(
                            fresh.selection,
                            view.selection.promotionalCopy!,
                          ) ? copy : null
                        })
                        if (artifact) downloadText(artifact.fields.body, 'confirmed-promotional-copy.txt')
                      }}
                      type="button"
                    >
                      下载文案
                    </button>
                  </div>
                  <p className="progressive-results__copy">{view.selection.promotionalCopy.fields.body || '（空文案）'}</p>
                </section>
              ) : null}
            </div>
          ) : null}

          {view.details.length > 0 ? (
            <section aria-labelledby="progressive-detail-heading" className="progressive-results__section progressive-results__section--details">
              <div className="progressive-results__section-heading">
                <div>
                  <p className="progressive-results__kind">当前确认成果</p>
                  <h2 id="progressive-detail-heading">详情页</h2>
                </div>
                <button
                  onClick={() => {
                    const assets = requireCurrent((fresh) =>
                      fresh.details.length === view.details.length &&
                      fresh.details.every((asset, index) =>
                        asset.sha256 === view.details[index].sha256 &&
                        asset.sourceSignatureSha256 === view.details[index].sourceSignatureSha256,
                      )
                        ? fresh.details
                        : null)
                    assets?.forEach((asset) => triggerPngDownload(asset.blob, asset.fileName))
                  }}
                  type="button"
                >
                  按顺序下载详情页
                </button>
              </div>
              <div className="progressive-results__detail-grid">
                {view.details.map((asset) => (
                  <figure className="progressive-results__figure" key={asset.sha256}>
                    <div className="progressive-results__preview"><ResultImagePreview asset={asset} /></div>
                    <figcaption>{asset.title} · {asset.width} × {asset.height}</figcaption>
                  </figure>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      )}

      {actionMessage ? <p className="progressive-results__action-message" role="status">{actionMessage}</p> : null}
      <button className="text-action progressive-results__back" onClick={returnToWorkspace} type="button">
        返回创作工作台
      </button>
    </section>
  )
}

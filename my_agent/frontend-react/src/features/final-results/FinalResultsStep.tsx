import { useCallback, useMemo, useRef } from 'react'
import { triggerPngDownload } from '../poster-editor/poster-resources'
import { useWorkflowDispatch, useWorkflowState } from '../../state/use-workflow'
import type { FinalGalleryAsset } from '../../types/final-results'
import { selectFinalResultsViewModel } from './final-results-model'

function FinalResultPreview({ asset }: { asset: FinalGalleryAsset }) {
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
      alt={`${asset.title}预览`}
      height={asset.height}
      ref={attachPreview}
      width={asset.width}
    />
  )
}

export function FinalResultsStep() {
  const workflow = useWorkflowState()
  const dispatch = useWorkflowDispatch()
  const resetLock = useRef(false)
  const view = useMemo(
    () => selectFinalResultsViewModel(workflow),
    [workflow],
  )

  if (workflow.currentStep !== 7 || !view) return null

  const handleReset = () => {
    if (resetLock.current) return
    resetLock.current = true
    dispatch({ type: 'RESET_WORKFLOW' })
  }

  return (
    <section aria-labelledby="final-results-heading" className="final-results-step">
      <h1 id="final-results-heading">步骤 7：最终结果</h1>

      <div className="final-results-board">
        <section aria-labelledby="final-copy-heading" className="final-results-copy">
          <h2 id="final-copy-heading">最终文案</h2>
          <p className="final-results-copy__body">{view.finalCopy.displayBody}</p>
        </section>

        <div aria-hidden="true" className="final-results-divider" />

        <section aria-labelledby="final-gallery-heading" className="final-results-gallery">
          <div className="final-results-gallery__heading-row">
            <h2 id="final-gallery-heading">成稿图片</h2>
            <p>共 {view.gallery.length} 张：海报 + 详情页</p>
          </div>
          <div className="final-results-gallery__grid">
            {view.gallery.map((asset) => (
                <figure className="final-results-figure" key={`${asset.kind}-${asset.ordinal}`}>
                  <figcaption>{asset.title}</figcaption>
                  <div className="final-results-figure__preview">
                    <FinalResultPreview asset={asset} />
                  </div>
                  <button
                    className="final-results-figure__download"
                    onClick={() => triggerPngDownload(asset.blob, asset.fileName)}
                    type="button"
                  >
                    下载
                  </button>
                </figure>
              ))}
          </div>
        </section>
      </div>

      <div className="final-results-footer">
        <button
          className="final-results-footer__previous"
          onClick={() => dispatch({ type: 'GO_TO_STEP_SIX' })}
          type="button"
        >
          上一步
        </button>
        <button
          className="final-results-footer__reset"
          onClick={handleReset}
          type="button"
        >
          重新开始一轮创作
        </button>
      </div>
    </section>
  )
}

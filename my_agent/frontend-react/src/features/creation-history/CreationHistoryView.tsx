import { useCallback, useEffect, useRef, useState } from 'react'
import { triggerPngDownload } from '../poster-editor/poster-resources'
import {
  deleteCreationHistoryBatch,
  getCreationHistoryBatch,
  listCreationHistoryBatches,
} from './creation-history-store'
import type {
  CreationHistoryBatch,
  CreationHistoryImage,
  CreationHistoryListItem,
} from './creation-history-types'

interface CreationHistoryViewProps {
  readonly onBackHome: () => void
}

function formatTimestamp(value: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

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

function HistoryImagePreview({ asset }: { asset: CreationHistoryImage }) {
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

function artifactSummary(item: CreationHistoryListItem): string {
  const parts: string[] = []
  if (item.hasCopy) parts.push('文案')
  if (item.hasPoster) parts.push('海报')
  if (item.detailCount > 0) parts.push(`详情页 × ${item.detailCount}`)
  return parts.join(' · ')
}

export function CreationHistoryView({ onBackHome }: CreationHistoryViewProps) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  const [items, setItems] = useState<readonly CreationHistoryListItem[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedBatch, setSelectedBatch] = useState<CreationHistoryBatch | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const selectBatch = useCallback((id: string | null) => {
    setSelectedId(id)
    setSelectedBatch(null)
  }, [])

  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  useEffect(() => {
    let cancelled = false
    void listCreationHistoryBatches()
      .then((rows) => {
        if (cancelled) return
        setItems(rows)
      })
      .catch(() => {
        if (cancelled) return
        setError('历史记录加载失败，请稍后重试。')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!selectedId) {
      return
    }
    let cancelled = false
    void getCreationHistoryBatch(selectedId)
      .then((batch) => {
        if (cancelled) return
        if (batch) {
          setSelectedBatch(batch)
        } else {
          selectBatch(null)
        }
      })
      .catch(() => {
        if (cancelled) return
        setError('无法打开这条历史记录。')
        selectBatch(null)
      })
    return () => {
      cancelled = true
    }
  }, [selectBatch, selectedId])

  const refreshList = useCallback(async () => {
    const rows = await listCreationHistoryBatches()
    setItems(rows)
    if (selectedId && !rows.some((item) => item.id === selectedId)) {
      selectBatch(null)
    }
  }, [selectBatch, selectedId])

  const removeBatch = async (id: string) => {
    await deleteCreationHistoryBatch(id)
    if (selectedId === id) selectBatch(null)
    await refreshList()
  }

  if (selectedBatch) {
    return (
      <section aria-labelledby="creation-history-heading" className="creation-history">
        <header className="creation-history__intro">
          <p className="creation-history__eyebrow">HISTORY</p>
          <h1 id="creation-history-heading" ref={headingRef} tabIndex={-1}>历史记录</h1>
          <p>{selectedBatch.productShortName} · {formatTimestamp(selectedBatch.updatedAt)}</p>
        </header>

        <div className="creation-history__detail-actions">
          <button className="text-action" onClick={() => selectBatch(null)} type="button">
            返回列表
          </button>
          <button
            className="text-action"
            data-action="destructive"
            onClick={() => void removeBatch(selectedBatch.id)}
            type="button"
          >
            删除这条记录
          </button>
        </div>

        <div className="creation-history__sections">
          <div className="creation-history__primary">
            {selectedBatch.poster ? (
              <section aria-labelledby="history-poster-heading" className="creation-history__section">
                <div className="creation-history__section-heading">
                  <h2 id="history-poster-heading">海报设计</h2>
                  <button
                    onClick={() => triggerPngDownload(selectedBatch.poster!.blob, selectedBatch.poster!.fileName)}
                    type="button"
                  >
                    下载海报
                  </button>
                </div>
                <figure className="creation-history__figure">
                  <div className="creation-history__preview">
                    <HistoryImagePreview asset={selectedBatch.poster} />
                  </div>
                  <figcaption>{selectedBatch.poster.width} × {selectedBatch.poster.height}</figcaption>
                </figure>
              </section>
            ) : null}

            {selectedBatch.copy ? (
              <section aria-labelledby="history-copy-heading" className="creation-history__section">
                <div className="creation-history__section-heading">
                  <h2 id="history-copy-heading">推广文案</h2>
                  <button
                    onClick={() => downloadText(selectedBatch.copy!.body, 'history-promotional-copy.txt')}
                    type="button"
                  >
                    下载文案
                  </button>
                </div>
                <p className="creation-history__copy">{selectedBatch.copy.body || '（空文案）'}</p>
              </section>
            ) : null}
          </div>

          {selectedBatch.details.length > 0 ? (
            <section aria-labelledby="history-detail-heading" className="creation-history__section creation-history__section--details">
              <div className="creation-history__section-heading">
                <h2 id="history-detail-heading">详情页</h2>
                <button
                  onClick={() => selectedBatch.details.forEach((asset) => triggerPngDownload(asset.blob, asset.fileName))}
                  type="button"
                >
                  按顺序下载详情页
                </button>
              </div>
              <div className="creation-history__detail-grid">
                {selectedBatch.details.map((asset) => (
                  <figure className="creation-history__figure" key={asset.sha256}>
                    <div className="creation-history__preview">
                      <HistoryImagePreview asset={asset} />
                    </div>
                    <figcaption>{asset.title} · {asset.width} × {asset.height}</figcaption>
                  </figure>
                ))}
              </div>
            </section>
          ) : null}
        </div>

        <button className="text-action creation-history__back" onClick={onBackHome} type="button">
          返回首页
        </button>
      </section>
    )
  }

  return (
    <section aria-labelledby="creation-history-heading" className="creation-history">
      <header className="creation-history__intro">
        <p className="creation-history__eyebrow">HISTORY</p>
        <h1 id="creation-history-heading" ref={headingRef} tabIndex={-1}>历史记录</h1>
        <p>这里保存你确认过的文案、海报和详情页成果，按创作批次归档。</p>
      </header>

      {loading ? <p role="status">正在加载历史记录…</p> : null}
      {error ? <p role="alert">{error}</p> : null}

      {!loading && items.length === 0 ? (
        <section aria-label="暂无历史记录" className="creation-history__empty">
          <p>还没有确认过的创作成果。完成确认后，它们会自动出现在这里。</p>
        </section>
      ) : null}

      {!loading && items.length > 0 ? (
        <ul className="creation-history__list">
          {items.map((item) => (
            <li key={item.id}>
              <article className="creation-history__card">
                <div className="creation-history__card-preview">
                  {item.thumbnail ? (
                    <HistoryImagePreview asset={item.thumbnail} />
                  ) : (
                    <span className="creation-history__card-placeholder">文案</span>
                  )}
                </div>
                <div className="creation-history__card-copy">
                  <h2>{item.productShortName}</h2>
                  <p>{formatTimestamp(item.updatedAt)}</p>
                  <p>{artifactSummary(item)}</p>
                  <div className="creation-history__card-actions">
                    <button onClick={() => selectBatch(item.id)} type="button">查看详情</button>
                    <button data-action="destructive" onClick={() => void removeBatch(item.id)} type="button">删除</button>
                  </div>
                </div>
              </article>
            </li>
          ))}
        </ul>
      ) : null}

      <button className="text-action creation-history__back" onClick={onBackHome} type="button">
        返回首页
      </button>
    </section>
  )
}

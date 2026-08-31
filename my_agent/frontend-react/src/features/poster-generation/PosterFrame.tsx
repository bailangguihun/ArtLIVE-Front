import type {
  BinaryResourceState,
  NormalizedPosterSlot,
} from '../../types/poster-generation'

interface PosterFrameProps {
  preview: BinaryResourceState
  slot: NormalizedPosterSlot
  onRetryPreview: () => void
}

function nonReadyMessage(slot: NormalizedPosterSlot) {
  if (slot.status === 'waiting') {
    return '等待前一张海报完成'
  }
  if (slot.status === 'generating') {
    return `正在生成海报 ${slot.displayIndex}…`
  }
  if (slot.status === 'blocked') {
    return '因前一张生成失败，本张未开始'
  }
  const suffix =
    slot.status === 'failed' && slot.safeErrorCode
      ? `（${slot.safeErrorCode}）`
      : ''
  return `本张海报生成失败，未自动重试。${suffix}`
}

export function PosterFrame({
  onRetryPreview,
  preview,
  slot,
}: PosterFrameProps) {
  if (slot.status !== 'ready') {
    return (
      <div className="poster-frame poster-frame--state">
        <p>{nonReadyMessage(slot)}</p>
      </div>
    )
  }

  if (preview.status === 'ready' && preview.objectUrl) {
    return (
      <div className="poster-frame poster-frame--ready">
        <img
          alt={`海报 ${slot.displayIndex} 无字底预览`}
          src={preview.objectUrl}
        />
      </div>
    )
  }

  if (preview.status === 'error') {
    return (
      <div className="poster-frame poster-frame--state">
        <p role="alert">{preview.error}</p>
        <button
          className="poster-frame__retry"
          onClick={onRetryPreview}
          type="button"
        >
          重新加载预览
        </button>
      </div>
    )
  }

  return (
    <div
      aria-busy="true"
      className="poster-frame poster-frame--state"
      role="status"
    >
      <p>正在加载无字底图…</p>
    </div>
  )
}

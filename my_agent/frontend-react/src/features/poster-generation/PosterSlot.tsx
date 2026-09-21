import { useEffect } from 'react'
import { useWorkflowDispatch } from '../../state/use-workflow'
import type {
  NormalizedPosterSlot,
  PosterBinaryState,
} from '../../types/poster-generation'
import {
  emptyBinaryResourceState,
  POSTER_SLOT_TITLES,
} from '../../types/poster-generation'
import {
  fetchPosterPng,
  fetchPosterPreviewPng,
  POSTER_DOWNLOAD_ERROR_MESSAGE,
  POSTER_PREVIEW_ERROR_MESSAGE,
  PosterApiError,
  triggerBlobDownload,
} from './poster-api'
import { PosterFrame } from './PosterFrame'

interface PosterSlotProps {
  binary: PosterBinaryState | undefined
  selected: boolean
  slot: NormalizedPosterSlot
}

const EMPTY_BINARY: PosterBinaryState = {
  preview: emptyBinaryResourceState(),
  download: emptyBinaryResourceState(),
}

export function PosterSlot({ binary, selected, slot }: PosterSlotProps) {
  const dispatch = useWorkflowDispatch()
  const currentBinary = binary ?? EMPTY_BINARY
  const posterId = slot.posterId
  const previewUrl = slot.previewUrl

  useEffect(() => {
    if (
      slot.status !== 'ready' ||
      !posterId ||
      currentBinary.preview.status !== 'idle'
    ) {
      return
    }
    const controller = new AbortController()
    const startId = globalThis.setTimeout(() => {
      if (!previewUrl) {
        dispatch({
          type: 'POSTER_BINARY_FAILED',
          kind: 'preview',
          posterId,
          error: POSTER_PREVIEW_ERROR_MESSAGE,
        })
        return
      }
      void fetchPosterPreviewPng(previewUrl, controller.signal)
        .then((blob) => {
          if (controller.signal.aborted) {
            return
          }
          dispatch({
            type: 'POSTER_BINARY_SUCCEEDED',
            kind: 'preview',
            posterId,
            blob,
            objectUrl: URL.createObjectURL(blob),
          })
        })
        .catch(() => {
          if (controller.signal.aborted) {
            return
          }
          dispatch({
            type: 'POSTER_BINARY_FAILED',
            kind: 'preview',
            posterId,
            error: POSTER_PREVIEW_ERROR_MESSAGE,
          })
        })
    }, 0)

    return () => {
      globalThis.clearTimeout(startId)
      controller.abort()
    }
  }, [
    currentBinary.preview.status,
    dispatch,
    posterId,
    previewUrl,
    slot.status,
  ])

  const handleDownload = async () => {
    if (slot.status !== 'ready' || !posterId) {
      return
    }
    if (
      currentBinary.download.status === 'ready' &&
      currentBinary.download.objectUrl
    ) {
      triggerBlobDownload(
        currentBinary.download.objectUrl,
        `poster-base-${slot.displayIndex}.png`,
      )
      return
    }
    if (currentBinary.download.status === 'loading') {
      return
    }

    dispatch({ type: 'BEGIN_POSTER_BINARY', kind: 'download', posterId })
    try {
      if (!slot.downloadUrl) {
        throw new PosterApiError(POSTER_DOWNLOAD_ERROR_MESSAGE)
      }
      const blob = await fetchPosterPng(slot.downloadUrl)
      const objectUrl = URL.createObjectURL(blob)
      if (currentBinary.download.objectUrl) {
        URL.revokeObjectURL(currentBinary.download.objectUrl)
      }
      dispatch({
        type: 'POSTER_BINARY_SUCCEEDED',
        kind: 'download',
        posterId,
        blob,
        objectUrl,
      })
      triggerBlobDownload(objectUrl, `poster-base-${slot.displayIndex}.png`)
    } catch (error) {
      dispatch({
        type: 'POSTER_BINARY_FAILED',
        kind: 'download',
        posterId,
        error:
          error instanceof PosterApiError
            ? error.userMessage
            : POSTER_DOWNLOAD_ERROR_MESSAGE,
      })
    }
  }

  const retryPreview = () => {
    if (posterId) {
      dispatch({ type: 'RESET_POSTER_BINARY', kind: 'preview', posterId })
    }
  }

  return (
    <article
      className={`poster-slot${selected ? ' poster-slot--selected' : ''}`}
      data-poster-index={slot.displayIndex}
    >
      <h2>{POSTER_SLOT_TITLES[slot.displayIndex - 1]}</h2>
      <div className="poster-slot__body">
        <PosterFrame
          onRetryPreview={retryPreview}
          preview={currentBinary.preview}
          slot={slot}
        />
        <div className="poster-slot__actions">
          {slot.status === 'ready' && posterId ? (
            <>
              <button
                aria-pressed={selected}
                className="poster-slot__select"
                onClick={() =>
                  dispatch({
                    type: 'SELECT_POSTER_SLOT',
                    index: slot.displayIndex - 1,
                  })
                }
                type="button"
              >
                选用此底图
              </button>
              <button
                aria-busy={currentBinary.download.status === 'loading'}
                className="poster-slot__download"
                onClick={handleDownload}
                type="button"
              >
                下载无字底 PNG
              </button>
              {currentBinary.download.error ? (
                <p className="poster-slot__error" role="alert">
                  {currentBinary.download.error}
                </p>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </article>
  )
}

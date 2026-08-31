import { useEffect } from 'react'
import { useWorkflowDispatch } from '../../state/use-workflow'
import type {
  NormalizedOverallStatus,
  NormalizedSequenceResult,
} from '../../types/poster-generation'
import {
  getPosterGeneration,
  POSTER_POLL_ERROR_MESSAGE,
  PosterApiError,
} from './poster-api'
import { isTerminalSequenceStatus } from './poster-normalizer'

export const POSTER_POLL_INTERVAL_MS = 2_000

export function shouldPollPosterGeneration(
  activeGenerationId: string | null,
  result: NormalizedSequenceResult | null,
) {
  return Boolean(
    activeGenerationId &&
      result &&
      result.generationId === activeGenerationId &&
      !isTerminalSequenceStatus(result.status),
  )
}

export function usePosterPolling(
  activeGenerationId: string | null,
  status: NormalizedOverallStatus | null,
  result: NormalizedSequenceResult | null,
) {
  const dispatch = useWorkflowDispatch()

  useEffect(() => {
    if (!shouldPollPosterGeneration(activeGenerationId, result)) {
      return
    }

    let disposed = false
    let timerId: number | null = null
    let requestController: AbortController | null = null

    const schedule = () => {
      if (!disposed) {
        timerId = globalThis.setTimeout(runCycle, POSTER_POLL_INTERVAL_MS)
      }
    }

    const runCycle = async () => {
      if (disposed || !activeGenerationId) {
        return
      }
      requestController = new AbortController()
      try {
        const current = await getPosterGeneration(activeGenerationId, {
          signal: requestController.signal,
        })
        if (!disposed) {
          dispatch({
            type: 'APPLY_POSTER_RESULT',
            result: current,
            source: 'poll',
          })
        }
      } catch (error) {
        if (!disposed && !requestController.signal.aborted) {
          dispatch({
            type: 'SET_POSTER_POLL_ERROR',
            error:
              error instanceof PosterApiError
                ? error.userMessage
                : POSTER_POLL_ERROR_MESSAGE,
          })
        }
      } finally {
        requestController = null
        schedule()
      }
    }

    schedule()
    return () => {
      disposed = true
      if (timerId !== null) {
        globalThis.clearTimeout(timerId)
      }
      requestController?.abort()
    }
  }, [activeGenerationId, dispatch, result, status])
}

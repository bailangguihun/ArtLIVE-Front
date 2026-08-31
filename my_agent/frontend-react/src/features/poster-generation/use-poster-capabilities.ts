import { useEffect, useRef } from 'react'
import { useWorkflowDispatch } from '../../state/use-workflow'
import type { CapabilityLoadStatus } from '../../types/poster-generation'
import { getPosterCapabilities, PosterApiError } from './poster-api'

export function usePosterCapabilities(status: CapabilityLoadStatus) {
  const dispatch = useWorkflowDispatch()
  const initialStatusRef = useRef(status)

  useEffect(() => {
    if (initialStatusRef.current !== 'idle') {
      return
    }

    const controller = new AbortController()
    let active = true
    const startId = globalThis.setTimeout(() => {
      if (!active) {
        return
      }
      dispatch({ type: 'BEGIN_POSTER_CAPABILITIES' })
      void getPosterCapabilities(controller.signal)
        .then((capabilities) => {
          if (!active) {
            return
          }
          dispatch({
            type: 'POSTER_CAPABILITIES_SUCCEEDED',
            sequenceEnabled: capabilities.sequenceEnabled,
            seedreamConfigured: capabilities.seedreamConfigured,
          })
        })
        .catch((error: unknown) => {
          if (!active || controller.signal.aborted) {
            return
          }
          dispatch({
            type: 'POSTER_CAPABILITIES_FAILED',
            error:
              error instanceof PosterApiError
                ? error.userMessage
                : '无法读取海报生成功能状态。',
          })
        })
    }, 0)

    return () => {
      active = false
      globalThis.clearTimeout(startId)
      controller.abort()
    }
  }, [dispatch])
}

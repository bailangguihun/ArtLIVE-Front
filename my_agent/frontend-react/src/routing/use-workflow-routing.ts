import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Dispatch } from 'react'
import type { WorkflowAction, WorkflowState } from '../state/workflow-types'
import {
  canonicalPathForRoute,
  createWorkflowHistoryState,
  parseWorkflowPathname,
  readWorkflowHistoryState,
  resolveWorkflowRoute,
  routeForWorkflowState,
  routeHeadingId,
  routeReasonMessage,
  routeTitle,
} from './workflow-routes'
import type { WorkflowRouteId, WorkflowRouteReasonCode } from './workflow-routes'

type HistoryWrite = 'push' | 'replace' | 'pop'

interface PendingHistoryWrite {
  readonly route: WorkflowRouteId
  readonly mode: HistoryWrite
}

interface RoutingNotice {
  readonly code: string
  readonly message: string
}

interface WorkflowRouting {
  readonly notice: RoutingNotice | null
  setNoticeElement(node: HTMLParagraphElement | null): void
  navigate(route: WorkflowRouteId, mode?: Exclude<HistoryWrite, 'pop'>): void
  startNew(mode?: Exclude<HistoryWrite, 'pop'>): void
}

const BASE_PATH = import.meta.env.BASE_URL || '/'

function dispatchRouteCommand(
  dispatch: Dispatch<WorkflowAction>,
  command: ReturnType<typeof resolveWorkflowRoute>['command'],
): void {
  switch (command) {
    case 'none': return
    case 'start': dispatch({ type: 'START_V2_CREATION' }); return
    case 'home': dispatch({ type: 'V2_RETURN_HOME' }); return
    case 'history': dispatch({ type: 'ENTER_V2_HISTORY' }); return
    case 'basic': dispatch({ type: 'GO_TO_STEP_ONE' }); return
    case 'advice': dispatch({ type: 'ENTER_V2_ADVICE' }); return
    case 'workspace': dispatch({ type: 'ENTER_V2_WORKSPACE' }); return
    case 'copy': dispatch({ type: 'ENTER_V2_COPY' }); return
    case 'poster': dispatch({ type: 'ENTER_V2_POSTER' }); return
    case 'detail': dispatch({ type: 'ENTER_V2_LEGACY_DETAIL' }); return
    case 'results': dispatch({ type: 'ENTER_V2_RESULTS' }); return
  }
}

function entryId(): string {
  navigationEntrySequence += 1
  return `navigation-${navigationEntrySequence}`
}

let navigationEntrySequence = 0

function routingNotice(
  reasonCode: WorkflowRouteReasonCode | null,
): RoutingNotice | null {
  if (!reasonCode || reasonCode === 'session_missing') return null
  return { code: reasonCode, message: routeReasonMessage(reasonCode) }
}

function shouldFocusRouteNotice(reasonCode: WorkflowRouteReasonCode | null): boolean {
  return Boolean(reasonCode && reasonCode !== 'session_missing')
}

export function useWorkflowRouting(
  state: WorkflowState,
  dispatch: Dispatch<WorkflowAction>,
): WorkflowRouting {
  const stateRef = useRef(state)
  const dispatchRef = useRef(dispatch)
  const noticeRef = useRef<HTMLParagraphElement | null>(null)
  const pendingWriteRef = useRef<PendingHistoryWrite | null>(null)
  const pendingFocusRef = useRef<{ route: WorkflowRouteId; preferNotice: boolean } | null>(null)
  const initializedRef = useRef(false)
  const previousRouteRef = useRef<WorkflowRouteId | null>(null)
  const [notice, setNotice] = useState<RoutingNotice | null>(null)
  const [focusToken, setFocusToken] = useState(0)
  const [historyToken, setHistoryToken] = useState(0)
  const currentRoute = routeForWorkflowState(state)

  useLayoutEffect(() => {
    stateRef.current = state
    dispatchRef.current = dispatch
  }, [dispatch, state])

  const focusRoute = useCallback((route: WorkflowRouteId, preferNotice: boolean) => {
    pendingFocusRef.current = { route, preferNotice }
    setFocusToken((token) => token + 1)
  }, [])

  const applyLocation = useCallback((mode: HistoryWrite, historyState: unknown) => {
    const parsed = parseWorkflowPathname(window.location.pathname, BASE_PATH)
    const current = stateRef.current
    const stored = readWorkflowHistoryState(historyState)
    const staleEpoch = Boolean(
      stored &&
      current.workflowV2.phase === 'active' &&
      stored.workflowEpoch !== current.workflowV2.epoch,
    )
    // An active V2 state cannot exist after an actual document refresh because
    // the workflow is deliberately memory-only. This branch therefore keeps
    // injected integration-test/HMR state aligned with its existing view
    // instead of pretending that it was a fresh Home load at '/'.
    const injectedActiveRoot = mode === 'replace'
      && parsed.route === 'home'
      && !stored
      && current.workflowV2.phase === 'active'
      && current.workflowV2.view !== 'home'
    const resolution = staleEpoch
      ? resolveWorkflowRoute(current, 'basic')
      : injectedActiveRoot
        ? {
            route: routeForWorkflowState(current),
            accepted: true,
            command: 'none' as const,
            reasonCode: null,
          }
      : resolveWorkflowRoute(current, parsed.route)
    const reasonCode = staleEpoch ? 'stale_history_epoch' : resolution.reasonCode
    const accepted = resolution.accepted && !staleEpoch
    pendingWriteRef.current = {
      route: resolution.route,
      mode: accepted && mode === 'pop' ? 'pop' : 'replace',
    }
    setHistoryToken((token) => token + 1)
    setNotice(routingNotice(reasonCode))
    focusRoute(resolution.route, shouldFocusRouteNotice(reasonCode))
    dispatchRouteCommand(dispatchRef.current, resolution.command)
  }, [focusRoute])

  useLayoutEffect(() => {
    if (initializedRef.current) return
    initializedRef.current = true
    applyLocation('replace', window.history.state)
  }, [applyLocation])

  useEffect(() => {
    const onPopState = (event: PopStateEvent) => applyLocation('pop', event.state)
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [applyLocation])

  useLayoutEffect(() => {
    if (!initializedRef.current) return
    const pending = pendingWriteRef.current
    if (pending && pending.route !== currentRoute) return

    const canonicalPath = canonicalPathForRoute(currentRoute, BASE_PATH)
    const currentPath = window.location.pathname
    const currentHistory = readWorkflowHistoryState(window.history.state)
    const currentEpoch = state.workflowV2.epoch
    const stateMatches = currentHistory?.route === currentRoute && currentHistory.workflowEpoch === currentEpoch
    const routeChanged = previousRouteRef.current !== null && previousRouteRef.current !== currentRoute
    const writeMode = pending?.mode ?? (routeChanged ? 'push' : 'replace')

    if (writeMode !== 'pop' && (currentPath !== canonicalPath || !stateMatches)) {
      const nextState = createWorkflowHistoryState(currentRoute, currentEpoch, entryId())
      if (writeMode === 'push') window.history.pushState(nextState, '', canonicalPath)
      else window.history.replaceState(nextState, '', canonicalPath)
    }
    pendingWriteRef.current = null
    previousRouteRef.current = currentRoute
    if (!pending && routeChanged) setNotice(null)
    document.title = routeTitle(currentRoute)
  }, [currentRoute, historyToken, state.workflowV2.epoch])

  useEffect(() => {
    if (!initializedRef.current) return
    const pendingFocus = pendingFocusRef.current
    if (!pendingFocus || pendingFocus.route !== currentRoute) return
    if (pendingFocus.preferNotice) {
      // The route can settle before the notice state is committed.  Keep this
      // transaction pending until the guarded-entry explanation exists so an
      // initial deep-link rejection never focuses the destination heading.
      if (!notice) return
      pendingFocusRef.current = null
      noticeRef.current?.focus({ preventScroll: true })
      return
    }
    pendingFocusRef.current = null
    const heading = document.getElementById(routeHeadingId(currentRoute))
    if (!heading) return
    if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1')
    heading.focus({ preventScroll: true })
  }, [currentRoute, focusToken, notice])

  const navigate = useCallback((route: WorkflowRouteId, mode: Exclude<HistoryWrite, 'pop'> = 'push') => {
    const current = stateRef.current
    const resolution = resolveWorkflowRoute(current, route)
    const sameRoute = routeForWorkflowState(current) === resolution.route
    const effectiveMode = resolution.accepted ? mode : 'replace'
    if (!sameRoute || resolution.command === 'start') {
      pendingWriteRef.current = { route: resolution.route, mode: effectiveMode }
      setHistoryToken((token) => token + 1)
      dispatchRouteCommand(dispatchRef.current, resolution.command)
    }
    setNotice(routingNotice(resolution.reasonCode))
    focusRoute(resolution.route, shouldFocusRouteNotice(resolution.reasonCode))
  }, [focusRoute])

  const startNew = useCallback((mode: Exclude<HistoryWrite, 'pop'> = 'replace') => {
    pendingWriteRef.current = { route: 'basic', mode }
    setHistoryToken((token) => token + 1)
    setNotice(null)
    focusRoute('basic', false)
    dispatchRef.current({ type: 'START_V2_CREATION' })
  }, [focusRoute])

  const setNoticeElement = useCallback((node: HTMLParagraphElement | null) => {
    noticeRef.current = node
  }, [])

  return { notice, setNoticeElement, navigate, startNew }
}

import { detailProjectMatchesPosterRef } from '../features/detail-editor/v2-detail-adapter'
import { selectCurrentProgressiveResultsView } from '../features/progressive-results/progressive-results-model'
import type { WorkflowState } from '../state/workflow-types'
import {
  isAdviceCurrentForBasic,
  isConfirmedPosterCurrent,
  isConfirmedPosterInternallyConsistent,
  posterRefFromConfirmedPoster,
} from '../state/workflow-v2/workflow-v2-authorities'

export const WORKFLOW_ROUTE_TABLE = [
  { id: 'home', path: '/', title: '图文智绘' },
  { id: 'history', path: '/history', title: '历史记录 · 图文智绘' },
  { id: 'basic', path: '/basic', title: '基本信息 · 图文智绘' },
  { id: 'advice', path: '/advice', title: '营销建议 · 图文智绘' },
  { id: 'workspace', path: '/workspace', title: '创作工作台 · 图文智绘' },
  { id: 'copy', path: '/copy', title: '推广文案 · 图文智绘' },
  { id: 'poster', path: '/poster', title: '海报创作 · 图文智绘' },
  { id: 'detail', path: '/detail', title: '详情页编辑 · 图文智绘' },
  { id: 'results', path: '/results', title: '创作成果 · 图文智绘' },
] as const

export type WorkflowRouteId = (typeof WORKFLOW_ROUTE_TABLE)[number]['id']

export type WorkflowRouteCommand =
  | 'none'
  | 'start'
  | 'home'
  | 'history'
  | 'basic'
  | 'advice'
  | 'workspace'
  | 'copy'
  | 'poster'
  | 'detail'
  | 'results'

export type WorkflowRouteReasonCode =
  | 'unknown_path'
  | 'session_missing'
  | 'basic_missing'
  | 'advice_missing_or_stale'
  | 'workspace_unavailable'
  | 'copy_entry_locked'
  | 'poster_entry_locked'
  | 'detail_entry_locked'
  | 'results_unavailable'
  | 'stale_history_epoch'

export interface ParsedWorkflowPath {
  readonly route: WorkflowRouteId | null
  readonly canonicalPath: string | null
  readonly isCanonical: boolean
}

export interface WorkflowRouteResolution {
  readonly requested: WorkflowRouteId | null
  readonly route: WorkflowRouteId
  readonly command: WorkflowRouteCommand
  readonly accepted: boolean
  readonly reasonCode: WorkflowRouteReasonCode | null
}

export interface WorkflowHistoryState {
  readonly app: 'workflow-v2-routing'
  readonly version: 1
  readonly route: WorkflowRouteId
  readonly workflowEpoch: number
  readonly entryId: string
}

const routeByPath = new Map<string, (typeof WORKFLOW_ROUTE_TABLE)[number]>(
  WORKFLOW_ROUTE_TABLE.map((route) => [route.path, route]),
)
const routeById = new Map<WorkflowRouteId, (typeof WORKFLOW_ROUTE_TABLE)[number]>(
  WORKFLOW_ROUTE_TABLE.map((route) => [route.id, route]),
)

function normalizedBase(basePath = '/'): string {
  if (basePath === '/' || basePath === '') return '/'
  return `/${basePath.replace(/^\/+|\/+$/g, '')}/`
}

function stripBase(pathname: string, basePath = '/'): string | null {
  const base = normalizedBase(basePath)
  const safePathname = pathname.startsWith('/') ? pathname : `/${pathname}`
  if (base === '/') return safePathname
  const withoutTrailingSlash = base.slice(0, -1)
  if (safePathname === withoutTrailingSlash) return '/'
  if (!safePathname.startsWith(base)) return null
  return `/${safePathname.slice(base.length)}`.replace(/\/+/g, '/')
}

export function canonicalPathForRoute(
  route: WorkflowRouteId,
  basePath = '/',
): string {
  const routePath = routeById.get(route)?.path
  if (!routePath) throw new Error(`Unknown workflow route: ${route}`)
  const base = normalizedBase(basePath)
  return base === '/'
    ? routePath
    : routePath === '/'
      ? base.slice(0, -1)
      : `${base.slice(0, -1)}${routePath}`
}

export function parseWorkflowPathname(
  pathname: string,
  basePath = '/',
): ParsedWorkflowPath {
  const relativePath = stripBase(pathname, basePath)
  if (relativePath === null) {
    return { route: null, canonicalPath: null, isCanonical: false }
  }
  const route = routeByPath.get(relativePath) ??
    (relativePath.length > 1 ? routeByPath.get(relativePath.replace(/\/+$/, '')) : undefined)
  if (!route) return { route: null, canonicalPath: null, isCanonical: false }
  const canonicalPath = canonicalPathForRoute(route.id, basePath)
  return { route: route.id, canonicalPath, isCanonical: pathname === canonicalPath }
}

export function routeForWorkflowState(state: WorkflowState): WorkflowRouteId {
  if (state.workflowV2.view === 'history') return 'history'
  if (state.workflowV2.phase !== 'active') return 'home'
  switch (state.workflowV2.view) {
    case 'home': return 'home'
    case 'workflow': return 'basic'
    case 'advice': return 'advice'
    case 'workspace': return 'workspace'
    case 'copy': return 'copy'
    case 'poster': return 'poster'
    case 'detail': return 'detail'
    case 'results': return 'results'
  }
}

export function routeHeadingId(route: WorkflowRouteId): string {
  return {
    home: 'home-heading',
    history: 'creation-history-heading',
    basic: 'product-info-heading',
    advice: 'marketing-advice-heading',
    workspace: 'creation-workspace-heading',
    copy: 'platform-copy-heading',
    poster: 'poster-generation-heading',
    detail: 'detail-editor-heading',
    results: 'progressive-results-heading',
  }[route]
}

export function routeTitle(route: WorkflowRouteId): string {
  return routeById.get(route)?.title ?? '图文智绘'
}

export function routeReasonMessage(reason: WorkflowRouteReasonCode): string {
  return {
    unknown_path: '页面不存在或已不可用，已返回首页。',
    session_missing: '',
    basic_missing: '请先完成本轮基本信息。',
    advice_missing_or_stale: '请先获得适用于当前基本信息的营销建议。',
    workspace_unavailable: '创作工作台需要当前基本信息和营销建议。',
    copy_entry_locked: '当前条件不足，暂时不能进入推广文案。',
    poster_entry_locked: '当前条件不足，暂时不能进入海报创作。',
    detail_entry_locked: '详情页需要当前已确认海报及其匹配的详情页项目。',
    results_unavailable: '当前没有可安全展示的已确认创作成果。',
    stale_history_epoch: '此前历史记录属于较早的创作会话，已返回本轮安全入口。',
  }[reason]
}

function currentAdvice(state: WorkflowState): boolean {
  const { basicAuthority, adviceAuthority } = state.workflowV2
  return Boolean(basicAuthority && adviceAuthority && isAdviceCurrentForBasic(adviceAuthority, basicAuthority))
}

function currentPosterDetail(state: WorkflowState): boolean {
  const { basicAuthority, adviceAuthority, confirmedCopy, confirmedPoster, detailProject } = state.workflowV2
  if (
    !basicAuthority ||
    !adviceAuthority ||
    !confirmedPoster ||
    !detailProject ||
    !isAdviceCurrentForBasic(adviceAuthority, basicAuthority) ||
    !isConfirmedPosterInternallyConsistent(confirmedPoster) ||
    !isConfirmedPosterCurrent(
      confirmedPoster,
      basicAuthority,
      adviceAuthority,
      confirmedPoster.project.copyRef ? confirmedCopy : null,
    )
  ) return false
  return detailProjectMatchesPosterRef(detailProject, posterRefFromConfirmedPoster(confirmedPoster))
}

function earliestSafeRoute(state: WorkflowState): Pick<WorkflowRouteResolution, 'route' | 'command'> {
  if (state.workflowV2.phase !== 'active' || !state.workflowV2.basicAuthority) {
    return { route: 'basic', command: state.workflowV2.phase === 'active' ? 'basic' : 'start' }
  }
  if (!currentAdvice(state)) return { route: 'advice', command: 'advice' }
  return { route: 'workspace', command: 'workspace' }
}

function reject(
  state: WorkflowState,
  requested: WorkflowRouteId,
  reasonCode: WorkflowRouteReasonCode,
): WorkflowRouteResolution {
  return { requested, ...earliestSafeRoute(state), accepted: false, reasonCode }
}

export function resolveWorkflowRoute(
  state: WorkflowState,
  requested: WorkflowRouteId | null,
): WorkflowRouteResolution {
  if (requested === null) {
    return {
      requested: null,
      route: 'home',
      command: state.workflowV2.phase === 'active' ? 'home' : 'none',
      accepted: false,
      reasonCode: 'unknown_path',
    }
  }

  if (requested === 'home') {
    const shouldReturnHome =
      state.workflowV2.phase === 'active' || state.workflowV2.view === 'history'
    return {
      requested,
      route: 'home',
      command: shouldReturnHome ? 'home' : 'none',
      accepted: true,
      reasonCode: null,
    }
  }
  if (requested === 'history') {
    return { requested, route: 'history', command: 'history', accepted: true, reasonCode: null }
  }
  if (requested === 'basic') {
    return {
      requested,
      route: 'basic',
      command: state.workflowV2.phase === 'active' ? 'basic' : 'start',
      accepted: true,
      reasonCode: null,
    }
  }
  if (state.workflowV2.phase !== 'active') return reject(state, requested, 'session_missing')
  if (!state.workflowV2.basicAuthority) return reject(state, requested, 'basic_missing')
  if (requested === 'advice') {
    return { requested, route: 'advice', command: 'advice', accepted: true, reasonCode: null }
  }
  if (!currentAdvice(state)) return reject(state, requested, 'advice_missing_or_stale')
  if (requested === 'workspace') {
    return { requested, route: 'workspace', command: 'workspace', accepted: true, reasonCode: null }
  }
  if (requested === 'copy') {
    return { requested, route: 'copy', command: 'copy', accepted: true, reasonCode: null }
  }
  if (requested === 'poster') {
    return state.workflowV2.basicAuthority.productImage.kind === 'present'
      ? { requested, route: 'poster', command: 'poster', accepted: true, reasonCode: null }
      : reject(state, requested, 'poster_entry_locked')
  }
  if (requested === 'detail') {
    return currentPosterDetail(state)
      ? { requested, route: 'detail', command: 'detail', accepted: true, reasonCode: null }
      : reject(state, requested, 'detail_entry_locked')
  }
  return selectCurrentProgressiveResultsView(state).selection.mode !== 'none'
    ? { requested, route: 'results', command: 'results', accepted: true, reasonCode: null }
    : reject(state, requested, 'results_unavailable')
}

export function createWorkflowHistoryState(
  route: WorkflowRouteId,
  workflowEpoch: number,
  entryId: string,
): WorkflowHistoryState {
  return { app: 'workflow-v2-routing', version: 1, route, workflowEpoch, entryId }
}

export function readWorkflowHistoryState(value: unknown): WorkflowHistoryState | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<WorkflowHistoryState>
  if (
    candidate.app !== 'workflow-v2-routing' ||
    candidate.version !== 1 ||
    typeof candidate.workflowEpoch !== 'number' ||
    !Number.isInteger(candidate.workflowEpoch) ||
    typeof candidate.entryId !== 'string' ||
    !routeById.has(candidate.route as WorkflowRouteId)
  ) return null
  return candidate as WorkflowHistoryState
}

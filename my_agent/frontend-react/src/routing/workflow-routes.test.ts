import { describe, expect, it } from 'vitest'
import {
  createBasicAuthority,
  createConfirmedCopy,
  createCopyInputAuthority,
  createPresentAdviceAuthority,
} from '../state/workflow-v2/workflow-v2-authorities'
import { createInitialWorkflowState } from '../state/workflow-reducer'
import type { WorkflowState } from '../state/workflow-types'
import type { AdviceResult } from '../state/workflow-v2/workflow-v2-types'
import {
  WORKFLOW_ROUTE_TABLE,
  canonicalPathForRoute,
  createWorkflowHistoryState,
  parseWorkflowPathname,
  readWorkflowHistoryState,
  resolveWorkflowRoute,
  routeHeadingId,
  routeForWorkflowState,
  routeReasonMessage,
  routeTitle,
} from './workflow-routes'

const hash = (character: string) => character.repeat(64)

const ADVICE: AdviceResult = {
  category_id: 'fmcg', category_name: '快消品', confidence: 'low',
  matched_keywords: [], reason: 'fixture', score: 0,
  strategy: { id: 'fmcg', name: '策略', examples: '示例', traits: ['清晰'], tactics: ['说明'], one_liner: '方向' },
  source: 'desktop_ai_different_product_marketing_strategies',
}

async function activeState(options: { advice?: boolean; copy?: boolean; image?: boolean } = {}): Promise<WorkflowState> {
  const initial = createInitialWorkflowState()
  const basic = await createBasicAuthority({
    productInfo: '测试商品', productShortName: '商品', creativeNote: '说明',
    platform: 'xiaohongshu', style: 'premium',
    productImage: options.image === false ? null : { byteSha256: hash('1'), mimeType: 'image/png', byteSize: 64 },
  })
  const advice = options.advice === false ? null : await createPresentAdviceAuthority({
    api_version: 'v1', advice_version: 'catalog-v1', status: 'present',
    input_signature_sha256: basic.text.adviceInputSignatureSha256,
    advice_signature_sha256: hash('2'), advice: ADVICE,
  }, basic)
  const copy = options.copy && advice ? await createConfirmedCopy({
    copyInput: await createCopyInputAuthority(basic, advice), revision: 1,
    source: { kind: 'selected', selectedIndex: 0, candidateSignatureSha256: hash('3') },
    fields: { body: '当前推广文案', title: '标题', headline: '主标题', subline: '副标题' },
  }) : null
  return {
    ...initial,
    workflowV2: {
      ...initial.workflowV2,
      phase: 'active', view: 'workspace', resumeView: 'workspace', epoch: 7,
      basicAuthority: basic, adviceAuthority: advice, confirmedCopy: copy,
    },
  }
}

describe('Workflow V2 route table', () => {
  it('provides a complete canonical route-table bijection', () => {
    expect(WORKFLOW_ROUTE_TABLE.map((route) => route.id)).toEqual([
      'home', 'history', 'basic', 'advice', 'workspace', 'copy', 'poster', 'detail', 'results',
    ])
    expect(new Set(WORKFLOW_ROUTE_TABLE.map((route) => route.path)).size).toBe(WORKFLOW_ROUTE_TABLE.length)
    for (const route of WORKFLOW_ROUTE_TABLE) {
      expect(parseWorkflowPathname(route.path)).toMatchObject({ route: route.id, isCanonical: true })
      expect(canonicalPathForRoute(route.id)).toBe(route.path)
    }
  })

  it('parses known paths, canonicalizes one trailing slash, and rejects unknown paths', () => {
    expect(parseWorkflowPathname('/basic/')).toEqual({ route: 'basic', canonicalPath: '/basic', isCanonical: false })
    expect(parseWorkflowPathname('/results/')).toEqual({ route: 'results', canonicalPath: '/results', isCanonical: false })
    expect(parseWorkflowPathname('/not-a-workflow-page')).toEqual({ route: null, canonicalPath: null, isCanonical: false })
    expect(canonicalPathForRoute('copy', '/studio/')).toBe('/studio/copy')
    expect(parseWorkflowPathname('/studio/copy', '/studio/')).toMatchObject({ route: 'copy', isCanonical: true })
  })

  it('keeps route titles and primary heading identifiers stable for every canonical route', () => {
    for (const route of WORKFLOW_ROUTE_TABLE) {
      expect(routeTitle(route.id)).toBe(route.title)
      expect(routeHeadingId(route.id)).toMatch(/heading$/)
    }
  })

  it('fails paths outside a configured application base without treating them as app routes', () => {
    expect(parseWorkflowPathname('/copy', '/studio/')).toEqual({
      route: null, canonicalPath: null, isCanonical: false,
    })
    expect(parseWorkflowPathname('/studio/', '/studio/')).toMatchObject({
      route: 'home', canonicalPath: '/studio', isCanonical: false,
    })
    expect(parseWorkflowPathname('/studio/poster/', '/studio/')).toMatchObject({
      route: 'poster', canonicalPath: '/studio/poster', isCanonical: false,
    })
  })

  it('keeps Home valid and lets a fresh Basic path start an empty session', () => {
    const initial = createInitialWorkflowState()
    expect(resolveWorkflowRoute(initial, 'home')).toMatchObject({ accepted: true, route: 'home', command: 'none' })
    expect(resolveWorkflowRoute(initial, 'history')).toMatchObject({ accepted: true, route: 'history', command: 'history' })
    expect(resolveWorkflowRoute({
      ...initial,
      workflowV2: { ...initial.workflowV2, view: 'history' },
    }, 'home')).toMatchObject({ accepted: true, route: 'home', command: 'home' })
    expect(resolveWorkflowRoute(initial, 'basic')).toMatchObject({ accepted: true, route: 'basic', command: 'start' })
    expect(routeForWorkflowState(initial)).toBe('home')
  })

  it('fails fresh protected routes closed to the earliest safe Basic entry', () => {
    const initial = createInitialWorkflowState()
    for (const route of ['advice', 'workspace', 'copy', 'poster', 'detail', 'results'] as const) {
      expect(resolveWorkflowRoute(initial, route)).toMatchObject({
        requested: route, accepted: false, route: 'basic', command: 'start', reasonCode: 'session_missing',
      })
    }
  })

  it('uses Home as the safe visible fallback for an unknown route without inventing a session', () => {
    const initial = createInitialWorkflowState()
    expect(resolveWorkflowRoute(initial, null)).toMatchObject({
      requested: null, accepted: false, route: 'home', command: 'none', reasonCode: 'unknown_path',
    })
    expect(routeReasonMessage('unknown_path')).not.toMatch(/signature|sha|request/i)
  })

  it('uses the existing Basic and Advice prerequisites for Advice and Workspace', async () => {
    const noAdvice = await activeState({ advice: false })
    expect(resolveWorkflowRoute(noAdvice, 'advice')).toMatchObject({ accepted: true, route: 'advice', command: 'advice' })
    expect(resolveWorkflowRoute(noAdvice, 'workspace')).toMatchObject({
      accepted: false, route: 'advice', command: 'advice', reasonCode: 'advice_missing_or_stale',
    })
    const workspace = await activeState()
    expect(resolveWorkflowRoute(workspace, 'workspace')).toMatchObject({ accepted: true, command: 'workspace' })
    expect(resolveWorkflowRoute(workspace, 'copy')).toMatchObject({ accepted: true, command: 'copy' })
  })

  it('fails active routes to Basic when a live active session has no Basic authority', () => {
    const initial = createInitialWorkflowState()
    const activeWithoutBasic: WorkflowState = {
      ...initial,
      workflowV2: { ...initial.workflowV2, phase: 'active', view: 'workspace', resumeView: 'workspace', epoch: 4 },
    }
    expect(resolveWorkflowRoute(activeWithoutBasic, 'workspace')).toMatchObject({
      accepted: false, route: 'basic', command: 'basic', reasonCode: 'basic_missing',
    })
    expect(resolveWorkflowRoute(activeWithoutBasic, 'copy')).toMatchObject({
      accepted: false, route: 'basic', command: 'basic', reasonCode: 'basic_missing',
    })
  })

  it('maps every active V2 view back to its canonical route intent', async () => {
    const workspace = await activeState()
    const views = ['home', 'history', 'workflow', 'advice', 'workspace', 'copy', 'poster', 'detail', 'results'] as const
    const routes = ['home', 'history', 'basic', 'advice', 'workspace', 'copy', 'poster', 'detail', 'results'] as const
    for (const [index, view] of views.entries()) {
      expect(routeForWorkflowState({
        ...workspace,
        workflowV2: {
          ...workspace.workflowV2,
          view,
          resumeView: view === 'home' ? 'workspace' : view,
        },
      })).toBe(routes[index])
    }
  })

  it('reuses current Poster and Results eligibility without turning stale or incomplete work into authority', async () => {
    const noImage = await activeState({ image: false })
    expect(resolveWorkflowRoute(noImage, 'poster')).toMatchObject({
      accepted: false, route: 'workspace', reasonCode: 'poster_entry_locked',
    })
    const copyOnly = await activeState({ copy: true })
    expect(resolveWorkflowRoute(copyOnly, 'results')).toMatchObject({ accepted: true, route: 'results', command: 'results' })
    expect(resolveWorkflowRoute(copyOnly, 'detail')).toMatchObject({
      accepted: false, route: 'workspace', reasonCode: 'detail_entry_locked',
    })
    const noResults = await activeState()
    expect(resolveWorkflowRoute(noResults, 'results')).toMatchObject({
      accepted: false, route: 'workspace', reasonCode: 'results_unavailable',
    })
  })

  it('creates a minimal versioned history state without workflow business data', () => {
    const history = createWorkflowHistoryState('workspace', 7, 'entry-7')
    expect(history).toEqual({
      app: 'workflow-v2-routing', version: 1, route: 'workspace', workflowEpoch: 7, entryId: 'entry-7',
    })
    expect(readWorkflowHistoryState(history)).toEqual(history)
    expect(readWorkflowHistoryState({ ...history, route: 'invalid' })).toBeNull()
    expect(readWorkflowHistoryState({ ...history, version: 2 })).toBeNull()
    expect(readWorkflowHistoryState({ ...history, workflowEpoch: 1.5 })).toBeNull()
    expect(readWorkflowHistoryState({ ...history, entryId: 7 })).toBeNull()
    expect(JSON.stringify(history)).not.toMatch(/Blob|File|objectUrl|authority|copyDraft|productInfo/i)
  })
})

import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode, useEffect } from 'react'
import type { Dispatch } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createBasicAuthority,
  createConfirmedCopy,
  createCopyInputAuthority,
  createPresentAdviceAuthority,
} from '../../state/workflow-v2/workflow-v2-authorities'
import type { AdviceResult } from '../../state/workflow-v2/workflow-v2-types'
import { createInitialWorkflowState } from '../../state/workflow-reducer'
import { WorkflowProvider } from '../../state/WorkflowProvider'
import { useWorkflowDispatch, useWorkflowState } from '../../state/use-workflow'
import type { WorkflowAction, WorkflowState } from '../../state/workflow-types'
import {
  syncCreationHistoryFromWorkflow,
} from '../creation-history/creation-history-archive'
import { getCreationHistoryBatch } from '../creation-history/creation-history-store'
import { CreationWorkspace } from './CreationWorkspace'

const historySyncControl = vi.hoisted(() => ({
  implementation: null as null | ((state: WorkflowState) => Promise<void>),
}))

vi.mock('../creation-history/creation-history-archive', async (importOriginal) => {
  const original = await importOriginal<
    typeof import('../creation-history/creation-history-archive')
  >()
  return {
    ...original,
    syncCreationHistoryFromWorkflow: vi.fn((state: WorkflowState) => (
      historySyncControl.implementation?.(state) ??
      original.syncCreationHistoryFromWorkflow(state)
    )),
  }
})

const historySyncMock = vi.mocked(syncCreationHistoryFromWorkflow)

const hash = (character: string) => character.repeat(64)
const adviceResult: AdviceResult = {
  category_id: 'fmcg', category_name: '快速消费品', confidence: 'low',
  matched_keywords: [], reason: 'fixture', score: 0,
  strategy: { id: 'fmcg', name: '策略', examples: '示例', traits: ['清晰'], tactics: ['说明'], one_liner: '方向' },
  source: 'desktop_ai_different_product_marketing_strategies',
}

async function workspaceState(withCopy: boolean): Promise<WorkflowState> {
  const initial = createInitialWorkflowState()
  const basic = await createBasicAuthority({
    productInfo: '测试商品', productShortName: '商品', creativeNote: '说明',
    platform: 'xiaohongshu', style: 'premium', productImage: null,
  })
  const advice = await createPresentAdviceAuthority({
    api_version: 'v1', advice_version: 'catalog-v1', status: 'present',
    input_signature_sha256: basic.text.adviceInputSignatureSha256,
    advice_signature_sha256: hash('2'), advice: adviceResult,
  }, basic)
  const copy = withCopy ? await createConfirmedCopy({
    copyInput: await createCopyInputAuthority(basic, advice), revision: 1,
    source: { kind: 'selected', selectedIndex: 0, candidateSignatureSha256: hash('3') },
    fields: { body: '当前推广文案', title: '标题', headline: '主标题', subline: '副标题' },
  }) : null
  const copyVariant = copy ? {
    body: copy.body,
    title: copy.title,
    headline: copy.headline,
    subline: copy.subline,
  } : null
  return {
    ...initial,
    platformCopy: copyVariant ? {
      ...initial.platformCopy,
      platform: 'xiaohongshu',
      style: 'premium',
      copyDraft: copyVariant.body,
      platformCopy: copyVariant,
      variants: [copyVariant],
      selectedVariantIndex: 0,
      generationPlatform: 'xiaohongshu',
      generationStyle: 'premium',
      marketingStrategy: { name: '策略' },
      strategyOwner: {
        sourceKind: 'copy',
        intentFingerprint: hash('4'),
        idempotencyKey: 'fixture-copy',
        requestId: 'fixture-request',
        platform: 'xiaohongshu',
        style: 'premium',
      },
    } : initial.platformCopy,
    workflowV2: {
      ...initial.workflowV2,
      phase: 'active', view: 'workspace', resumeView: 'workspace', epoch: 1,
      basicAuthority: basic, adviceAuthority: advice, confirmedCopy: copy,
    },
  }
}

async function revisedCopy(
  state: WorkflowState,
  revision: number,
  body: string,
) {
  const basic = state.workflowV2.basicAuthority
  const advice = state.workflowV2.adviceAuthority
  if (!basic || !advice) throw new Error('fixture requires Basic and Advice authority')
  return createConfirmedCopy({
    copyInput: await createCopyInputAuthority(basic, advice),
    revision,
    source: {
      kind: 'selected',
      selectedIndex: 0,
      candidateSignatureSha256: hash(String(revision + 4)),
    },
    fields: { body, title: `title-${revision}`, headline: '', subline: '' },
  })
}

function deferred() {
  let resolve!: () => void
  let reject!: (error: unknown) => void
  const promise = new Promise<void>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, reject, resolve }
}

function StateProbe({
  onDispatch,
  onState,
}: {
  onDispatch?: (dispatch: Dispatch<WorkflowAction>) => void
  onState: (state: WorkflowState) => void
}) {
  const dispatch = useWorkflowDispatch()
  const state = useWorkflowState()
  useEffect(() => { onDispatch?.(dispatch) }, [dispatch, onDispatch])
  useEffect(() => { onState(state) }, [onState, state])
  return null
}

function syncPromise(index: number): Promise<void> {
  const result = historySyncMock.mock.results[index]
  if (!result || result.type !== 'return') {
    throw new Error(`history sync call ${index} did not return a Promise`)
  }
  return result.value
}

beforeEach(() => {
  historySyncControl.implementation = null
  historySyncMock.mockClear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Workspace Progressive Results entry', () => {
  it('keeps the locked entry in Workspace and moves focus to its explanation', async () => {
    const user = userEvent.setup()
    const state = await workspaceState(false)
    render(<WorkflowProvider initialState={state}><CreationWorkspace /></WorkflowProvider>)
    await act(async () => { await syncPromise(0) })
    expect(screen.getByRole('heading', { name: '宣传文案' }).closest('section')).toHaveAttribute('data-status', 'ready')
    expect(screen.getByRole('heading', { name: '海报创作' }).closest('section')).toHaveAttribute('data-status', 'locked')
    const entry = screen.getByRole('button', { name: '查看创作成果' })
    expect(entry).toBeEnabled()
    expect(entry).toHaveAttribute('aria-disabled', 'true')
    await user.click(entry)
    expect(document.activeElement).toHaveTextContent('当前没有可安全展示的确认成果')
    expect(screen.getByRole('heading', { name: '创作工作台' })).toBeVisible()
  })

  it('enters the unnumbered Results view without mutating a current confirmed Copy', async () => {
    const user = userEvent.setup()
    const state = await workspaceState(true)
    const observed: { current: WorkflowState | null } = { current: null }
    render(
      <WorkflowProvider initialState={state}>
        <CreationWorkspace />
        <StateProbe onState={(next) => { observed.current = next }} />
      </WorkflowProvider>,
    )
    await act(async () => { await syncPromise(0) })
    expect(await getCreationHistoryBatch('session-1')).toMatchObject({
      epoch: 1,
      copy: { body: state.workflowV2.confirmedCopy?.body },
    })
    await user.click(screen.getByRole('button', { name: '查看创作成果' }))
    const finalState = observed.current
    expect(finalState).not.toBeNull()
    if (!finalState) throw new Error('state probe did not receive the Results transition')
    expect(finalState.workflowV2.view).toBe('results')
    expect(finalState.workflowV2.confirmedCopy).toBe(state.workflowV2.confirmedCopy)
    expect(finalState.workflowV2.basicAuthority).toBe(state.workflowV2.basicAuthority)
    expect(finalState.workflowV2.adviceAuthority).toBe(state.workflowV2.adviceAuthority)
  })

  it('persists one active history snapshot and deduplicates StrictMode effect replay', async () => {
    const gate = deferred()
    historySyncControl.implementation = vi.fn(() => gate.promise)
    const state = await workspaceState(true)
    const rendered = render(
      <StrictMode>
        <WorkflowProvider initialState={state}>
          <CreationWorkspace />
        </WorkflowProvider>
      </StrictMode>,
    )

    expect(historySyncMock).toHaveBeenCalledTimes(1)
    expect(historySyncMock.mock.calls[0]?.[0].workflowV2.confirmedCopy)
      .toBe(state.workflowV2.confirmedCopy)

    await act(async () => {
      gate.resolve()
      await gate.promise
    })
    rendered.unmount()
  })

  it('serializes rapid same-epoch history changes without stale overwrite or duplicate work', async () => {
    const gates: ReturnType<typeof deferred>[] = []
    historySyncControl.implementation = vi.fn(() => {
      const gate = deferred()
      gates.push(gate)
      return gate.promise
    })
    const state = await workspaceState(true)
    const copy2 = await revisedCopy(state, 2, 'revision two')
    const copy3 = await revisedCopy(state, 3, 'revision three')
    const probe: {
      dispatch: Dispatch<WorkflowAction> | null
      state: WorkflowState | null
    } = { dispatch: null, state: null }
    render(
      <WorkflowProvider initialState={state}>
        <CreationWorkspace />
        <StateProbe
          onDispatch={(dispatch) => { probe.dispatch = dispatch }}
          onState={(next) => { probe.state = next }}
        />
      </WorkflowProvider>,
    )
    const dispatch = probe.dispatch
    if (!dispatch) throw new Error('dispatch probe was not initialized')

    act(() => {
      dispatch({ type: 'UPDATE_STEP_TWO_DRAFT', value: copy2.body })
      dispatch({ type: 'COMMIT_V2_CONFIRMED_COPY', copy: copy2 })
    })
    act(() => {
      dispatch({ type: 'UPDATE_STEP_TWO_DRAFT', value: copy3.body })
      dispatch({ type: 'COMMIT_V2_CONFIRMED_COPY', copy: copy3 })
    })
    expect(historySyncMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      gates[0]?.resolve()
      await gates[0]?.promise
    })
    expect(historySyncMock).toHaveBeenCalledTimes(2)
    expect(historySyncMock.mock.calls[1]?.[0].workflowV2.confirmedCopy)
      .toBe(copy2)

    await act(async () => {
      gates[1]?.resolve()
      await gates[1]?.promise
    })
    expect(historySyncMock).toHaveBeenCalledTimes(3)
    expect(historySyncMock.mock.calls[2]?.[0].workflowV2.confirmedCopy)
      .toBe(copy3)

    await act(async () => {
      gates[2]?.resolve()
      await gates[2]?.promise
    })
    expect(probe.state?.workflowV2.confirmedCopy).toBe(copy3)
  })

  it('preserves queued prior-epoch history across reset and supersession', async () => {
    const gates: ReturnType<typeof deferred>[] = []
    historySyncControl.implementation = vi.fn(() => {
      const gate = deferred()
      gates.push(gate)
      return gate.promise
    })
    const state = await workspaceState(true)
    const copy2 = await revisedCopy(state, 2, 'final epoch one copy')
    const probe: { dispatch: Dispatch<WorkflowAction> | null } = { dispatch: null }
    render(
      <WorkflowProvider initialState={state}>
        <CreationWorkspace />
        <StateProbe
          onDispatch={(dispatch) => { probe.dispatch = dispatch }}
          onState={() => {}}
        />
      </WorkflowProvider>,
    )
    const dispatch = probe.dispatch
    if (!dispatch) throw new Error('dispatch probe was not initialized')

    act(() => {
      dispatch({ type: 'UPDATE_STEP_TWO_DRAFT', value: copy2.body })
      dispatch({ type: 'COMMIT_V2_CONFIRMED_COPY', copy: copy2 })
    })
    act(() => { dispatch({ type: 'START_V2_CREATION' }) })
    expect(historySyncMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      gates[0]?.resolve()
      await gates[0]?.promise
    })
    expect(historySyncMock).toHaveBeenCalledTimes(2)
    expect(historySyncMock.mock.calls[1]?.[0].workflowV2.confirmedCopy)
      .toBe(copy2)

    await act(async () => {
      gates[1]?.resolve()
      await gates[1]?.promise
    })
    expect(historySyncMock).toHaveBeenCalledTimes(3)
    expect(historySyncMock.mock.calls.map(([snapshot]) => snapshot.workflowV2.epoch))
      .toEqual([1, 1, 2])

    await act(async () => {
      gates[2]?.resolve()
      await gates[2]?.promise
    })
  })

  it('drains owned work on Provider disposal without late React updates', async () => {
    const gates: ReturnType<typeof deferred>[] = []
    historySyncControl.implementation = vi.fn(() => {
      const gate = deferred()
      gates.push(gate)
      return gate.promise
    })
    const state = await workspaceState(true)
    const copy2 = await revisedCopy(state, 2, 'queued before disposal')
    const probe: {
      dispatch: Dispatch<WorkflowAction> | null
      stateCalls: number
    } = { dispatch: null, stateCalls: 0 }
    const rendered = render(
      <WorkflowProvider initialState={state}>
        <CreationWorkspace />
        <StateProbe
          onDispatch={(dispatch) => { probe.dispatch = dispatch }}
          onState={() => { probe.stateCalls += 1 }}
        />
      </WorkflowProvider>,
    )
    const dispatch = probe.dispatch
    if (!dispatch) throw new Error('dispatch probe was not initialized')
    act(() => {
      dispatch({ type: 'UPDATE_STEP_TWO_DRAFT', value: copy2.body })
      dispatch({ type: 'COMMIT_V2_CONFIRMED_COPY', copy: copy2 })
    })
    const callsBeforeUnmount = probe.stateCalls
    rendered.unmount()

    await act(async () => {
      gates[0]?.resolve()
      await gates[0]?.promise
    })
    expect(historySyncMock).toHaveBeenCalledTimes(2)
    expect(historySyncMock.mock.calls[1]?.[0].workflowV2.confirmedCopy)
      .toBe(copy2)

    await act(async () => {
      gates[1]?.resolve()
      await gates[1]?.promise
    })
    expect(probe.stateCalls).toBe(callsBeforeUnmount)
  })

  it('reports one history-sync rejection and continues later queued work', async () => {
    const gates: ReturnType<typeof deferred>[] = []
    historySyncControl.implementation = vi.fn(() => {
      const gate = deferred()
      gates.push(gate)
      return gate.promise
    })
    const reportError = vi.fn()
    vi.stubGlobal('reportError', reportError)
    const state = await workspaceState(true)
    const copy2 = await revisedCopy(state, 2, 'recovery copy')
    const probe: { dispatch: Dispatch<WorkflowAction> | null } = { dispatch: null }
    render(
      <WorkflowProvider initialState={state}>
        <CreationWorkspace />
        <StateProbe
          onDispatch={(dispatch) => { probe.dispatch = dispatch }}
          onState={() => {}}
        />
      </WorkflowProvider>,
    )
    const dispatch = probe.dispatch
    if (!dispatch) throw new Error('dispatch probe was not initialized')
    act(() => {
      dispatch({ type: 'UPDATE_STEP_TWO_DRAFT', value: copy2.body })
      dispatch({ type: 'COMMIT_V2_CONFIRMED_COPY', copy: copy2 })
    })

    const failure = new Error('deterministic history failure')
    await act(async () => {
      gates[0]?.reject(failure)
      await expect(gates[0]?.promise).rejects.toBe(failure)
    })
    expect(reportError).toHaveBeenCalledTimes(1)
    expect(reportError).toHaveBeenCalledWith(failure)
    expect(historySyncMock).toHaveBeenCalledTimes(2)
    expect(historySyncMock.mock.calls[1]?.[0].workflowV2.confirmedCopy)
      .toBe(copy2)

    await act(async () => {
      gates[1]?.resolve()
      await gates[1]?.promise
    })
    expect(reportError).toHaveBeenCalledTimes(1)
  })

  it('routes a sync rejection through the standard error event when reportError is unavailable', async () => {
    const gate = deferred()
    historySyncControl.implementation = vi.fn(() => gate.promise)
    vi.stubGlobal('reportError', undefined)
    const errorEvents: ErrorEvent[] = []
    const onError = (event: ErrorEvent) => {
      errorEvents.push(event)
    }
    window.addEventListener('error', onError)
    const state = await workspaceState(true)

    try {
      render(
        <WorkflowProvider initialState={state}>
          <CreationWorkspace />
        </WorkflowProvider>,
      )
      const failure = new Error('deterministic fallback history failure')
      await act(async () => {
        gate.reject(failure)
        await expect(gate.promise).rejects.toBe(failure)
      })

      expect(errorEvents).toHaveLength(1)
      expect(errorEvents[0]?.error).toBe(failure)
      expect(errorEvents[0]?.message).toBe(failure.message)
    } finally {
      window.removeEventListener('error', onError)
    }
  })
})

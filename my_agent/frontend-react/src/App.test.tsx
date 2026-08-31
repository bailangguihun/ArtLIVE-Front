import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { WorkflowProvider } from './state/WorkflowProvider'
import { useWorkflowState } from './state/use-workflow'
import { createInitialWorkflowState } from './state/workflow-reducer'
import type { WorkflowState } from './state/workflow-types'
import {
  createBasicAuthority,
  createConfirmedCopy,
  createCopyInputAuthority,
  createPresentAdviceAuthority,
} from './state/workflow-v2/workflow-v2-authorities'
import type { AdviceResult } from './state/workflow-v2/workflow-v2-types'

let observed: WorkflowState | null = null

const TEST_ADVICE: AdviceResult = {
  category_id: 'fmcg', category_name: '快速消费品', confidence: 'low',
  matched_keywords: [], reason: 'fixture', score: 0,
  strategy: { id: 'fmcg', name: '策略', examples: '示例', traits: ['清晰'], tactics: ['说明'], one_liner: '方向' },
  source: 'desktop_ai_different_product_marketing_strategies',
}

function StateProbe() {
  const state = useWorkflowState()
  useEffect(() => { observed = state }, [state])
  return null
}

function stateWithPendingDetailImage(): WorkflowState {
  const initial = createInitialWorkflowState()
  return {
    ...initial,
    workflowV2: {
      ...initial.workflowV2,
      phase: 'active',
      view: 'detail',
      resumeView: 'detail',
      epoch: 1,
    },
    detailEditor: {
      ...initial.detailEditor,
      owner: {
        generationId: '11111111-1111-4111-8111-111111111111',
        posterId: '22222222-2222-4222-8222-222222222222',
        inputSignatureSha256: 'a'.repeat(64),
        pngBlobSha256: 'b'.repeat(64),
      },
      operations: { ...initial.detailEditor.operations, imageBusy: true, imageStatus: '正在去除背景…' },
    },
  }
}

async function workspaceStateWithConfirmedCopy(): Promise<WorkflowState> {
  const initial = createInitialWorkflowState()
  const basic = await createBasicAuthority({
    productInfo: '测试商品', productShortName: '商品', creativeNote: '说明',
    platform: 'xiaohongshu', style: 'premium', productImage: null,
  })
  const advice = await createPresentAdviceAuthority({
    api_version: 'v1', advice_version: 'catalog-v1', status: 'present',
    input_signature_sha256: basic.text.adviceInputSignatureSha256,
    advice_signature_sha256: 'a'.repeat(64), advice: TEST_ADVICE,
  }, basic)
  const copy = await createConfirmedCopy({
    copyInput: await createCopyInputAuthority(basic, advice), revision: 1,
    source: { kind: 'selected', selectedIndex: 0, candidateSignatureSha256: 'b'.repeat(64) },
    fields: { body: '当前文案', title: '标题', headline: '主标题', subline: '副标题' },
  })
  return {
    ...initial,
    workflowV2: {
      ...initial.workflowV2,
      phase: 'active', view: 'workspace', resumeView: 'workspace', epoch: 1,
      basicAuthority: basic, adviceAuthority: advice, confirmedCopy: copy,
    },
  }
}

describe('App active-session Home navigation', () => {
  beforeEach(() => {
    observed = null
    vi.spyOn(globalThis, 'fetch')
    window.history.replaceState(null, '', '/')
  })

  afterEach(() => window.history.replaceState(null, '', '/'))

  it('keeps native Home operable while Detail image work is pending and returns Home without resetting or requesting work', async () => {
    const user = userEvent.setup()
    const state = stateWithPendingDetailImage()
    render(
      <WorkflowProvider initialState={state}>
        <App />
        <StateProbe />
      </WorkflowProvider>,
    )

    const home = screen.getByRole('button', { name: /返回首页/ })
    expect(home).toBeEnabled()
    await user.click(home)
    expect(await screen.findByRole('button', { name: '继续本轮创作' })).toBeVisible()
    expect(window.location.pathname).toBe('/')
    expect(observed?.workflowV2.phase).toBe('active')
    expect(observed?.workflowV2.epoch).toBe(1)
    expect(observed?.workflowV2.view).toBe('home')
    expect(observed?.workflowV2.resumeView).toBe('detail')
    expect(observed?.detailEditor.operations.imageBusy).toBe(false)
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('returns to current Results through Home Continue without requests or authority mutation', async () => {
    const user = userEvent.setup()
    const state = await workspaceStateWithConfirmedCopy()
    window.history.replaceState(null, '', '/workspace')
    render(
      <WorkflowProvider initialState={state}>
        <App />
        <StateProbe />
      </WorkflowProvider>,
    )
    await user.click(await screen.findByRole('button', { name: '查看创作成果' }))
    expect(await screen.findByRole('heading', { name: '创作成果' })).toBeVisible()
    expect(window.location.pathname).toBe('/results')
    const copy = observed?.workflowV2.confirmedCopy
    await user.click(screen.getByRole('button', { name: /返回首页/ }))
    expect(await screen.findByRole('button', { name: '继续本轮创作' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: '继续本轮创作' }))
    expect(await screen.findByRole('heading', { name: '创作成果' })).toBeVisible()
    expect(window.location.pathname).toBe('/results')
    expect(observed?.workflowV2.confirmedCopy).toBe(copy)
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })
})

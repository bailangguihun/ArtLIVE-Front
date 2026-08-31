import { describe, expect, it } from 'vitest'
import {
  createInitialWorkflowState,
  workflowReducer,
} from '../../state/workflow-reducer'
import type { WorkflowState } from '../../state/workflow-types'
import { getPlatformCopyValidationError } from './validation'

function successfulCopyState(): WorkflowState {
  let state = createInitialWorkflowState()
  state = workflowReducer(state, {
    type: 'BEGIN_COPY_GENERATION',
    fingerprint: 'fingerprint-one',
    idempotencyKey: 'key-one',
  })
  state = workflowReducer(state, {
    type: 'COPY_GENERATION_SUCCEEDED',
    fingerprint: 'fingerprint-one',
    idempotencyKey: 'key-one',
    variants: [
      {
        body: '保留正文',
        title: '保留标题',
        headline: '保留主标',
        subline: '保留副标',
      },
    ],
    marketingStrategy: { name: '保留策略' },
    requestId: null,
    generationPlatform: 'xiaohongshu',
    generationStyle: 'premium',
  })
  return workflowReducer(state, { type: 'END_COPY_GENERATION' })
}

describe('platform-copy workflow state', () => {
  it('preserves successful copy data when Step 1 text changes', () => {
    const state = successfulCopyState()
    const changed = workflowReducer(state, {
      type: 'UPDATE_STEP_ONE_FIELD',
      field: 'productInfo',
      value: '新的产品信息',
    })

    expect(changed.platformCopy.variants).toEqual(state.platformCopy.variants)
    expect(changed.platformCopy.copyDraft).toBe('保留正文')
    expect(changed.platformCopy.platformCopy).toEqual(
      state.platformCopy.platformCopy,
    )
    expect(changed.platformCopy.marketingStrategy).toEqual({ name: '保留策略' })
  })

  it('applies captured response markers without relabeling a newer selection', () => {
    let pending = createInitialWorkflowState()
    pending = workflowReducer(pending, {
      type: 'BEGIN_COPY_GENERATION',
      fingerprint: 'captured-fingerprint',
      idempotencyKey: 'captured-key',
    })

    const abnormalNewerSelection: WorkflowState = {
      ...pending,
      platformCopy: { ...pending.platformCopy, platform: 'douyin' },
    }
    const resolved = workflowReducer(abnormalNewerSelection, {
      type: 'COPY_GENERATION_SUCCEEDED',
      fingerprint: 'captured-fingerprint',
      idempotencyKey: 'captured-key',
      variants: [{ body: '旧请求结果' }],
      marketingStrategy: {},
      requestId: null,
      generationPlatform: 'xiaohongshu',
      generationStyle: 'premium',
    })

    expect(resolved.platformCopy.platform).toBe('douyin')
    expect(resolved.platformCopy.generationPlatform).toBe('xiaohongshu')
    expect(getPlatformCopyValidationError(resolved.platformCopy)).toBe(
      '平台已切换，请重新生成文案。',
    )
  })

  it('ignores a response that no longer matches the pending intent', () => {
    let pending = createInitialWorkflowState()
    pending = workflowReducer(pending, {
      type: 'BEGIN_COPY_GENERATION',
      fingerprint: 'new-fingerprint',
      idempotencyKey: 'new-key',
    })
    const unchanged = workflowReducer(pending, {
      type: 'COPY_GENERATION_SUCCEEDED',
      fingerprint: 'stale-fingerprint',
      idempotencyKey: 'stale-key',
      variants: [{ body: '不应应用' }],
      marketingStrategy: { name: '不应应用' },
      requestId: null,
      generationPlatform: 'xiaohongshu',
      generationStyle: 'premium',
    })

    expect(unchanged).toBe(pending)
    expect(unchanged.platformCopy.variants).toHaveLength(0)
  })
})

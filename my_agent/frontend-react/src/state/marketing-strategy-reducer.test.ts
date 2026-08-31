import { describe, expect, it } from 'vitest'
import {
  createInitialWorkflowState,
  workflowReducer,
} from './workflow-reducer'
import type { WorkflowState } from './workflow-types'
import { isCurrentStep6Completion } from '../features/marketing-strategy/marketing-strategy-model'
import {
  createConfirmedStepFiveState,
  createStepSixState,
  TEST_STEP5_GROUP_SIGNATURE,
} from '../features/marketing-strategy/marketing-strategy-test-utils'

function completeStepSix(state = createStepSixState()) {
  return workflowReducer(state, { type: 'COMPLETE_STEP_SIX' })
}

function posterFallbackState(): WorkflowState {
  const base = createStepSixState()
  return {
    ...base,
    platformCopy: { ...base.platformCopy, marketingStrategy: {} },
    posterGeneration: {
      ...base.posterGeneration,
      result: {
        ...base.posterGeneration.result!,
        marketingStrategy: { name: '海报策略' },
        targetPlatform: 'xiaohongshu',
        targetPlatformResolution: 'known',
      },
    },
  }
}

describe('Step 6 reducer contract', () => {
  it('allows only a confirmed current Step 5 authority to enter Step 6', () => {
    const incomplete = createConfirmedStepFiveState()
    const withoutConfirmation: WorkflowState = {
      ...incomplete,
      detailEditor: { ...incomplete.detailEditor, confirmedDetails: null },
    }
    expect(workflowReducer(withoutConfirmation, { type: 'COMPLETE_STEP_FIVE' })).toBe(withoutConfirmation)
    const entered = workflowReducer(incomplete, { type: 'COMPLETE_STEP_FIVE' })
    expect(entered.currentStep).toBe(6)
    expect(entered.completedSteps.has(5)).toBe(true)
    expect(entered.detailEditor.completion).toMatchObject({
      groupSignatureSha256: TEST_STEP5_GROUP_SIGNATURE,
      pageCount: 1,
    })
  })

  it('atomically completes a populated Step 6 and enters Step 7', () => {
    const completed = completeStepSix()
    expect(completed.currentStep).toBe(7)
    expect(completed.completedSteps.has(6)).toBe(true)
    expect(completed.marketingStrategyStep.completion).toMatchObject({
      strategySourceKind: 'copy',
      strategyStatus: 'present',
      platformId: 'xiaohongshu',
    })
    expect(isCurrentStep6Completion(completed)).toBe(true)
  })

  it('allows the absent sentinel but rejects malformed strategy authority', () => {
    const missingBase = createStepSixState()
    const missing = completeStepSix({
      ...missingBase,
      platformCopy: { ...missingBase.platformCopy, marketingStrategy: {} },
    })
    expect(missing.currentStep).toBe(7)
    expect(missing.marketingStrategyStep.completion?.strategyStatus).toBe('absent')
    const malformedBase = createStepSixState()
    const malformed = completeStepSix({
      ...malformedBase,
      platformCopy: { ...malformedBase.platformCopy, marketingStrategy: { opaque: true } },
    })
    expect(malformed.currentStep).toBe(6)
    expect(malformed.marketingStrategyStep.completion).toBeNull()
    expect(malformed.completedSteps.has(6)).toBe(false)
  })

  it('is an exact semantic no-op on repeated Step 6 completion', () => {
    const completed = completeStepSix()
    expect(workflowReducer(completed, { type: 'COMPLETE_STEP_SIX' })).toBe(completed)
  })

  it('Back is always enabled and preserves compatible Step 5 and Step 6 identity', () => {
    const completed = completeStepSix()
    const completion = completed.marketingStrategyStep.completion
    const pages = completed.detailEditor.pages
    const stepSix = workflowReducer(completed, { type: 'GO_TO_STEP_SIX' })
    const back = workflowReducer(stepSix, { type: 'GO_TO_STEP_FIVE' })
    expect(back.currentStep).toBe(5)
    expect(back.detailEditor.pages).toBe(pages)
    expect(back.marketingStrategyStep.completion).toBe(completion)
    expect(back.completedSteps.has(6)).toBe(true)
    const returned = workflowReducer(back, { type: 'COMPLETE_STEP_FIVE' })
    expect(returned.currentStep).toBe(6)
    expect(returned.marketingStrategyStep.completion).toBe(completion)
    const reentered = workflowReducer(returned, { type: 'COMPLETE_STEP_SIX' })
    expect(reentered.currentStep).toBe(7)
    expect(reentered.marketingStrategyStep.completion).toBe(completion)
  })

  it('preserves completion across chrome-only Step 5 UI state', () => {
    const completed = completeStepSix()
    const completion = completed.marketingStrategyStep.completion
    const stepSix = workflowReducer(completed, { type: 'GO_TO_STEP_SIX' })
    const back = workflowReducer(stepSix, { type: 'GO_TO_STEP_FIVE' })
    const chrome = workflowReducer(back, {
      type: 'SET_STEP_FIVE_UI',
      panel: 'shape',
      selectedLayerId: null,
    })
    expect(chrome.detailEditor.activePanel).toBe('shape')
    expect(chrome.marketingStrategyStep.completion).toBe(completion)
    expect(isCurrentStep6Completion(chrome)).toBe(true)
  })

  it('clears completion synchronously on a Step 5 semantic edit', () => {
    const completed = completeStepSix()
    const stepSix = workflowReducer(completed, { type: 'GO_TO_STEP_SIX' })
    const back = workflowReducer(stepSix, { type: 'GO_TO_STEP_FIVE' })
    const page = back.detailEditor.pages[0]
    const changed = workflowReducer(back, {
      type: 'COMMIT_STEP_FIVE_PAGE_MUTATION',
      pageId: page.id,
      expectedRevision: page.compositionRevision,
      page: { ...page, selectedFontId: 'font-changed' },
    })
    expect(changed.marketingStrategyStep.completion).toBeNull()
    expect(changed.completedSteps.has(6)).toBe(false)
    expect(changed.detailEditor.completion).toBeNull()
  })

  it('clears completion on a current platform change while retaining prior strategy data', () => {
    const completed = completeStepSix()
    const strategy = completed.platformCopy.marketingStrategy
    const changed = workflowReducer(completed, {
      type: 'UPDATE_STEP_TWO_PLATFORM',
      platform: 'douyin',
    })
    expect(changed.platformCopy.marketingStrategy).toBe(strategy)
    expect(changed.marketingStrategyStep.completion).toBeNull()
    expect(changed.completedSteps.has(6)).toBe(false)
  })

  it('clears completion on a manual final-copy edit but preserves its strategy owner', () => {
    const completed = completeStepSix()
    const owner = completed.platformCopy.strategyOwner
    const changed = workflowReducer(completed, {
      type: 'UPDATE_STEP_TWO_DRAFT',
      value: `${completed.platformCopy.copyDraft} 新内容`,
    })
    expect(changed.platformCopy.strategyOwner).toBe(owner)
    expect(changed.marketingStrategyStep.completion).toBeNull()
  })

  it('replaces strategy owner atomically and clears completion on copy regeneration', () => {
    const completed = completeStepSix()
    const priorOwner = completed.platformCopy.strategyOwner
    let changed = workflowReducer(completed, {
      type: 'BEGIN_COPY_GENERATION',
      fingerprint: 'replacement-fingerprint',
      idempotencyKey: 'replacement-key',
    })
    changed = workflowReducer(changed, {
      type: 'COPY_GENERATION_SUCCEEDED',
      fingerprint: 'replacement-fingerprint',
      idempotencyKey: 'replacement-key',
      requestId: '99999999-9999-4999-8999-999999999999',
      variants: [{ body: '替换后的正文' }],
      marketingStrategy: { name: '替换后的策略' },
      generationPlatform: 'douyin',
      generationStyle: 'vibrant',
    })
    expect(changed.platformCopy.strategyOwner).not.toBe(priorOwner)
    expect(changed.platformCopy.strategyOwner).toMatchObject({
      intentFingerprint: 'replacement-fingerprint',
      platform: 'douyin',
      style: 'vibrant',
    })
    expect(changed.marketingStrategyStep.completion).toBeNull()
  })

  it('clears a poster-fallback completion when a same-generation poll changes strategy', () => {
    const completed = completeStepSix(posterFallbackState())
    expect(completed.marketingStrategyStep.completion?.strategySourceKind).toBe('poster')
    const changedResult = {
      ...completed.posterGeneration.result!,
      marketingStrategy: { name: '轮询更新后的海报策略' },
    }
    const changed = workflowReducer(completed, {
      type: 'APPLY_POSTER_RESULT',
      result: changedResult,
      source: 'poll',
    })
    expect(changed.detailEditor.owner).toBe(completed.detailEditor.owner)
    expect(changed.marketingStrategyStep.completion).toBeNull()
    expect(changed.completedSteps.has(6)).toBe(false)
  })

  it('clears Step 5 and Step 6 authority on a different ready poster selection', () => {
    const completed = completeStepSix()
    const changed = workflowReducer(completed, { type: 'SELECT_POSTER_SLOT', index: 1 })
    expect(changed.detailEditor.owner).toBeNull()
    expect(changed.marketingStrategyStep.completion).toBeNull()
    expect(changed.completedSteps.has(5)).toBe(false)
    expect(changed.completedSteps.has(6)).toBe(false)
  })

  it('rejects direct Step 6 state without authority and makes repeated activation harmless', () => {
    const initial = createInitialWorkflowState()
    const direct = { ...initial, currentStep: 6 as const }
    expect(workflowReducer(direct, { type: 'COMPLETE_STEP_SIX' })).toBe(direct)
    const completed = completeStepSix()
    const repeated = workflowReducer(completed, { type: 'COMPLETE_STEP_SIX' })
    expect(repeated).toBe(completed)
    expect(repeated.currentStep).toBe(7)
    expect(repeated.completedSteps.has(7)).toBe(false)
  })
})

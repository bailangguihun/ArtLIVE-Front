import { describe, expect, it } from 'vitest'
import { workflowReducer } from '../../state/workflow-reducer'
import { createStepThreeState, normalizedSequence } from './poster-test-utils'

describe('poster-generation workflow state', () => {
  it('retains an accepted key until a safely applied terminal snapshot', () => {
    let state = createStepThreeState()
    state = workflowReducer(state, { type: 'BEGIN_POSTER_ADMISSION' })
    state = workflowReducer(state, {
      type: 'SET_PENDING_POSTER_INTENT',
      fingerprint: 'fingerprint-one',
      idempotencyKey: 'key-one',
    })
    state = workflowReducer(state, {
      type: 'APPLY_POSTER_RESULT',
      source: 'admission',
      fingerprint: 'fingerprint-one',
      result: normalizedSequence('queued'),
    })
    expect(state.posterGeneration).toMatchObject({
      pendingFingerprint: 'fingerprint-one',
      pendingIdempotencyKey: 'key-one',
      pendingIntentPhase: 'accepted',
    })

    state = workflowReducer(state, {
      type: 'APPLY_POSTER_RESULT',
      source: 'poll',
      result: normalizedSequence('completed', ['ready', 'ready', 'ready']),
    })
    expect(state.posterGeneration.pendingFingerprint).toBeNull()
    expect(state.posterGeneration.pendingIdempotencyKey).toBeNull()
    expect(state.posterGeneration.pendingIntentPhase).toBeNull()
    expect(state.posterGeneration.succeededOnce).toBe(true)
  })

  it.each(['failed', 'partial_failed', 'interrupted'] as const)(
    'clears pending intent for terminal %s without setting succeeded-once',
    (status) => {
      let state = createStepThreeState({
        pendingFingerprint: 'fingerprint',
        pendingIdempotencyKey: 'key',
        pendingIntentPhase: 'submitting',
      })
      state = workflowReducer(state, {
        type: 'APPLY_POSTER_RESULT',
        source: 'admission',
        fingerprint: 'fingerprint',
        result: normalizedSequence(status, [
          status === 'partial_failed' ? 'ready' : 'failed',
          'blocked',
          'blocked',
        ]),
      })
      expect(state.posterGeneration.pendingIdempotencyKey).toBeNull()
      expect(state.posterGeneration.pendingFingerprint).toBeNull()
      expect(state.posterGeneration.succeededOnce).toBe(false)
    },
  )

  it('preserves succeeded-once after later failed or interrupted generations', () => {
    let state = createStepThreeState({ succeededOnce: true })
    state = workflowReducer(state, {
      type: 'APPLY_POSTER_RESULT',
      source: 'poll',
      result: normalizedSequence('interrupted', ['ready', 'failed', 'blocked']),
    })
    expect(state.posterGeneration.succeededOnce).toBe(true)
  })

  it.each(['running', 'partial_failed', 'interrupted'] as const)(
    'stores a ready selection and Step 3 completion from %s but stays on Step 3',
    (status) => {
      let state = createStepThreeState({
        result: normalizedSequence(status, ['ready', 'generating', 'waiting']),
        activeGenerationId: '11111111-1111-4111-8111-111111111111',
      })
      state = workflowReducer(state, { type: 'SELECT_POSTER_SLOT', index: 0 })
      state = workflowReducer(state, { type: 'COMPLETE_STEP_THREE' })
      expect(state.currentStep).toBe(3)
      expect([...state.completedSteps]).toEqual([1, 2, 3])
      expect(state.posterGeneration.completedDraft).toMatchObject({
        generationId: '11111111-1111-4111-8111-111111111111',
        selectedIndex: 0,
        posterId: '33333333-3333-4333-8333-333333333331',
        selectedSlot: { status: 'ready' },
      })
    },
  )

  it('never completes from missing, unknown, non-ready, or poster-ID-less slots', () => {
    for (const result of [
      normalizedSequence('running', ['waiting']),
      normalizedSequence('running', ['future_slot']),
      normalizedSequence('running', []),
    ]) {
      let state = createStepThreeState({ result })
      state = workflowReducer(state, { type: 'SELECT_POSTER_SLOT', index: 0 })
      state = workflowReducer(state, { type: 'COMPLETE_STEP_THREE' })
      expect(state.posterGeneration.completedDraft).toBeNull()
      expect(state.completedSteps.has(3)).toBe(false)
    }
  })

  it('invalidates selection and completion if a selected slot loses readiness', () => {
    let state = createStepThreeState({
      result: normalizedSequence('running', ['ready', 'generating', 'waiting']),
      activeGenerationId: '11111111-1111-4111-8111-111111111111',
    })
    state = workflowReducer(state, { type: 'SELECT_POSTER_SLOT', index: 0 })
    state = workflowReducer(state, { type: 'COMPLETE_STEP_THREE' })
    state = workflowReducer(state, {
      type: 'APPLY_POSTER_RESULT',
      source: 'poll',
      result: normalizedSequence('running', ['failed', 'generating', 'waiting']),
    })
    expect(state.posterGeneration.selectedIndex).toBeNull()
    expect(state.posterGeneration.selectedPosterId).toBeNull()
    expect(state.posterGeneration.completedDraft).toBeNull()
    expect(state.completedSteps.has(3)).toBe(false)
  })

  it('new submission invalidates only selection/completion and preserves prior safe result', () => {
    const result = normalizedSequence('completed', ['ready', 'ready', 'ready'])
    let state = createStepThreeState({ result })
    state = workflowReducer(state, { type: 'SELECT_POSTER_SLOT', index: 0 })
    state = workflowReducer(state, { type: 'COMPLETE_STEP_THREE' })
    state = workflowReducer(state, { type: 'BEGIN_POSTER_ADMISSION' })
    expect(state.posterGeneration.result).toBe(result)
    expect(state.posterGeneration.selectedIndex).toBeNull()
    expect(state.posterGeneration.completedDraft).toBeNull()
    expect(state.completedSteps.has(1)).toBe(true)
    expect(state.completedSteps.has(2)).toBe(true)
    expect(state.completedSteps.has(3)).toBe(false)
  })

  it('Back changes only the current step and keeps admission, task, selection, and caches', () => {
    const result = normalizedSequence('running', ['ready', 'generating', 'waiting'])
    const blob = new Blob(['png'], { type: 'image/png' })
    const before = createStepThreeState({
      admissionBusy: true,
      result,
      activeGenerationId: result.generationId,
      selectedIndex: 0,
      selectedPosterId: result.posters[0].posterId,
      selectedSlot: result.posters[0],
      posterBinaries: {
        [result.posters[0].posterId!]: {
          preview: {
            status: 'ready',
            blob,
            objectUrl: 'blob:preview',
            error: '',
          },
          download: {
            status: 'ready',
            blob,
            objectUrl: 'blob:download',
            error: '',
          },
        },
      },
    })
    const after = workflowReducer(before, { type: 'GO_TO_STEP_TWO' })
    expect(after.currentStep).toBe(2)
    expect(after.posterGeneration).toEqual(before.posterGeneration)
  })
})

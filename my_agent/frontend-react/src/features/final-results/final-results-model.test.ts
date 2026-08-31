import { describe, expect, it } from 'vitest'
import { createInitialWorkflowState, workflowReducer } from '../../state/workflow-reducer'
import type { WorkflowState } from '../../state/workflow-types'
import { createStepSixState } from '../marketing-strategy/marketing-strategy-test-utils'
import { selectFinalResultsViewModel } from './final-results-model'
import { createStepSevenState } from './final-results-test-utils'

describe('final results authority model', () => {
  it('derives source-linked copy, exact poster bytes, and the ordered detail set', () => {
    const state = createStepSevenState()
    const view = selectFinalResultsViewModel(state)
    expect(view).not.toBeNull()
    expect(view?.finalCopy.body).toBe('手动编辑后的正文')
    expect(view?.finalCopy.owner.inputSignatureSha256).toBe(
      state.posterEditor.confirmedPoster?.inputSignatureSha256,
    )
    expect(view?.poster).toMatchObject({
      title: '定稿海报',
      fileName: 'poster-final.png',
      mimeType: 'image/png',
      width: 1024,
      height: 1536,
    })
    expect(view?.poster.blob).toBe(state.posterEditor.confirmedPoster?.pngBlob)
    expect(view?.details.map((item) => [item.title, item.fileName])).toEqual([
      ['详情页 1', 'detail-final-1.png'],
    ])
    expect(view?.details[0].blob).toBe(
      state.detailEditor.confirmedDetails?.pageExports[0].pngBlob,
    )
    expect(view?.detailResourceRevision).toBe(state.detailEditor.resourceRevision)
    expect(view?.signatures.step7SignatureSha256).toMatch(/^[a-f0-9]{64}$/)
  })

  it('preserves strict poster-first order for four detail pages', () => {
    const state = createStepSevenState({ detailCount: 4 })
    const view = selectFinalResultsViewModel(state)!
    expect(view.gallery.map((item) => item.title)).toEqual([
      '定稿海报',
      '详情页 1',
      '详情页 2',
      '详情页 3',
      '详情页 4',
    ])
    expect(view.details.map((item) => item.fileName)).toEqual([
      'detail-final-1.png',
      'detail-final-2.png',
      'detail-final-3.png',
      'detail-final-4.png',
    ])
    expect(view.details.map((item) => item.blob)).toEqual(
      state.detailEditor.confirmedDetails?.pngBlobs,
    )
  })

  it('allows the source-proven absent strategy sentinel', () => {
    const state = createStepSevenState({ missingStrategy: true })
    expect(state.marketingStrategyStep.completion?.strategyStatus).toBe('absent')
    expect(selectFinalResultsViewModel(state)).not.toBeNull()
  })

  it('rejects malformed Step 6 authority without creating completion or transitioning', () => {
    const base = createStepSixState()
    const malformed: WorkflowState = {
      ...base,
      platformCopy: {
        ...base.platformCopy,
        marketingStrategy: { opaque: { unsafe: true } },
      },
    }
    const rejected = workflowReducer(malformed, { type: 'COMPLETE_STEP_SIX' })
    expect(rejected).toBe(malformed)
    expect(rejected.currentStep).toBe(6)
    expect(rejected.marketingStrategyStep.completion).toBeNull()
    expect(selectFinalResultsViewModel(rejected)).toBeNull()
  })

  it('fails closed for mixed Blob aliases, order, hashes, MIME, and owner identity', () => {
    const valid = createStepSevenState({ detailCount: 2 })
    const confirmed = valid.detailEditor.confirmedDetails!
    const brokenStates: WorkflowState[] = [
      {
        ...valid,
        detailEditor: {
          ...valid.detailEditor,
          confirmedDetails: {
            ...confirmed,
            firstPngBlob: new Blob([new Uint8Array([1])], { type: 'image/png' }),
          },
        },
      },
      {
        ...valid,
        detailEditor: {
          ...valid.detailEditor,
          confirmedDetails: {
            ...confirmed,
            pngBlobs: [...confirmed.pngBlobs].reverse(),
          },
        },
      },
      {
        ...valid,
        detailEditor: {
          ...valid.detailEditor,
          confirmedDetails: {
            ...confirmed,
            owner: { ...confirmed.owner, posterId: 'mixed-owner' },
          },
        },
      },
      {
        ...valid,
        posterEditor: {
          ...valid.posterEditor,
          confirmedPoster: {
            ...valid.posterEditor.confirmedPoster!,
            pngBlob: new Blob([new Uint8Array([1])], { type: 'image/jpeg' }),
          },
        },
      },
    ]
    brokenStates.forEach((state) => {
      expect(selectFinalResultsViewModel(state)).toBeNull()
      const reconciled = workflowReducer(state, {
        type: 'SET_STEP_FIVE_UI',
        panel: 'text',
      })
      expect(reconciled.currentStep).toBe(6)
    })
  })

  it('preserves exact authority across Back and same-owner re-entry', () => {
    const entered = createStepSevenState({ detailCount: 2 })
    const first = selectFinalResultsViewModel(entered)!
    const stepSix = workflowReducer(entered, { type: 'GO_TO_STEP_SIX' })
    const reentered = workflowReducer(stepSix, { type: 'COMPLETE_STEP_SIX' })
    const second = selectFinalResultsViewModel(reentered)!
    expect(reentered.currentStep).toBe(7)
    expect(reentered.marketingStrategyStep.completion).toBe(
      entered.marketingStrategyStep.completion,
    )
    expect(second.signatures).toEqual(first.signatures)
    expect(second.finalCopy.body).toBe(first.finalCopy.body)
    expect(second.gallery.map((item) => item.blob)).toEqual(
      first.gallery.map((item) => item.blob),
    )
  })

  it('atomically resets every workflow family and is semantically idempotent', () => {
    const entered = createStepSevenState({ detailCount: 4 })
    const reset = workflowReducer(entered, { type: 'RESET_WORKFLOW' })
    expect(reset).toEqual(createInitialWorkflowState())
    expect(reset.currentStep).toBe(1)
    expect(reset.completedSteps.size).toBe(0)
    expect(reset.posterEditor.confirmedPoster).toBeNull()
    expect(reset.detailEditor.confirmedDetails).toBeNull()
    expect(reset.marketingStrategyStep.completion).toBeNull()
    expect(selectFinalResultsViewModel(reset)).toBeNull()
    expect(workflowReducer(reset, { type: 'RESET_WORKFLOW' })).toEqual(reset)
  })
})

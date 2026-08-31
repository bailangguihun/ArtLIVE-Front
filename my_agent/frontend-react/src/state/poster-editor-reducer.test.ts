import { describe, expect, it } from 'vitest'
import { createDefaultShape } from '../features/poster-editor/poster-defaults'
import {
  confirmStepFour,
  confirmedSnapshot,
  createStepFourState,
  TEST_LAYOUT_SHA256,
  TEST_POSTER_IDS,
} from '../features/poster-editor/poster-editor-test-utils'
import { normalizedSequence } from '../features/poster-generation/poster-test-utils'
import {
  selectCurrentConfirmedPosterBlob,
  selectCurrentStepFourCompletion,
} from '../features/poster-editor/poster-selectors'
import type {
  CompletePosterLayout,
  PosterBlobResource,
  PosterTextBox,
} from '../types/poster-editor'
import { isCurrentStepFourConfirmation, workflowReducer } from './workflow-reducer'

function mutate(state: ReturnType<typeof createStepFourState>, layout: CompletePosterLayout) {
  return workflowReducer(state, { type: 'COMMIT_STEP_FOUR_MUTATION', layout })
}

const V2_DRAFT_KEY = 'v2:poster-project-a:generation-a:poster-a:base-a'

function withV2DraftKey(
  state: ReturnType<typeof createStepFourState> = createStepFourState(),
  draftKey = V2_DRAFT_KEY,
) {
  const active = state.posterEditor.active!
  const legacyDraft = state.posterEditor.drafts[active.generationId]
  return {
    ...state,
    posterEditor: {
      ...state.posterEditor,
      active: { ...active, draftKey },
      drafts: {
        [draftKey]: { ...legacyDraft, draftKey },
      },
    },
  }
}

describe('Step 4 reducer draft identity and invalidation', () => {
  it('maintains one canonical draft per generation', () => {
    const state = createStepFourState()
    const active = state.posterEditor.active!
    expect(Object.keys(state.posterEditor.drafts)).toEqual([active.generationId])
    expect(state.posterEditor.drafts[active.generationId].generationId).toBe(active.generationId)
  })

  it('writes every V2 text-style-position mutation back to its exact draftKey without a legacy shadow draft', () => {
    const state = withV2DraftKey()
    const active = state.posterEditor.active!
    const draft = state.posterEditor.drafts[V2_DRAFT_KEY]
    const text = draft.layout.textBoxes[0]
    const layout = {
      ...draft.layout,
      fontId: 'zcool_xiaowei',
      textBoxes: draft.layout.textBoxes.map((box) =>
        box.id === text.id
          ? {
              ...box,
              text: 'V2 草稿键持久化',
              fontId: 'zcool_qingke',
              fontSize: text.fontSize + 6,
              color: '#123456',
              x: 0.22,
              y: 0.31,
            }
          : box,
      ),
    }

    const next = mutate(state, layout)

    expect(next.posterEditor.active?.draftKey).toBe(V2_DRAFT_KEY)
    expect(Object.keys(next.posterEditor.drafts)).toEqual([V2_DRAFT_KEY])
    expect(next.posterEditor.drafts[active.generationId]).toBeUndefined()
    expect(next.posterEditor.drafts[V2_DRAFT_KEY].layout.textBoxes[0]).toMatchObject({
      text: 'V2 草稿键持久化',
      fontId: 'zcool_qingke',
      fontSize: text.fontSize + 6,
      color: '#123456',
      x: 0.22,
      y: 0.31,
    })
    expect(next.posterEditor.drafts[V2_DRAFT_KEY].generationId).toBe(active.generationId)
    expect(next.posterEditor.confirmedPoster).toBe(state.posterEditor.confirmedPoster)
  })

  it('adds one stable V2 custom box and keeps a second V2 draft isolated even when generation metadata matches', () => {
    const first = withV2DraftKey()
    const active = first.posterEditor.active!
    const firstDraft = first.posterEditor.drafts[V2_DRAFT_KEY]
    const secondKey = 'v2:poster-project-b:generation-a:poster-b:base-b'
    const secondDraft = {
      ...firstDraft,
      draftKey: secondKey,
      layout: {
        ...firstDraft.layout,
        textBoxes: firstDraft.layout.textBoxes.map((box, index) =>
          index === 0 ? { ...box, text: '第二份隔离草稿' } : box,
        ),
      },
    }
    const state = {
      ...first,
      posterEditor: {
        ...first.posterEditor,
        drafts: {
          [V2_DRAFT_KEY]: firstDraft,
          [secondKey]: secondDraft,
        },
      },
    }
    const added: PosterTextBox = {
      ...firstDraft.layout.textBoxes[0],
      id: 'box-custom-v2-repair',
      role: 'custom-1',
      text: '新增文本框-持久化验证',
    }
    const next = mutate(state, {
      ...firstDraft.layout,
      textBoxes: [...firstDraft.layout.textBoxes, added],
    })

    expect(next.posterEditor.drafts[V2_DRAFT_KEY].layout.textBoxes).toHaveLength(
      firstDraft.layout.textBoxes.length + 1,
    )
    expect(next.posterEditor.drafts[V2_DRAFT_KEY].layout.textBoxes.at(-1)).toMatchObject({
      id: 'box-custom-v2-repair',
      role: 'custom-1',
      text: '新增文本框-持久化验证',
    })
    expect(next.posterEditor.drafts[secondKey]).toEqual(secondDraft)
    expect(next.posterEditor.drafts[active.generationId]).toBeUndefined()
  })

  it('safely rejects a V2 mutation when the active draftKey is absent', () => {
    const keyed = withV2DraftKey()
    const state = {
      ...keyed,
      posterEditor: {
        ...keyed.posterEditor,
        drafts: {},
      },
    }
    const next = mutate(state, createStepFourState().posterEditor.drafts[
      createStepFourState().posterEditor.active!.generationId
    ].layout)

    expect(next).toBe(state)
    expect(Object.keys(next.posterEditor.drafts)).toEqual([])
  })

  it('keeps selection and panel changes UI-only', () => {
    const state = createStepFourState()
    const revision = state.posterEditor.compositionRevision
    const panel = workflowReducer(state, { type: 'SET_STEP_FOUR_UI', panel: 'shape' })
    const selection = workflowReducer(panel, { type: 'SET_STEP_FOUR_UI', selectedShapeId: 'not-present' })
    expect(selection.posterEditor.compositionRevision).toBe(revision)
    expect(selection.posterEditor.currentLayoutSha256).toBe(state.posterEditor.currentLayoutSha256)
  })

  it('increments revision for every class of pixel-affecting mutation', () => {
    const original = createStepFourState()
    const active = original.posterEditor.active!
    const base = original.posterEditor.drafts[active.generationId].layout
    const text = base.textBoxes[0]
    const variants: CompletePosterLayout[] = [
      { ...base, fontId: 'zcool_xiaowei' },
      { ...base, textBoxes: base.textBoxes.map((box) => box.id === text.id ? { ...box, text: `${box.text}!` } : box) },
      { ...base, textBoxes: base.textBoxes.map((box) => box.id === text.id ? { ...box, fontId: 'zcool_qingke' } : box) },
      { ...base, textBoxes: base.textBoxes.map((box) => box.id === text.id ? { ...box, fontSize: box.fontSize + 2 } : box) },
      { ...base, textBoxes: base.textBoxes.map((box) => box.id === text.id ? { ...box, color: '#123456' } : box) },
      { ...base, textBoxes: base.textBoxes.map((box) => box.id === text.id ? { ...box, align: box.align === 'left' ? 'center' : 'left' } : box) },
      { ...base, textBoxes: base.textBoxes.map((box) => box.id === text.id ? { ...box, strokeEnabled: true } : box) },
      { ...base, textBoxes: base.textBoxes.map((box) => box.id === text.id ? { ...box, strokeWidth: 7 } : box) },
      { ...base, textBoxes: base.textBoxes.map((box) => box.id === text.id ? { ...box, strokeColor: '#654321' } : box) },
      { ...base, textBoxes: base.textBoxes.map((box) => box.id === text.id ? { ...box, showBox: true } : box) },
      { ...base, textBoxes: base.textBoxes.map((box) => box.id === text.id ? { ...box, x: box.x + 0.01, y: box.y + 0.01 } : box) },
      { ...base, textBoxes: [...base.textBoxes, { ...text, id: 'custom', role: 'custom-1', text: '自定义' }] },
      { ...base, textBoxes: base.textBoxes.slice(1) },
      { ...base, shapes: [createDefaultShape('rect', 'rect')] },
      { ...base, images: [{ id: 'img', name: 'logo.png', x: 0.08, y: 0.08, w: 0.22, h: 0.14, blobId: 'overlay', sha256: 'f'.repeat(64) }] },
    ]
    for (const layout of variants) {
      const next = mutate(original, layout)
      expect(next.posterEditor.compositionRevision).toBe(original.posterEditor.compositionRevision + 1)
      expect(next.posterEditor.completion).toBeNull()
    }
  })

  it('showBox invalidates while exact field reversion never revives old authority', () => {
    const initial = createStepFourState()
    const firstSnapshot = confirmedSnapshot(initial)
    const confirmed = confirmStepFour(initial, firstSnapshot)
    expect(isCurrentStepFourConfirmation(confirmed.posterEditor)).toBe(true)
    const active = confirmed.posterEditor.active!
    const layoutA = confirmed.posterEditor.drafts[active.generationId].layout
    const layoutB = {
      ...layoutA,
      textBoxes: layoutA.textBoxes.map((box, index) => index === 0 ? { ...box, showBox: true } : box),
    }
    const dirty = mutate(confirmed, layoutB)
    expect(isCurrentStepFourConfirmation(dirty.posterEditor)).toBe(false)
    const reverted = mutate(dirty, layoutA)
    expect(reverted.posterEditor.confirmedPoster).toBe(firstSnapshot)
    expect(isCurrentStepFourConfirmation(reverted.posterEditor)).toBe(false)
    expect(reverted.posterEditor.compositionRevision).toBe(firstSnapshot.confirmedRevision + 2)
  })

  it('keeps the exact retained Blob for a same-signature and same-PNG reconfirmation', () => {
    const initial = createStepFourState()
    const first = confirmedSnapshot(initial)
    const confirmed = confirmStepFour(initial, first)
    const active = confirmed.posterEditor.active!
    const layout = confirmed.posterEditor.drafts[active.generationId].layout
    const dirty = mutate(confirmed, { ...layout, textBoxes: layout.textBoxes.map((box, i) => i === 0 ? { ...box, x: box.x + 0.01 } : box) })
    const reverted = mutate(dirty, layout)
    const freshBlob = new Blob([new Uint8Array([9, 9, 9])], { type: 'image/png' })
    const reconfirm = confirmedSnapshot(reverted, {
      inputSignatureSha256: first.inputSignatureSha256,
      pngBlobSha256: first.pngBlobSha256,
      pngBlob: freshBlob,
      confirmedRevision: reverted.posterEditor.compositionRevision,
      layout,
    })
    const next = confirmStepFour(reverted, reconfirm)
    expect(next.posterEditor.confirmedPoster?.pngBlob).toBe(first.pngBlob)
    expect(next.posterEditor.confirmedPoster?.pngBlob).not.toBe(freshBlob)
    expect(isCurrentStepFourConfirmation(next.posterEditor)).toBe(true)
  })

  it('replaces same-input nondeterministic PNG bytes and records the mismatch', () => {
    const initial = createStepFourState()
    const first = confirmedSnapshot(initial)
    const confirmed = confirmStepFour(initial, first)
    const freshBlob = new Blob([new Uint8Array([7])], { type: 'image/png' })
    const mismatch = confirmedSnapshot(confirmed, {
      inputSignatureSha256: first.inputSignatureSha256,
      pngBlob: freshBlob,
      pngBlobSha256: '9'.repeat(64),
    })
    const next = confirmStepFour(confirmed, mismatch)
    expect(next.posterEditor.confirmedPoster?.pngBlob).toBe(freshBlob)
    expect(next.posterEditor.rendererMismatchCount).toBe(1)
  })

  it('replaces changed-signature authority without creating Step 5 state', () => {
    const initial = createStepFourState()
    const confirmed = confirmStepFour(initial)
    const changed = confirmedSnapshot(confirmed, {
      inputSignatureSha256: 'changed',
      pngBlob: new Blob([new Uint8Array([8])], { type: 'image/png' }),
      pngBlobSha256: '8'.repeat(64),
    })
    const next = confirmStepFour(confirmed, changed)
    expect(next.posterEditor.confirmedPoster?.inputSignatureSha256).toBe('changed')
    expect('step5' in next).toBe(false)
    expect('detail' in next).toBe(false)
  })

  it('stores completion only from current authority and remains visibly at Step 4', () => {
    const confirmed = confirmStepFour(createStepFourState())
    const completed = workflowReducer(confirmed, { type: 'COMPLETE_STEP_FOUR' })
    expect(completed.currentStep).toBe(4)
    expect(completed.completedSteps.has(4)).toBe(true)
    expect(completed.posterEditor.completion).toMatchObject({
      confirmedRevision: confirmed.posterEditor.compositionRevision,
      layoutSha256: TEST_LAYOUT_SHA256,
    })
    expect(selectCurrentConfirmedPosterBlob(completed.posterEditor)).toBe(
      completed.posterEditor.confirmedPoster?.pngBlob,
    )
    expect(selectCurrentStepFourCompletion(completed.posterEditor)).toBe(
      completed.posterEditor.completion,
    )
    expect('step5' in completed).toBe(false)
  })

  it('invalidates completion on edit; reconfirmation does not recreate it; Next must be activated again', () => {
    const confirmed = confirmStepFour(createStepFourState())
    const completed = workflowReducer(confirmed, { type: 'COMPLETE_STEP_FOUR' })
    const active = completed.posterEditor.active!
    const layout = completed.posterEditor.drafts[active.generationId].layout
    const dirty = mutate(completed, { ...layout, textBoxes: layout.textBoxes.map((box, index) => index === 0 ? { ...box, text: `${box.text}新` } : box) })
    expect(dirty.posterEditor.completion).toBeNull()
    expect(dirty.completedSteps.has(4)).toBe(false)
    const reconfirmed = confirmStepFour(dirty, confirmedSnapshot(dirty, {
      inputSignatureSha256: 'new-signature',
      layout: dirty.posterEditor.drafts[active.generationId].layout,
      confirmedRevision: dirty.posterEditor.compositionRevision,
    }))
    expect(reconfirmed.posterEditor.completion).toBeNull()
    const completedAgain = workflowReducer(reconfirmed, { type: 'COMPLETE_STEP_FOUR' })
    expect(completedAgain.posterEditor.completion?.confirmedRevision).toBe(reconfirmed.posterEditor.compositionRevision)
  })

  it('upstream product/copy mutations synchronously invalidate completion', () => {
    const completed = workflowReducer(confirmStepFour(createStepFourState()), { type: 'COMPLETE_STEP_FOUR' })
    const next = workflowReducer(completed, { type: 'UPDATE_STEP_ONE_FIELD', field: 'creativeNote', value: '改变上游' })
    expect(next.posterEditor.completion).toBeNull()
    expect(isCurrentStepFourConfirmation(next.posterEditor)).toBe(false)
  })

  it('same-generation different-poster keeps layout but physically clears base/final/completion', () => {
    const completed = workflowReducer(confirmStepFour(createStepFourState()), { type: 'COMPLETE_STEP_FOUR' })
    const active = completed.posterEditor.active!
    const layout = completed.posterEditor.drafts[active.generationId].layout
    const back = workflowReducer(completed, { type: 'GO_TO_STEP_THREE' })
    const selected = workflowReducer(back, { type: 'SELECT_POSTER_SLOT', index: 1 })
    expect(selected.posterEditor.active).toBeNull()
    expect(selected.posterEditor.confirmedPoster).toBeNull()
    expect(selected.posterEditor.completion).toBeNull()
    expect(selected.posterEditor.drafts[active.generationId].layout).toBe(layout)
  })

  it('a new generation isolates its draft and clears old final authority', () => {
    const confirmed = confirmStepFour(createStepFourState())
    const nextGeneration = normalizedSequence('completed', ['ready', 'ready', 'ready'], { generation_id: '44444444-4444-4444-8444-444444444444' })
    const applied = workflowReducer(workflowReducer(confirmed, { type: 'GO_TO_STEP_THREE' }), {
      type: 'APPLY_POSTER_RESULT',
      result: nextGeneration,
      source: 'admission',
      fingerprint: 'new-fingerprint',
    })
    expect(applied.posterEditor.active).toBeNull()
    expect(applied.posterEditor.confirmedPoster).toBeNull()
    expect(Object.keys(applied.posterEditor.drafts)).toContain(confirmed.posterEditor.active!.generationId)
  })

  it('resource mutations increment resource revision atomically', () => {
    const state = createStepFourState()
    const active = state.posterEditor.active!
    const layout = state.posterEditor.drafts[active.generationId].layout
    const resource: PosterBlobResource = {
      id: 'overlay', kind: 'overlay', blob: new Blob([new Uint8Array([1])], { type: 'image/png' }), sha256: 'f'.repeat(64), mimeType: 'image/png', name: 'safe.png', width: 10, height: 10,
    }
    const next = workflowReducer(state, {
      type: 'COMMIT_STEP_FOUR_MUTATION',
      layout: { ...layout, images: [{ id: 'img', name: 'safe.png', x: 0.08, y: 0.08, w: 0.22, h: 0.14, blobId: resource.id, sha256: resource.sha256 }] },
      addedResources: [resource],
    })
    expect(next.posterEditor.resourceRevision).toBe(state.posterEditor.resourceRevision + 1)
    expect(next.posterEditor.resources.overlay).toBe(resource)
  })

  it('rejects a stale confirmation revision', () => {
    const state = createStepFourState()
    const stale = confirmedSnapshot(state, { confirmedRevision: state.posterEditor.compositionRevision - 1 })
    const next = workflowReducer(state, { type: 'STEP_FOUR_CONFIRMATION_SUCCEEDED', snapshot: stale, expectedRevision: stale.confirmedRevision })
    expect(next.posterEditor.confirmedPoster).toBeNull()
  })

  it('does not accept completion from a stale retained Blob', () => {
    const state = createStepFourState()
    const confirmed = confirmStepFour(state)
    const active = confirmed.posterEditor.active!
    const layout = confirmed.posterEditor.drafts[active.generationId].layout
    const dirty = mutate(confirmed, { ...layout, shapes: [createDefaultShape('diamond', 'dirty')] })
    const completed = workflowReducer(dirty, { type: 'COMPLETE_STEP_FOUR' })
    expect(completed.posterEditor.completion).toBeNull()
    expect(completed.completedSteps.has(4)).toBe(false)
    expect(completed.posterEditor.confirmedPoster?.posterId).toBe(TEST_POSTER_IDS[0])
    expect(selectCurrentConfirmedPosterBlob(completed.posterEditor)).toBeNull()
  })
})

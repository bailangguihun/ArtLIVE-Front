import { describe, expect, it } from 'vitest'
import {
  confirmStepFour,
  confirmedSnapshot,
  createStepFourState,
} from '../features/poster-editor/poster-editor-test-utils'
import { createTextLayer, systemBackground } from '../features/detail-editor/detail-defaults'
import type {
  DetailOwnerIdentity,
  DetailPage,
  DetailPageExport,
  DetailResource,
} from '../types/detail-editor'
import type { WorkflowState } from './workflow-types'
import { workflowReducer } from './workflow-reducer'

function entryFrom(state: WorkflowState) {
  const confirmed = state.posterEditor.confirmedPoster!
  const owner: DetailOwnerIdentity = {
    generationId: confirmed.generationId,
    posterId: confirmed.posterId,
    inputSignatureSha256: confirmed.inputSignatureSha256,
    pngBlobSha256: confirmed.pngBlobSha256,
  }
  const posterResource: DetailResource = {
    id: 'poster-final',
    kind: 'poster-final',
    name: '定稿海报',
    blob: confirmed.pngBlob,
    sha256: confirmed.pngBlobSha256,
    mimeType: 'image/png',
    width: 1024,
    height: 1536,
  }
  return { owner, posterResource }
}

function createStepFiveState() {
  const confirmed = confirmStepFour(createStepFourState())
  const completed = workflowReducer(confirmed, { type: 'COMPLETE_STEP_FOUR' })
  return workflowReducer(completed, { type: 'COMPLETE_STEP_FOUR', entry: entryFrom(completed) })
}

function exportFor(page: DetailPage, marker = 1): DetailPageExport {
  return {
    pageId: page.id,
    revision: page.compositionRevision,
    signatureSha256: `signature-${page.id}-${page.compositionRevision}`,
    pngBlob: new Blob([new Uint8Array([137, 80, 78, 71, marker])], { type: 'image/png' }),
    pngBlobSha256: String(marker).repeat(64),
    width: 750,
    height: 1334,
  }
}

function synchronize(state: WorkflowState, index = state.detailEditor.activePageIndex, marker = index + 1) {
  const page = state.detailEditor.pages[index]
  const pageExport = exportFor(page, marker)
  return workflowReducer(state, {
    type: 'STEP_FIVE_EXPORT_SUCCEEDED',
    owner: state.detailEditor.owner!,
    pageId: page.id,
    expectedRevision: page.compositionRevision,
    expectedSignatureSha256: pageExport.signatureSha256,
    expectedResourceRevision: state.detailEditor.resourceRevision,
    pageExport,
  })
}

function confirmDetails(state: WorkflowState) {
  const exports = state.detailEditor.pages.map((page) => page.currentExport!)
  return workflowReducer(state, {
    type: 'STEP_FIVE_CONFIRMATION_SUCCEEDED',
    owner: state.detailEditor.owner!,
    expectedResourceRevision: state.detailEditor.resourceRevision,
    pageExports: exports,
    groupSignatureSha256: 'group-signature',
  })
}

describe('Step 4 to Step 5 authoritative entry', () => {
  it('blocks a missing completion and mismatched owner/resource entry', () => {
    const confirmed = confirmStepFour(createStepFourState())
    expect(workflowReducer(confirmed, { type: 'COMPLETE_STEP_FOUR', entry: entryFrom(confirmed) })).toBe(confirmed)
    const completed = workflowReducer(confirmed, { type: 'COMPLETE_STEP_FOUR' })
    const entry = entryFrom(completed)
    const mismatched = workflowReducer(completed, {
      type: 'COMPLETE_STEP_FOUR',
      entry: { ...entry, owner: { ...entry.owner, pngBlobSha256: 'wrong' } },
    })
    expect(mismatched.currentStep).toBe(4)
    expect(mismatched.detailEditor.owner).toBeNull()
  })

  it('initializes exactly one owner page and one poster-final resource', () => {
    const state = createStepFiveState()
    expect(state.currentStep).toBe(5)
    expect(state.detailEditor.pages).toHaveLength(1)
    expect(Object.keys(state.detailEditor.resources)).toEqual(['poster-final'])
    expect(state.detailEditor.pages[0].layers).toHaveLength(1)
    expect(state.detailEditor.pages[0].layers[0]).toMatchObject({ kind: 'image', resourceId: 'poster-final', left: 339, top: 560.28 })
    expect(state.detailEditor.resources['poster-final'].blob).toBe(state.posterEditor.confirmedPoster?.pngBlob)
  })

  it('preserves a compatible draft on Back and same-owner re-entry', () => {
    const initial = createStepFiveState()
    const first = initial.detailEditor.pages[0]
    const dirty = workflowReducer(initial, {
      type: 'COMMIT_STEP_FIVE_PAGE_MUTATION',
      pageId: first.id,
      expectedRevision: first.compositionRevision,
      page: { ...first, layers: [...first.layers, createTextLayer('text-retained')] },
    })
    const draft = dirty.detailEditor
    const back = workflowReducer(dirty, { type: 'GO_TO_STEP_FOUR' })
    const reentered = workflowReducer(back, { type: 'COMPLETE_STEP_FOUR', entry: entryFrom(back) })
    expect(back.currentStep).toBe(4)
    expect(reentered.currentStep).toBe(5)
    expect(reentered.detailEditor.pages).toBe(draft.pages)
    expect(reentered.detailEditor.pages[0].layers.at(-1)?.id).toBe('text-retained')
  })

  it('temporarily dirty Step 4 blocks entry without destroying the compatible draft', () => {
    const initial = createStepFiveState()
    const back = workflowReducer(initial, { type: 'GO_TO_STEP_FOUR' })
    const active = back.posterEditor.active!
    const layout = back.posterEditor.drafts[active.generationId].layout
    const dirty = workflowReducer(back, {
      type: 'COMMIT_STEP_FOUR_MUTATION',
      layout: { ...layout, textBoxes: layout.textBoxes.map((box, index) => index === 0 ? { ...box, text: `${box.text}脏` } : box) },
    })
    const blocked = workflowReducer(dirty, { type: 'COMPLETE_STEP_FOUR', entry: entryFrom(back) })
    expect(blocked.currentStep).toBe(4)
    expect(blocked.detailEditor.pages).toBe(initial.detailEditor.pages)
    expect(blocked.detailEditor.resources['poster-final']).toBe(initial.detailEditor.resources['poster-final'])
  })

  it('changed authoritative signature/hash physically replaces Step 5 state', () => {
    const initial = createStepFiveState()
    const back = workflowReducer(initial, { type: 'GO_TO_STEP_FOUR' })
    const changedSnapshot = confirmedSnapshot(back, {
      inputSignatureSha256: 'changed-signature',
      pngBlob: new Blob([new Uint8Array([9])], { type: 'image/png' }),
      pngBlobSha256: '9'.repeat(64),
    })
    const reconfirmed = confirmStepFour(back, changedSnapshot)
    const completed = workflowReducer(reconfirmed, { type: 'COMPLETE_STEP_FOUR' })
    const replaced = workflowReducer(completed, { type: 'COMPLETE_STEP_FOUR', entry: entryFrom(completed) })
    expect(replaced.detailEditor.owner?.inputSignatureSha256).toBe('changed-signature')
    expect(replaced.detailEditor.pages).not.toBe(initial.detailEditor.pages)
    expect(replaced.detailEditor.pages).toHaveLength(1)
    expect(Object.keys(replaced.detailEditor.resources)).toEqual(['poster-final'])
  })

  it('transaction-only same-signature reconfirmation preserves the draft and retained Blob', () => {
    const initial = createStepFiveState()
    const back = workflowReducer(initial, { type: 'GO_TO_STEP_FOUR' })
    const prior = back.posterEditor.confirmedPoster!
    const reconfirmed = confirmStepFour(back, confirmedSnapshot(back, {
      inputSignatureSha256: prior.inputSignatureSha256,
      pngBlobSha256: prior.pngBlobSha256,
      pngBlob: new Blob([new Uint8Array([7])], { type: 'image/png' }),
    }))
    expect(reconfirmed.posterEditor.confirmedPoster?.pngBlob).toBe(prior.pngBlob)
    const completed = workflowReducer(reconfirmed, { type: 'COMPLETE_STEP_FOUR' })
    const reentered = workflowReducer(completed, { type: 'COMPLETE_STEP_FOUR', entry: entryFrom(completed) })
    expect(reentered.detailEditor.pages).toBe(initial.detailEditor.pages)
  })
})

describe('Step 5 pages, revisions, export and completion', () => {
  it('adds an unbounded inherited empty page without changing prior revision/export', () => {
    const synced = synchronize(createStepFiveState())
    const priorPage = synced.detailEditor.pages[0]
    const next: DetailPage = {
      id: 'stable-page-2',
      background: { ...priorPage.background },
      activeProductId: priorPage.activeProductId,
      selectedFontId: priorPage.selectedFontId,
      layers: [],
      compositionRevision: 0,
      currentExport: null,
    }
    const added = workflowReducer(synced, { type: 'ADD_STEP_FIVE_PAGE', page: next })
    expect(added.detailEditor.pages[0]).toBe(priorPage)
    expect(added.detailEditor.pages[1]).toEqual(next)
    expect(added.detailEditor.activePageIndex).toBe(1)
    expect(added.detailEditor.confirmedDetails).toBeNull()
  })

  it('rejects duplicate page IDs and out-of-range page navigation', () => {
    const state = createStepFiveState()
    expect(workflowReducer(state, { type: 'ADD_STEP_FIVE_PAGE', page: { ...state.detailEditor.pages[0], layers: [], currentExport: null } })).toBe(state)
    expect(workflowReducer(state, { type: 'SET_STEP_FIVE_ACTIVE_PAGE', index: -1 })).toBe(state)
    expect(workflowReducer(state, { type: 'SET_STEP_FIVE_ACTIVE_PAGE', index: 1 })).toBe(state)
  })

  it('keeps selection and tabs chrome-only', () => {
    const state = createStepFiveState()
    const next = workflowReducer(state, { type: 'SET_STEP_FIVE_UI', panel: 'shape', selectedLayerId: null })
    expect(next.detailEditor.pages[0]).toBe(state.detailEditor.pages[0])
    expect(next.detailEditor.pages[0].compositionRevision).toBe(0)
  })

  it('invalidates synchronously on first pixel delta and commits without a second increment', () => {
    let state = synchronize(createStepFiveState())
    const exported = state.detailEditor.pages[0].currentExport
    const revision = state.detailEditor.pages[0].compositionRevision
    state = workflowReducer(state, { type: 'BEGIN_STEP_FIVE_PIXEL_MUTATION', pageId: state.detailEditor.pages[0].id, expectedRevision: revision })
    expect(state.detailEditor.pages[0].compositionRevision).toBe(revision + 1)
    expect(state.detailEditor.pages[0].currentExport).toBeNull()
    expect(exported).not.toBeNull()
    const page = state.detailEditor.pages[0]
    const image = page.layers[0]
    state = workflowReducer(state, {
      type: 'COMMIT_STEP_FIVE_PIXEL_MUTATION',
      pageId: page.id,
      expectedRevision: revision + 1,
      page: { ...page, layers: [{ ...image, left: image.left + 20 }] },
    })
    expect(state.detailEditor.pages[0].compositionRevision).toBe(revision + 1)
    expect(state.detailEditor.pages[0].layers[0].left).toBe(image.left + 20)
  })

  it('every regular pixel mutation increments and clears confirmation/completion', () => {
    let state = confirmDetails(synchronize(createStepFiveState()))
    state = workflowReducer(state, { type: 'COMPLETE_STEP_FIVE' })
    state = workflowReducer(state, { type: 'GO_TO_STEP_FIVE' })
    const page = state.detailEditor.pages[0]
    const next = workflowReducer(state, {
      type: 'COMMIT_STEP_FIVE_PAGE_MUTATION',
      pageId: page.id,
      expectedRevision: page.compositionRevision,
      page: { ...page, background: systemBackground('02') },
    })
    expect(next.detailEditor.pages[0].compositionRevision).toBe(page.compositionRevision + 1)
    expect(next.detailEditor.pages[0].currentExport).toBeNull()
    expect(next.detailEditor.confirmedDetails).toBeNull()
    expect(next.detailEditor.completion).toBeNull()
    expect(next.completedSteps.has(5)).toBe(false)
    expect(next.marketingStrategyStep.completion).toBeNull()
    expect(next.completedSteps.has(6)).toBe(false)
  })

  it('rejects stale async export and accepts only matching page/revision/resource identity', () => {
    const state = createStepFiveState()
    const page = state.detailEditor.pages[0]
    const pageExport = exportFor(page)
    const stale = workflowReducer(state, {
      type: 'STEP_FIVE_EXPORT_SUCCEEDED', owner: state.detailEditor.owner!, pageId: page.id,
      expectedRevision: page.compositionRevision + 1, expectedSignatureSha256: pageExport.signatureSha256,
      expectedResourceRevision: state.detailEditor.resourceRevision, pageExport,
    })
    expect(stale).toBe(state)
    expect(synchronize(state).detailEditor.pages[0].currentExport).not.toBeNull()
  })

  it('a successful re-sync clears prior group confirmation even for unchanged input', () => {
    const state = confirmDetails(synchronize(createStepFiveState()))
    expect(state.detailEditor.confirmedDetails).not.toBeNull()
    const resynced = synchronize(state, 0, 1)
    expect(resynced.detailEditor.confirmedDetails).toBeNull()
    expect(resynced.detailEditor.completion).toBeNull()
  })

  it('confirms all pages atomically with ordered exact Blob aliases', () => {
    let state = createStepFiveState()
    const first = state.detailEditor.pages[0]
    state = workflowReducer(state, {
      type: 'ADD_STEP_FIVE_PAGE',
      page: { id: 'page-2', background: { ...first.background }, activeProductId: first.activeProductId, selectedFontId: first.selectedFontId, layers: [], compositionRevision: 0, currentExport: null },
    })
    state = workflowReducer(state, { type: 'SET_STEP_FIVE_ACTIVE_PAGE', index: 0 })
    state = synchronize(state, 0, 1)
    state = synchronize(state, 1, 2)
    state = confirmDetails(state)
    const confirmed = state.detailEditor.confirmedDetails!
    expect(confirmed.pageExports.map((item) => item.pageId)).toEqual([first.id, 'page-2'])
    expect(confirmed.firstPngBlob).toBe(confirmed.pageExports[0].pngBlob)
    expect(confirmed.pngBlobs[0]).toBe(confirmed.firstPngBlob)
    expect(confirmed.pngBlobs[1]).toBe(confirmed.pageExports[1].pngBlob)
  })

  it('confirmed Next stores typed completion and enters Step 6', () => {
    const confirmed = confirmDetails(synchronize(createStepFiveState()))
    const completed = workflowReducer(confirmed, { type: 'COMPLETE_STEP_FIVE' })
    expect(completed.currentStep).toBe(6)
    expect(completed.completedSteps.has(5)).toBe(true)
    expect(completed.detailEditor.completion).toMatchObject({ pageCount: 1, groupSignatureSha256: 'group-signature' })
    expect(completed.marketingStrategyStep.completion).toBeNull()
  })

  it('different poster selection physically clears all Step 5 owner resources', () => {
    const state = workflowReducer(createStepFiveState(), { type: 'GO_TO_STEP_FOUR' })
    const stepThree = workflowReducer(state, { type: 'GO_TO_STEP_THREE' })
    const selected = workflowReducer(stepThree, { type: 'SELECT_POSTER_SLOT', index: 1 })
    expect(selected.detailEditor.owner).toBeNull()
    expect(selected.detailEditor.pages).toEqual([])
    expect(selected.detailEditor.resources).toEqual({})
  })

  it('blocks unconfirmed Step 6 entry and initializes typed Step 6 state', () => {
    const state = createStepFiveState()
    expect(Object.keys(state)).not.toContain('step6')
    expect(state.marketingStrategyStep).toEqual({ completion: null })
    expect(workflowReducer(state, { type: 'COMPLETE_STEP_FIVE' })).toBe(state)
    expect(workflowReducer(confirmDetails(synchronize(state)), { type: 'COMPLETE_STEP_FIVE' }).currentStep).toBe(6)
  })
})

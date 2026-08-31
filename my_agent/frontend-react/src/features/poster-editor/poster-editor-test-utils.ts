import { createStepThreeState, normalizedSequence, TEST_GENERATION_ID, TEST_POSTER_IDS } from '../poster-generation/poster-test-utils'
import { workflowReducer } from '../../state/workflow-reducer'
import type { WorkflowState } from '../../state/workflow-types'
import type { ConfirmedPoster, PosterBlobResource } from '../../types/poster-editor'
import { createDefaultPosterLayout } from './poster-defaults'

export const TEST_BASE_SHA256 = 'a'.repeat(64)
export const TEST_UPSTREAM_SHA256 = 'b'.repeat(64)
export const TEST_LAYOUT_SHA256 = 'c'.repeat(64)
export const TEST_PNG_SHA256 = 'd'.repeat(64)

export function createStepFourState(options: {
  generationId?: string
  posterIndex?: number
  status?: 'completed' | 'partial_failed' | 'interrupted' | 'running'
} = {}) {
  const status = options.status ?? 'completed'
  const posterIndex = options.posterIndex ?? 0
  const generationId = options.generationId ?? TEST_GENERATION_ID
  const slotStatuses = status === 'completed'
    ? ['ready', 'ready', 'ready']
    : status === 'running'
      ? ['ready', 'generating', 'waiting']
      : ['ready', 'failed', 'blocked']
  const normalized = normalizedSequence(status, slotStatuses, {
    generation_id: generationId,
  })
  let state = createStepThreeState({ result: normalized, activeGenerationId: status === 'running' ? generationId : null })
  state = workflowReducer(state, { type: 'SELECT_POSTER_SLOT', index: posterIndex })
  const slot = normalized.posters[posterIndex]
  if (!slot.posterId || !slot.downloadUrl) throw new Error('test poster missing')
  const baseBlob = new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' })
  const baseBlobId = `base:${generationId}:${slot.posterId}:${TEST_BASE_SHA256}`
  const resource: PosterBlobResource = {
    id: baseBlobId,
    kind: 'base',
    blob: baseBlob,
    sha256: TEST_BASE_SHA256,
    mimeType: 'image/png',
    name: `poster-base-${posterIndex + 1}.png`,
    width: 1024,
    height: 1536,
  }
  const copy = state.platformCopy.platformCopy
  return workflowReducer(state, {
    type: 'ENTER_STEP_FOUR',
    active: {
      generationId,
      posterId: slot.posterId,
      slot: posterIndex + 1,
      downloadUrl: slot.downloadUrl,
      baseBlobId,
      baseBlobSha256: TEST_BASE_SHA256,
      intrinsicWidth: 1024,
      intrinsicHeight: 1536,
      upstreamSha256: TEST_UPSTREAM_SHA256,
      copySnapshot: {
        body: state.platformCopy.copyDraft,
        title: String(copy?.title ?? ''),
        headline: String(copy?.headline ?? ''),
        subline: String(copy?.subline ?? ''),
        platform: state.platformCopy.platform,
        style: state.platformCopy.style,
      },
      resourceRevision: state.posterEditor.resourceRevision,
    },
    baseResource: resource,
    initialLayout: createDefaultPosterLayout(state.platformCopy.platform, copy),
  })
}

export function confirmedSnapshot(
  state: WorkflowState,
  overrides: Partial<ConfirmedPoster> = {},
): ConfirmedPoster {
  const active = state.posterEditor.active
  if (!active) throw new Error('active test editor missing')
  const draft = state.posterEditor.drafts[active.generationId]
  return {
    generationId: active.generationId,
    posterId: active.posterId,
    slot: active.slot,
    baseBlobSha256: active.baseBlobSha256,
    layoutSha256: TEST_LAYOUT_SHA256,
    upstreamSha256: active.upstreamSha256,
    inputSignatureSha256: 'e'.repeat(64),
    copySnapshot: { ...active.copySnapshot },
    layout: draft.layout,
    pngBlob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
    pngBlobSha256: TEST_PNG_SHA256,
    confirmedRevision: state.posterEditor.compositionRevision,
    ...overrides,
  }
}

export function confirmStepFour(state: WorkflowState, snapshot = confirmedSnapshot(state)) {
  return workflowReducer(state, {
    type: 'STEP_FOUR_CONFIRMATION_SUCCEEDED',
    snapshot,
    expectedRevision: snapshot.confirmedRevision,
  })
}

export { TEST_GENERATION_ID, TEST_POSTER_IDS }

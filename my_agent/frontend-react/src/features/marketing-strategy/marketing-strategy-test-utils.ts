import { confirmStepFour, createStepFourState } from '../poster-editor/poster-editor-test-utils'
import { workflowReducer } from '../../state/workflow-reducer'
import type { WorkflowState } from '../../state/workflow-types'
import type {
  DetailOwnerIdentity,
  DetailPageExport,
  DetailResource,
} from '../../types/detail-editor'

export const TEST_STEP5_GROUP_SIGNATURE = '6'.repeat(64)
export const TEST_DETAIL_PNG_SIGNATURE = '7'.repeat(64)

function detailEntry(state: WorkflowState) {
  const confirmed = state.posterEditor.confirmedPoster
  if (!confirmed) throw new Error('confirmed poster test fixture missing')
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

export function createConfirmedStepFiveState(): WorkflowState {
  const confirmedPoster = confirmStepFour(createStepFourState())
  const completedPoster = workflowReducer(confirmedPoster, { type: 'COMPLETE_STEP_FOUR' })
  let state = workflowReducer(completedPoster, {
    type: 'COMPLETE_STEP_FOUR',
    entry: detailEntry(completedPoster),
  })
  const page = state.detailEditor.pages[0]
  const pageExport: DetailPageExport = {
    pageId: page.id,
    revision: page.compositionRevision,
    signatureSha256: '8'.repeat(64),
    pngBlob: new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], {
      type: 'image/png',
    }),
    pngBlobSha256: TEST_DETAIL_PNG_SIGNATURE,
    width: 750,
    height: 1334,
  }
  state = workflowReducer(state, {
    type: 'STEP_FIVE_EXPORT_SUCCEEDED',
    owner: state.detailEditor.owner!,
    pageId: page.id,
    expectedRevision: page.compositionRevision,
    expectedSignatureSha256: pageExport.signatureSha256,
    expectedResourceRevision: state.detailEditor.resourceRevision,
    pageExport,
  })
  return workflowReducer(state, {
    type: 'STEP_FIVE_CONFIRMATION_SUCCEEDED',
    owner: state.detailEditor.owner!,
    expectedResourceRevision: state.detailEditor.resourceRevision,
    pageExports: [state.detailEditor.pages[0].currentExport!],
    groupSignatureSha256: TEST_STEP5_GROUP_SIGNATURE,
  })
}

export function createStepSixState(): WorkflowState {
  return workflowReducer(createConfirmedStepFiveState(), {
    type: 'COMPLETE_STEP_FIVE',
  })
}

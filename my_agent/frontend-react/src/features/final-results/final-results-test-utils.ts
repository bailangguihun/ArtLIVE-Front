import { createStepSixState } from '../marketing-strategy/marketing-strategy-test-utils'
import { workflowReducer } from '../../state/workflow-reducer'
import type { WorkflowState } from '../../state/workflow-types'
import type { DetailPage, DetailPageExport } from '../../types/detail-editor'

const HEX = ['7', '8', '9', 'a', 'b', 'c', 'd', 'e', 'f'] as const

function withDetailCount(state: WorkflowState, count: number): WorkflowState {
  if (!Number.isInteger(count) || count < 1 || count >= HEX.length) {
    throw new Error('detailCount must be between 1 and 8')
  }
  const sourcePage = state.detailEditor.pages[0]
  const sourceExport = sourcePage.currentExport
  const owner = state.detailEditor.owner
  if (!sourcePage || !sourceExport || !owner) {
    throw new Error('Step 5 test authority is incomplete')
  }
  const pages: DetailPage[] = []
  const pageExports: DetailPageExport[] = []
  for (let index = 0; index < count; index += 1) {
    const pageId = index === 0 ? sourcePage.id : `page-final-${index + 1}`
    const pageExport = index === 0
      ? sourceExport
      : {
          pageId,
          revision: sourcePage.compositionRevision,
          signatureSha256: HEX[index].repeat(64),
          pngBlob: new Blob(
            [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, index + 1])],
            { type: 'image/png' },
          ),
          pngBlobSha256: HEX[index + 1].repeat(64),
          width: 750 as const,
          height: 1334 as const,
        }
    const page = index === 0
      ? sourcePage
      : { ...sourcePage, id: pageId, currentExport: pageExport }
    pages.push(page)
    pageExports.push(pageExport)
  }
  const groupSignatureSha256 = HEX[count].repeat(64)
  return {
    ...state,
    completedSteps: new Set([...state.completedSteps].filter((step) => step < 6)),
    detailEditor: {
      ...state.detailEditor,
      pages,
      nextPageSequence: count + 1,
      confirmedDetails: {
        owner: { ...owner },
        pageExports,
        pngBlobs: pageExports.map((item) => item.pngBlob),
        firstPngBlob: pageExports[0].pngBlob,
        groupSignatureSha256,
        confirmedResourceRevision: state.detailEditor.resourceRevision,
      },
      completion: {
        owner: { ...owner },
        groupSignatureSha256,
        pageCount: count,
        pngBlobSha256: pageExports.map((item) => item.pngBlobSha256),
      },
    },
    marketingStrategyStep: { completion: null },
  }
}

export interface StepSevenFixtureOptions {
  body?: string
  detailCount?: number
  missingStrategy?: boolean
}

export function createStepSevenState(
  options: StepSevenFixtureOptions = {},
): WorkflowState {
  let state = withDetailCount(
    createStepSixState(),
    options.detailCount ?? 1,
  )
  if (options.body !== undefined) {
    state = {
      ...state,
      posterEditor: {
        ...state.posterEditor,
        active: state.posterEditor.active
          ? {
              ...state.posterEditor.active,
              copySnapshot: {
                ...state.posterEditor.active.copySnapshot,
                body: options.body,
              },
            }
          : null,
        confirmedPoster: state.posterEditor.confirmedPoster
          ? {
              ...state.posterEditor.confirmedPoster,
              copySnapshot: {
                ...state.posterEditor.confirmedPoster.copySnapshot,
                body: options.body,
              },
            }
          : null,
      },
    }
  }
  if (options.missingStrategy) {
    state = {
      ...state,
      platformCopy: { ...state.platformCopy, marketingStrategy: {} },
      posterGeneration: {
        ...state.posterGeneration,
        result: state.posterGeneration.result
          ? { ...state.posterGeneration.result, marketingStrategy: {} }
          : null,
      },
    }
  }
  const entered = workflowReducer(state, { type: 'COMPLETE_STEP_SIX' })
  if (entered.currentStep !== 7) {
    throw new Error('Step 7 test fixture failed authority validation')
  }
  return entered
}

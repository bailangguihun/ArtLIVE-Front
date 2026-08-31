import type {
  ProductImageSelection,
  ProductInfoDraft,
  ProductInfoErrors,
  ProductInfoField,
  ProductInfoValues,
} from '../types/product-info'
import type {
  CopyStyleId,
  CopyVariant,
  MarketingStrategy,
  PlatformCopyState,
  PlatformId,
} from '../types/platform-copy'
import type {
  NormalizedSequenceResult,
  PosterGenerationState,
} from '../types/poster-generation'
import type {
  ActivePosterEditor,
  CompletePosterLayout,
  ConfirmedPoster,
  PosterBlobResource,
  PosterEditorPanel,
  PosterEditorState,
} from '../types/poster-editor'
import type {
  DetailEditorOperations,
  DetailEditorPanel,
  DetailEditorState,
  DetailOwnerIdentity,
  DetailPage,
  DetailPageExport,
  DetailResource,
} from '../types/detail-editor'
import type { MarketingStrategyStepState } from '../types/marketing-strategy'
import type {
  BasicAuthority,
  ConfirmedCopy,
  ConfirmedDetail as WorkflowV2ConfirmedDetail,
  ConfirmedPoster as WorkflowV2ConfirmedPoster,
  DetailProject,
  PresentAdviceAuthority,
  PosterProjectInput,
} from './workflow-v2/workflow-v2-types'
import type {
  AdviceRequestErrorCode,
  CopyRequestErrorCode,
  PendingAdviceRequest,
  PendingBasicCommit,
  PendingCopyRequest,
  WorkflowV2SessionState,
} from './workflow-v2/workflow-v2-session'

export const WORKFLOW_STEPS = [
  { id: 1, label: '1. 产品信息' },
  { id: 2, label: '2. 平台与文案' },
  { id: 3, label: '3. 生成海报' },
  { id: 4, label: '4. 文字编辑' },
  { id: 5, label: '5. 详情页制作' },
  { id: 6, label: '6. 营销策略' },
  { id: 7, label: '7. 最终结果' },
] as const

export type WorkflowStepId = (typeof WORKFLOW_STEPS)[number]['id']

export interface ProductInfoState {
  values: ProductInfoValues
  productImage: ProductImageSelection | null
  errors: ProductInfoErrors
  completedDraft: ProductInfoDraft | null
}

export interface WorkflowState {
  currentStep: WorkflowStepId
  completedSteps: ReadonlySet<WorkflowStepId>
  productInfo: ProductInfoState
  platformCopy: PlatformCopyState
  posterGeneration: PosterGenerationState
  posterEditor: PosterEditorState
  detailEditor: DetailEditorState
  marketingStrategyStep: MarketingStrategyStepState
  workflowV2: WorkflowV2SessionState
}

export type WorkflowAction =
  | {
      type: 'UPDATE_STEP_ONE_FIELD'
      field: ProductInfoField
      value: string
    }
  | {
      type: 'UPDATE_CREATIVE_NOTE'
      value: string
    }
  | {
      type: 'REPLACE_STEP_ONE_IMAGE'
      image: ProductImageSelection
    }
  | { type: 'REMOVE_STEP_ONE_IMAGE' }
  | { type: 'VALIDATE_STEP_ONE' }
  | { type: 'COMPLETE_STEP_ONE' }
  | { type: 'GO_TO_STEP_ONE' }
  | { type: 'UPDATE_STEP_TWO_PLATFORM'; platform: PlatformId }
  | { type: 'UPDATE_STEP_TWO_STYLE'; style: CopyStyleId }
  | { type: 'UPDATE_STEP_TWO_DRAFT'; value: string }
  | { type: 'SELECT_STEP_TWO_VARIANT'; index: number }
  | { type: 'SET_COPY_GENERATION_ERROR'; error: string }
  | {
      type: 'BEGIN_COPY_GENERATION'
      fingerprint: string
      idempotencyKey: string
    }
  | {
      type: 'COPY_GENERATION_SUCCEEDED'
      fingerprint: string
      idempotencyKey: string
      variants: CopyVariant[]
      marketingStrategy: MarketingStrategy
      requestId: string | null
      generationPlatform: PlatformId
      generationStyle: CopyStyleId
    }
  | {
      type: 'COPY_GENERATION_FAILED'
      fingerprint: string
      idempotencyKey: string
      error: string
    }
  | { type: 'END_COPY_GENERATION' }
  | { type: 'COMPLETE_STEP_TWO' }
  | { type: 'GO_TO_STEP_TWO' }
  | { type: 'SET_POSTER_CONSENT'; consent: boolean }
  | { type: 'BEGIN_POSTER_CAPABILITIES' }
  | {
      type: 'POSTER_CAPABILITIES_SUCCEEDED'
      sequenceEnabled: boolean
      seedreamConfigured: boolean
    }
  | { type: 'POSTER_CAPABILITIES_FAILED'; error: string }
  | { type: 'SET_POSTER_ADMISSION_ERROR'; error: string }
  | { type: 'BEGIN_POSTER_ADMISSION' }
  | {
      type: 'SET_PENDING_POSTER_INTENT'
      fingerprint: string
      idempotencyKey: string
    }
  | {
      type: 'POSTER_ADMISSION_FAILED'
      error: string
      ambiguous: boolean
    }
  | { type: 'END_POSTER_ADMISSION' }
  | { type: 'CANCEL_PENDING_POSTER_WORK' }
  | {
      type: 'APPLY_POSTER_RESULT'
      result: NormalizedSequenceResult
      source: 'admission' | 'poll'
      fingerprint?: string
    }
  | { type: 'SET_POSTER_POLL_ERROR'; error: string }
  | { type: 'SELECT_POSTER_SLOT'; index: number }
  | { type: 'COMPLETE_STEP_THREE' }
  | {
      type: 'BEGIN_POSTER_BINARY'
      kind: 'preview' | 'download'
      posterId: string
    }
  | {
      type: 'POSTER_BINARY_SUCCEEDED'
      kind: 'preview' | 'download'
      posterId: string
      blob: Blob
      objectUrl: string
    }
  | {
      type: 'POSTER_BINARY_FAILED'
      kind: 'preview' | 'download'
      posterId: string
      error: string
    }
  | {
      type: 'RESET_POSTER_BINARY'
      kind: 'preview' | 'download'
      posterId: string
    }
  | { type: 'BEGIN_POSTER_ZIP'; generationId: string }
  | {
      type: 'POSTER_ZIP_SUCCEEDED'
      generationId: string
      blob: Blob
      objectUrl: string
    }
  | { type: 'POSTER_ZIP_FAILED'; generationId: string; error: string }
  | { type: 'BEGIN_STEP_FOUR_ENTRY' }
  | { type: 'CANCEL_STEP_FOUR_ENTRY' }
  | { type: 'STEP_FOUR_ENTRY_FAILED'; error: string }
  | {
      type: 'ENTER_STEP_FOUR'
      active: ActivePosterEditor
      baseResource: PosterBlobResource
      initialLayout: CompletePosterLayout
    }
  | { type: 'GO_TO_STEP_THREE' }
  | {
      type: 'SET_STEP_FOUR_UI'
      panel?: PosterEditorPanel
      selectedTextId?: string | null
      selectedShapeId?: string | null
      selectedImageId?: string | null
    }
  | {
      type: 'COMMIT_STEP_FOUR_MUTATION'
      layout: CompletePosterLayout
      addedResources?: PosterBlobResource[]
      removedResourceIds?: string[]
      imageStatus?: string
    }
  | { type: 'BEGIN_STEP_FOUR_EXPORT' }
  | { type: 'STEP_FOUR_EXPORT_FINISHED' }
  | { type: 'STEP_FOUR_EXPORT_FAILED'; error: string }
  | { type: 'BEGIN_STEP_FOUR_CONFIRMATION' }
  | {
      type: 'STEP_FOUR_CONFIRMATION_SUCCEEDED'
      snapshot: ConfirmedPoster
      expectedRevision: number
    }
  | { type: 'STEP_FOUR_CONFIRMATION_FAILED'; error: string }
  | {
      type: 'COMPLETE_STEP_FOUR'
      entry?: {
        owner: DetailOwnerIdentity
        posterResource: DetailResource
      }
    }
  | { type: 'GO_TO_STEP_FOUR' }
  | {
      type: 'SET_STEP_FIVE_UI'
      panel?: DetailEditorPanel
      selectedLayerId?: string | null
      selectedResourceId?: string | null
    }
  | { type: 'SET_STEP_FIVE_ACTIVE_PAGE'; index: number }
  | { type: 'ADD_STEP_FIVE_PAGE'; page: DetailPage }
  | {
      type: 'COMMIT_STEP_FIVE_PAGE_MUTATION'
      pageId: string
      expectedRevision: number
      page: DetailPage
      addedResources?: DetailResource[]
      removedResourceIds?: string[]
      selectedLayerId?: string | null
      selectedResourceId?: string | null
    }
  | {
      type: 'BEGIN_STEP_FIVE_PIXEL_MUTATION'
      pageId: string
      expectedRevision: number
    }
  | {
      type: 'COMMIT_STEP_FIVE_PIXEL_MUTATION'
      pageId: string
      expectedRevision: number
      page: DetailPage
    }
  | { type: 'SET_STEP_FIVE_OPERATIONS'; operations: Partial<DetailEditorOperations> }
  | {
      type: 'STEP_FIVE_EXPORT_SUCCEEDED'
      owner: DetailOwnerIdentity
      pageId: string
      expectedRevision: number
      expectedSignatureSha256: string
      expectedResourceRevision: number
      pageExport: DetailPageExport
    }
  | {
      type: 'STEP_FIVE_CONFIRMATION_SUCCEEDED'
      owner: DetailOwnerIdentity
      expectedResourceRevision: number
      pageExports: DetailPageExport[]
      groupSignatureSha256: string
    }
  | { type: 'COMPLETE_STEP_FIVE' }
  | { type: 'GO_TO_STEP_FIVE' }
  | { type: 'COMPLETE_STEP_SIX' }
  | { type: 'GO_TO_STEP_SIX' }
  | { type: 'RESET_WORKFLOW' }
  | { type: 'START_V2_CREATION' }
  | { type: 'V2_RETURN_HOME' }
  | { type: 'ENTER_V2_HISTORY' }
  | { type: 'V2_CONTINUE_SESSION' }
  | { type: 'BEGIN_V2_BASIC_COMMIT'; pending: PendingBasicCommit }
  | {
      type: 'COMMIT_V2_BASIC'
      requestId: string
      workflowEpoch: number
      draftRevision: number
      authority: BasicAuthority
    }
  | {
      type: 'COMMIT_V2_BASIC_AUTHORITY'
      workflowEpoch: number
      draftRevision: number
      authority: BasicAuthority
    }
  | {
      type: 'FAIL_V2_BASIC_COMMIT'
      requestId: string
      workflowEpoch: number
      draftRevision: number
      error: string
    }
  | { type: 'BEGIN_V2_ADVICE_REQUEST'; pending: PendingAdviceRequest }
  | {
      type: 'COMMIT_V2_ADVICE'
      requestId: string
      workflowEpoch: number
      draftRevision: number
      expectedInputSignatureSha256: string
      basicTextSignatureSha256: string
      authority: PresentAdviceAuthority
    }
  | {
      type: 'FAIL_V2_ADVICE_REQUEST'
      requestId: string
      workflowEpoch: number
      draftRevision: number
      expectedInputSignatureSha256: string
      basicTextSignatureSha256: string
      error: AdviceRequestErrorCode
    }
  | {
      type: 'CANCEL_V2_ADVICE_REQUEST'
      requestId: string
      workflowEpoch: number
      draftRevision: number
      expectedInputSignatureSha256: string
      basicTextSignatureSha256: string
    }
  | { type: 'CONTINUE_FROM_V2_ADVICE' }
  | { type: 'RETURN_TO_V2_ADVICE' }
  | { type: 'ENTER_V2_ADVICE' }
  | { type: 'ENTER_V2_WORKSPACE' }
  | { type: 'CLEAR_V2_WORKSPACE_FOCUS' }
  | { type: 'ENTER_V2_COPY' }
  | { type: 'RETURN_FROM_V2_COPY' }
  | { type: 'ENTER_V2_POSTER' }
  | { type: 'RETURN_FROM_V2_POSTER' }
  | { type: 'ENTER_V2_RESULTS' }
  | { type: 'RETURN_FROM_V2_RESULTS' }
  | { type: 'COMMIT_V2_POSTER_PROJECT'; project: PosterProjectInput }
  | { type: 'COMMIT_V2_CONFIRMED_POSTER'; poster: WorkflowV2ConfirmedPoster }
  | { type: 'ENTER_V2_LEGACY_POSTER' }
  | { type: 'ENTER_V2_LEGACY_DETAIL' }
  | { type: 'SHOW_V2_DETAIL_UPDATE' }
  | {
      type: 'COMMIT_V2_DETAIL_ENTRY'
      project: DetailProject
      legacyOwner: DetailOwnerIdentity
      posterResource: DetailResource
    }
  | { type: 'FAIL_V2_DETAIL_ENTRY'; error: string }
  | { type: 'RETURN_FROM_V2_DETAIL' }
  | {
      type: 'COMMIT_V2_DETAIL_CONFIRMATION'
      project: DetailProject
      confirmedDetail: WorkflowV2ConfirmedDetail
      legacyOwner: DetailOwnerIdentity
      expectedResourceRevision: number
      pageExports: DetailPageExport[]
      groupSignatureSha256: string
    }
  | { type: 'COMPLETE_V2_DETAIL' }
  | { type: 'BEGIN_V2_COPY_REQUEST'; pending: PendingCopyRequest }
  | {
      type: 'COMMIT_V2_COPY_REQUEST'
      pending: PendingCopyRequest
      variants: CopyVariant[]
      marketingStrategy: MarketingStrategy
      requestId: string | null
      generationPlatform: PlatformId
      generationStyle: CopyStyleId
    }
  | {
      type: 'FAIL_V2_COPY_REQUEST'
      pending: PendingCopyRequest
      error: CopyRequestErrorCode
      message: string
    }
  | { type: 'CANCEL_V2_COPY_REQUEST'; pending: PendingCopyRequest }
  | { type: 'COMMIT_V2_CONFIRMED_COPY'; copy: ConfirmedCopy }
  | { type: 'COMMIT_V2_CONFIRMED_COPY_AND_RETURN'; copy: ConfirmedCopy }

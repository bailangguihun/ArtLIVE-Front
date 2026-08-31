import type { CopyStyleId, PlatformId } from '../../types/platform-copy'
import type { PosterStyleTemplateId } from '../../types/poster-style-template'

export const WORKFLOW_V2_CONTRACT_VERSION = 'workflow-v2-contract-v1' as const
export const BASIC_AUTHORITY_VERSION = 'workflow-v2-basic-v1' as const
export const BASIC_TEXT_IDENTITY_VERSION = 'workflow-v2-basic-text-v1' as const
export const BASIC_SETTINGS_IDENTITY_VERSION = 'workflow-v2-basic-settings-v1' as const
export const PRODUCT_IMAGE_IDENTITY_VERSION = 'workflow-v2-product-image-v1' as const
export const ADVICE_AUTHORITY_VERSION = 'workflow-v2-advice-authority-v1' as const
export const ADVICE_VERSION = 'catalog-v1' as const
export const COPY_INPUT_VERSION = 'workflow-v2-copy-input-v1' as const
export const CONFIRMED_COPY_VERSION = 'workflow-v2-confirmed-copy-v1' as const
export const COPY_REF_VERSION = 'workflow-v2-copy-ref-v1' as const
export const POSTER_PROJECT_VERSION = 'workflow-v2-poster-project-v3' as const

export type PosterGenerationKind = 'blank_base' | 'template'
export type PosterTypographyMode = 'textless' | 'with_text'
export const CONFIRMED_POSTER_VERSION = 'workflow-v2-confirmed-poster-v1' as const
export const POSTER_REF_VERSION = 'workflow-v2-poster-ref-v1' as const
export const DETAIL_OWNER_VERSION = 'workflow-v2-detail-owner-v1' as const
export const DETAIL_PROJECT_VERSION = 'workflow-v2-detail-project-v1' as const
export const CONFIRMED_DETAIL_VERSION = 'workflow-v2-confirmed-detail-v1' as const
export const PROGRESSIVE_RESULTS_VERSION = 'workflow-v2-progressive-results-v1' as const
export const ASYNC_OWNERSHIP_VERSION = 'workflow-v2-async-ownership-v1' as const

export const WORKFLOW_V2_VIEW_IDS = [
  'home',
  'history',
  'basic',
  'advice',
  'workspace',
  'copy',
  'poster',
  'detail',
  'results',
] as const

export type WorkflowV2ViewId = (typeof WORKFLOW_V2_VIEW_IDS)[number]

export const WORKFLOW_V2_MODULE_IDS = ['copy', 'poster', 'detail'] as const
export type WorkflowV2ModuleId = (typeof WORKFLOW_V2_MODULE_IDS)[number]

export const WORKFLOW_V2_MODULE_STATUSES = [
  'locked',
  'ready',
  'in_progress',
  'completed',
  'stale',
  'failed',
] as const

export type WorkflowV2ModuleStatus =
  (typeof WORKFLOW_V2_MODULE_STATUSES)[number]

export const WORKFLOW_V2_STATUS_REASON_CODES = [
  'basic_missing',
  'basic_stale',
  'advice_missing',
  'advice_stale',
  'product_image_missing',
  'capability_unavailable',
  'request_in_progress',
  'output_current',
  'output_stale',
  'owner_mismatch',
  'copy_reference_stale',
  'poster_not_confirmed',
  'poster_reference_stale',
  'operation_failed',
  'inputs_current',
] as const

export type WorkflowV2StatusReasonCode =
  (typeof WORKFLOW_V2_STATUS_REASON_CODES)[number]

export interface WorkflowV2ModuleStatusResult {
  readonly module: WorkflowV2ModuleId
  readonly status: WorkflowV2ModuleStatus
  readonly reasonCode: WorkflowV2StatusReasonCode
  readonly message: string
  readonly recoverableDraft: boolean
}

export type Sha256Hex = string

export interface BasicTextValues {
  readonly productInfo: string
  readonly productShortName: string
  readonly creativeNote: string
}

export interface BasicTextIdentity {
  readonly version: typeof BASIC_TEXT_IDENTITY_VERSION
  readonly values: BasicTextValues
  readonly signatureSha256: Sha256Hex
  readonly adviceInputSignatureSha256: Sha256Hex
}

export interface BasicSettingsIdentity {
  readonly version: typeof BASIC_SETTINGS_IDENTITY_VERSION
  readonly platform: PlatformId
  readonly style: CopyStyleId
  readonly signatureSha256: Sha256Hex
}

export interface AbsentProductImageIdentity {
  readonly version: typeof PRODUCT_IMAGE_IDENTITY_VERSION
  readonly kind: 'absent'
  readonly signatureSha256: Sha256Hex
}

export interface PresentProductImageIdentity {
  readonly version: typeof PRODUCT_IMAGE_IDENTITY_VERSION
  readonly kind: 'present'
  readonly byteSha256: Sha256Hex
  readonly mimeType: string
  readonly byteSize: number
  readonly signatureSha256: Sha256Hex
}

export type ProductImageIdentity =
  | AbsentProductImageIdentity
  | PresentProductImageIdentity

export interface BasicAuthority {
  readonly version: typeof BASIC_AUTHORITY_VERSION
  readonly text: BasicTextIdentity
  readonly settings: BasicSettingsIdentity
  readonly productImage: ProductImageIdentity
}

export type AdviceCategoryId =
  | 'fmcg'
  | 'durable'
  | 'service'
  | 'digital'
  | 'luxury'
  | 'b2b'
  | 'health'

export type AdviceConfidence = 'low' | 'medium' | 'high'

export interface AdviceStrategy {
  readonly id: AdviceCategoryId
  readonly name: string
  readonly examples: string
  readonly traits: readonly string[]
  readonly tactics: readonly string[]
  readonly one_liner: string
}

export interface AdviceResult {
  readonly category_id: AdviceCategoryId
  readonly category_name: string
  readonly confidence: AdviceConfidence
  readonly matched_keywords: readonly string[]
  readonly reason: string
  readonly score: number
  readonly strategy: AdviceStrategy
  readonly source: 'desktop_ai_different_product_marketing_strategies'
}

export interface PresentAdviceAuthority {
  readonly authorityVersion: typeof ADVICE_AUTHORITY_VERSION
  readonly kind: 'present'
  readonly adviceVersion: typeof ADVICE_VERSION
  readonly inputSignatureSha256: Sha256Hex
  readonly adviceSignatureSha256: Sha256Hex
  readonly ownerSignatureSha256: Sha256Hex
  readonly advice: AdviceResult
}

export type AdviceAbsentReason = 'user_acknowledged_absence'

export interface AcknowledgedAbsentAdviceAuthority {
  readonly authorityVersion: typeof ADVICE_AUTHORITY_VERSION
  readonly kind: 'acknowledged_absent'
  readonly adviceVersion: typeof ADVICE_VERSION
  readonly inputSignatureSha256: Sha256Hex
  readonly absentReason: AdviceAbsentReason
  readonly ownerSignatureSha256: Sha256Hex
}

export type AdviceAuthority =
  | PresentAdviceAuthority
  | AcknowledgedAbsentAdviceAuthority

export type AdviceOwner =
  | Readonly<{
      kind: 'present'
      authorityVersion: typeof ADVICE_AUTHORITY_VERSION
      adviceVersion: typeof ADVICE_VERSION
      inputSignatureSha256: Sha256Hex
      adviceSignatureSha256: Sha256Hex
      ownerSignatureSha256: Sha256Hex
    }>
  | Readonly<{
      kind: 'acknowledged_absent'
      authorityVersion: typeof ADVICE_AUTHORITY_VERSION
      adviceVersion: typeof ADVICE_VERSION
      inputSignatureSha256: Sha256Hex
      absentReason: AdviceAbsentReason
      ownerSignatureSha256: Sha256Hex
    }>

export interface CopyBasicOwner {
  readonly textSignatureSha256: Sha256Hex
  readonly settingsSignatureSha256: Sha256Hex
}

export interface CopyInputAuthority {
  readonly version: typeof COPY_INPUT_VERSION
  readonly basicOwner: CopyBasicOwner
  readonly adviceOwner: AdviceOwner
  readonly platform: PlatformId
  readonly style: CopyStyleId
  readonly inputSignatureSha256: Sha256Hex
}

export type CopySourceIdentity =
  | Readonly<{
      kind: 'generated'
      requestFingerprintSha256: Sha256Hex
      selectedVariantIndex: number
      variantSignatureSha256: Sha256Hex
    }>
  | Readonly<{
      kind: 'selected'
      selectedIndex: number
      candidateSignatureSha256: Sha256Hex
    }>
  | Readonly<{
      kind: 'manual'
      baseOutputSignatureSha256: Sha256Hex | null
    }>

export interface ConfirmedCopyFields {
  readonly body: string
  readonly title: string
  readonly headline: string
  readonly subline: string
}

export interface ConfirmedCopy extends ConfirmedCopyFields {
  readonly authorityVersion: typeof CONFIRMED_COPY_VERSION
  readonly input: CopyInputAuthority
  readonly revision: number
  readonly platform: PlatformId
  readonly style: CopyStyleId
  readonly source: CopySourceIdentity
  readonly outputSignatureSha256: Sha256Hex
  readonly resultArtifactSignatureSha256: Sha256Hex
}

export interface CopyRef {
  readonly version: typeof COPY_REF_VERSION
  readonly copyAuthorityVersion: typeof CONFIRMED_COPY_VERSION
  readonly revision: number
  readonly basicOwner: CopyBasicOwner
  readonly adviceOwner: AdviceOwner
  readonly inputSignatureSha256: Sha256Hex
  readonly outputSignatureSha256: Sha256Hex
}

export interface PosterBasicOwner extends CopyBasicOwner {
  readonly productImage: ProductImageIdentity
}

export interface PosterProjectInput {
  readonly version: typeof POSTER_PROJECT_VERSION
  readonly projectId: string
  readonly projectIdentitySha256: Sha256Hex
  readonly basicOwner: PosterBasicOwner
  readonly adviceOwner: AdviceOwner
  readonly platform: PlatformId
  readonly style: CopyStyleId
  /** The source is explicit; a missing CopyRef never means "latest Copy". */
  readonly copySource: 'confirmed_copy' | 'poster_owned'
  readonly copyRef: CopyRef | null
  /**
   * blank_base: textless DIY bases without a style-template picker.
   * template: style templates plus an explicit typography mode.
   */
  readonly generationKind: PosterGenerationKind
  /**
   * with_text only applies under template mode; blank_base is always textless.
   * Provider-rendered posters skip the local poster editor.
   */
  readonly typographyMode: PosterTypographyMode
  /** null is the sole semantic representation of the intelligent-match option. */
  readonly styleTemplateId: PosterStyleTemplateId | null
  readonly inputSignatureSha256: Sha256Hex
}

export interface PosterCopySnapshot extends ConfirmedCopyFields {
  readonly kind: 'poster_copy_snapshot'
  readonly sourceMode: 'confirmed_copy' | 'poster_owned'
  readonly platform: PlatformId
  readonly style: CopyStyleId
  readonly sourceCopyRef: CopyRef | null
  readonly snapshotSignatureSha256: Sha256Hex
}

export interface ConfirmedPoster {
  readonly authorityVersion: typeof CONFIRMED_POSTER_VERSION
  readonly project: PosterProjectInput
  readonly generationId: string
  readonly posterId: string
  readonly slot: number
  readonly baseBlobSha256: Sha256Hex
  readonly layoutSha256: Sha256Hex
  readonly upstreamSha256: Sha256Hex
  readonly compositionInputSignatureSha256: Sha256Hex
  readonly pngBlobSha256: Sha256Hex
  readonly confirmedRevision: number
  readonly resourceRevision: number
  readonly copySnapshot: PosterCopySnapshot
  readonly outputSignatureSha256: Sha256Hex
  readonly resultArtifactSignatureSha256: Sha256Hex
}

export interface PosterRef {
  readonly version: typeof POSTER_REF_VERSION
  readonly posterAuthorityVersion: typeof CONFIRMED_POSTER_VERSION
  readonly projectId: string
  readonly projectIdentitySha256: Sha256Hex
  readonly posterInputSignatureSha256: Sha256Hex
  readonly generationId: string
  readonly posterId: string
  readonly slot: number
  readonly baseBlobSha256: Sha256Hex
  readonly layoutSha256: Sha256Hex
  readonly upstreamSha256: Sha256Hex
  readonly compositionInputSignatureSha256: Sha256Hex
  readonly pngBlobSha256: Sha256Hex
  readonly confirmedRevision: number
  readonly resourceRevision: number
  readonly outputSignatureSha256: Sha256Hex
}

export interface DetailOwner {
  readonly version: typeof DETAIL_OWNER_VERSION
  readonly posterRef: PosterRef
  readonly ownerSignatureSha256: Sha256Hex
}

/**
 * The editor remains the legacy rendering engine, but this record is the V2
 * authority that says which exact confirmed Poster it is allowed to edit.
 */
export interface DetailProject {
  readonly version: typeof DETAIL_PROJECT_VERSION
  readonly detailId: string
  readonly owner: DetailOwner
  readonly projectSignatureSha256: Sha256Hex
}

export interface ConfirmedDetail {
  readonly authorityVersion: typeof CONFIRMED_DETAIL_VERSION
  readonly detailId: string
  readonly owner: DetailOwner
  readonly detailRevision: number
  readonly resourceRevision: number
  readonly pageSignatureSha256: readonly Sha256Hex[]
  readonly pngBlobSha256: readonly Sha256Hex[]
  readonly groupSignatureSha256: Sha256Hex
  readonly outputSignatureSha256: Sha256Hex
  readonly resultArtifactSignatureSha256: Sha256Hex
}

export const WORKFLOW_V2_OPERATION_PHASES = [
  'advice_request',
  'copy_request',
  'poster_admission',
  'poster_generation',
  'poster_polling',
  'poster_download',
  'poster_editing',
  'poster_export',
  'poster_confirmation',
  'detail_editing',
  'detail_export',
  'detail_confirmation',
] as const

export type WorkflowV2OperationPhase =
  (typeof WORKFLOW_V2_OPERATION_PHASES)[number]

export type ModuleOperationState =
  | Readonly<{ kind: 'idle' }>
  | Readonly<{
      kind: 'in_progress'
      phase: WorkflowV2OperationPhase
      ownerInputSignatureSha256: Sha256Hex
    }>
  | Readonly<{
      kind: 'failed'
      phase: WorkflowV2OperationPhase
      ownerInputSignatureSha256: Sha256Hex
      errorCode: string
    }>

export type AdviceRequestOutcome =
  | Readonly<{ kind: 'succeeded'; authority: PresentAdviceAuthority }>
  | Readonly<{ kind: 'failed'; errorCode: string }>

export interface PendingAsyncOwnership {
  readonly version: typeof ASYNC_OWNERSHIP_VERSION
  readonly module: 'advice' | 'copy' | 'poster'
  readonly workflowEpoch: number
  readonly requestId: string
  readonly pendingFingerprintSha256: Sha256Hex
  readonly ownerInputSignatureSha256: Sha256Hex
  readonly revision: number | null
  readonly referenceSignatureSha256: Sha256Hex | null
}

export interface AsyncResponseOwnershipClaim {
  readonly module: PendingAsyncOwnership['module']
  readonly workflowEpoch: number
  readonly requestId: string
  readonly pendingFingerprintSha256: Sha256Hex
  readonly ownerInputSignatureSha256: Sha256Hex
  readonly revision: number | null
  readonly referenceSignatureSha256: Sha256Hex | null
}

export type ProgressiveResultsMode =
  | 'none'
  | 'copy_only'
  | 'poster_only'
  | 'copy_and_poster'
  | 'poster_and_detail'
  | 'all_current'

export interface PromotionalCopyArtifact {
  readonly kind: 'promotional_copy'
  readonly label: 'Promotional Copy'
  readonly copyRef: CopyRef
  readonly fields: ConfirmedCopyFields
  readonly artifactIdentitySha256: Sha256Hex
}

export interface PosterCopySnapshotArtifact {
  readonly kind: 'poster_copy_snapshot'
  readonly label: 'Poster Frozen Copy Snapshot'
  readonly posterRef: PosterRef
  readonly fields: ConfirmedCopyFields
  readonly artifactIdentitySha256: Sha256Hex
}

export interface PosterResultArtifact {
  readonly kind: 'poster'
  readonly label: 'Confirmed Poster'
  readonly posterRef: PosterRef
  readonly artifactIdentitySha256: Sha256Hex
}

export interface DetailResultArtifact {
  readonly kind: 'detail'
  readonly label: 'Confirmed Detail'
  readonly detailId: string
  readonly posterRef: PosterRef
  readonly artifactIdentitySha256: Sha256Hex
}

export type ProgressiveResultArtifact =
  | PromotionalCopyArtifact
  | PosterCopySnapshotArtifact
  | PosterResultArtifact
  | DetailResultArtifact

export interface ProgressiveResultsExclusion {
  readonly kind: 'promotional_copy' | 'poster' | 'detail'
  readonly id: string
  readonly reason: 'stale' | 'mixed_owner'
}

export interface ProgressiveResultsSelection {
  readonly version: typeof PROGRESSIVE_RESULTS_VERSION
  readonly mode: ProgressiveResultsMode
  readonly promotionalCopy: PromotionalCopyArtifact | null
  readonly posters: readonly PosterResultArtifact[]
  readonly posterCopySnapshots: readonly PosterCopySnapshotArtifact[]
  readonly details: readonly DetailResultArtifact[]
  readonly artifacts: readonly ProgressiveResultArtifact[]
  readonly exclusions: readonly ProgressiveResultsExclusion[]
}

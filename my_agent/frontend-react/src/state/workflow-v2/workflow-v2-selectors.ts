import {
  adviceOwnerFromAuthority,
  copyRefFromConfirmedCopy,
  confirmedCopyMatchesRef,
  confirmedPosterMatchesRef,
  isAdviceCurrentForBasic,
  isBasicAuthorityInternallyConsistent,
  isCopyInputInternallyConsistent,
  isConfirmedCopyCurrent,
  isConfirmedCopyInternallyConsistent,
  isConfirmedDetailInternallyConsistent,
  isConfirmedPosterCurrent,
  isConfirmedPosterInternallyConsistent,
  isPosterProjectCurrent,
  posterRefFromConfirmedPoster,
  sameAdviceOwner,
  samePosterRef,
} from './workflow-v2-authorities'
import {
  PROGRESSIVE_RESULTS_VERSION,
} from './workflow-v2-types'
import type {
  AdviceAuthority,
  BasicAuthority,
  ConfirmedCopy,
  ConfirmedDetail,
  ConfirmedPoster,
  CopyInputAuthority,
  ModuleOperationState,
  PosterProjectInput,
  PosterRef,
  ProgressiveResultArtifact,
  ProgressiveResultsExclusion,
  ProgressiveResultsMode,
  ProgressiveResultsSelection,
  WorkflowV2ModuleId,
  WorkflowV2ModuleStatus,
  WorkflowV2ModuleStatusResult,
  WorkflowV2StatusReasonCode,
} from './workflow-v2-types'

export const WORKFLOW_V2_STATUS_MESSAGES: Readonly<
  Record<WorkflowV2StatusReasonCode, string>
> = {
  basic_missing: 'Required Basic information is not available.',
  basic_stale: 'Basic information no longer owns this module input.',
  advice_missing: 'Advice authority is required before this module can run.',
  advice_stale: 'Advice authority belongs to an older Basic input.',
  product_image_missing: 'A byte-identified product image is required.',
  capability_unavailable: 'The required module capability is unavailable.',
  request_in_progress: 'A current module operation is in progress.',
  output_current: 'The confirmed output matches every current owner.',
  output_stale: 'A recoverable output exists under an older input owner.',
  owner_mismatch: 'The artifact combines incompatible authority owners.',
  copy_reference_stale: 'The Poster references a non-current Copy revision.',
  poster_not_confirmed: 'A current confirmed Poster is required.',
  poster_reference_stale: 'The Detail references a non-current Poster revision.',
  operation_failed: 'The latest operation for the current owner failed.',
  inputs_current: 'All required inputs are current.',
}

function status(
  module: WorkflowV2ModuleId,
  state: WorkflowV2ModuleStatus,
  reasonCode: WorkflowV2StatusReasonCode,
  recoverableDraft: boolean,
): WorkflowV2ModuleStatusResult {
  return {
    module,
    status: state,
    reasonCode,
    message: WORKFLOW_V2_STATUS_MESSAGES[reasonCode],
    recoverableDraft,
  }
}

function operationMatches(
  operation: ModuleOperationState,
  ownerInputSignatureSha256: string,
): boolean {
  return operation.kind !== 'idle' &&
    operation.ownerInputSignatureSha256 === ownerInputSignatureSha256
}

function isCopyInputOwnedBy(
  input: CopyInputAuthority,
  basic: BasicAuthority,
  advice: AdviceAuthority,
): boolean {
  return (
    isCopyInputInternallyConsistent(input) &&
    input.basicOwner.textSignatureSha256 === basic.text.signatureSha256 &&
    input.basicOwner.settingsSignatureSha256 ===
      basic.settings.signatureSha256 &&
    input.platform === basic.settings.platform &&
    input.style === basic.settings.style &&
    sameAdviceOwner(input.adviceOwner, adviceOwnerFromAuthority(advice))
  )
}

export interface CopyModuleStatusInput {
  readonly basic: BasicAuthority | null
  readonly basicIsCurrent?: boolean
  readonly advice: AdviceAuthority | null
  readonly input: CopyInputAuthority | null
  readonly confirmedCopy: ConfirmedCopy | null
  readonly recoverableDraftInputSignatureSha256?: string | null
  readonly operation: ModuleOperationState
  readonly capabilityAvailable?: boolean
}

export function selectCopyModuleStatus(
  state: CopyModuleStatusInput,
): WorkflowV2ModuleStatusResult {
  const recoverable = Boolean(
    state.confirmedCopy || state.recoverableDraftInputSignatureSha256,
  )
  if (!state.basic) return status('copy', 'locked', 'basic_missing', recoverable)
  if (
    state.basicIsCurrent === false ||
    !isBasicAuthorityInternallyConsistent(state.basic)
  ) {
    return status('copy', 'locked', 'basic_stale', recoverable)
  }
  if (!state.advice) return status('copy', 'locked', 'advice_missing', recoverable)
  if (!isAdviceCurrentForBasic(state.advice, state.basic)) {
    return recoverable
      ? status('copy', 'stale', 'advice_stale', true)
      : status('copy', 'locked', 'advice_stale', false)
  }
  if (state.capabilityAvailable === false) {
    return status('copy', 'locked', 'capability_unavailable', recoverable)
  }
  if (!state.input || !isCopyInputOwnedBy(state.input, state.basic, state.advice)) {
    return recoverable
      ? status('copy', 'stale', 'owner_mismatch', true)
      : status('copy', 'locked', 'owner_mismatch', false)
  }
  if (
    state.confirmedCopy &&
    !isConfirmedCopyInternallyConsistent(state.confirmedCopy)
  ) return status('copy', 'stale', 'owner_mismatch', true)
  if (operationMatches(state.operation, state.input.inputSignatureSha256)) {
    return state.operation.kind === 'in_progress'
      ? status('copy', 'in_progress', 'request_in_progress', recoverable)
      : status('copy', 'failed', 'operation_failed', recoverable)
  }
  if (state.confirmedCopy) {
    return isConfirmedCopyCurrent(state.confirmedCopy, state.input)
      ? status('copy', 'completed', 'output_current', true)
      : status('copy', 'stale', 'output_stale', true)
  }
  if (
    state.recoverableDraftInputSignatureSha256 &&
    state.recoverableDraftInputSignatureSha256 !==
      state.input.inputSignatureSha256
  ) return status('copy', 'stale', 'output_stale', true)
  return status('copy', 'ready', 'inputs_current', recoverable)
}

export interface PosterModuleStatusInput {
  readonly basic: BasicAuthority | null
  readonly basicIsCurrent?: boolean
  readonly advice: AdviceAuthority | null
  readonly project: PosterProjectInput | null
  readonly currentCopy: ConfirmedCopy | null
  readonly confirmedPoster: ConfirmedPoster | null
  readonly currentPosterRef: PosterRef | null
  readonly recoverableDraftInputSignatureSha256?: string | null
  readonly operation: ModuleOperationState
  readonly capabilityAvailable?: boolean
}

export function selectPosterModuleStatus(
  state: PosterModuleStatusInput,
): WorkflowV2ModuleStatusResult {
  const recoverable = Boolean(
    state.confirmedPoster || state.recoverableDraftInputSignatureSha256,
  )
  if (!state.basic) return status('poster', 'locked', 'basic_missing', recoverable)
  if (
    state.basicIsCurrent === false ||
    !isBasicAuthorityInternallyConsistent(state.basic)
  ) {
    return status('poster', 'locked', 'basic_stale', recoverable)
  }
  if (!state.advice) return status('poster', 'locked', 'advice_missing', recoverable)
  if (!isAdviceCurrentForBasic(state.advice, state.basic)) {
    return recoverable
      ? status('poster', 'stale', 'advice_stale', true)
      : status('poster', 'locked', 'advice_stale', false)
  }
  if (state.basic.productImage.kind !== 'present') {
    return status('poster', 'locked', 'product_image_missing', recoverable)
  }
  if (state.capabilityAvailable === false) {
    return status('poster', 'locked', 'capability_unavailable', recoverable)
  }
  if (!state.project) {
    return recoverable
      ? status('poster', 'stale', 'output_stale', true)
      : status('poster', 'ready', 'inputs_current', false)
  }
  if (!isPosterProjectCurrent(
    state.project,
    state.basic,
    state.advice,
    state.currentCopy,
  )) {
    if (
      state.project.copyRef &&
      (!state.currentCopy ||
        !confirmedCopyMatchesRef(state.currentCopy, state.project.copyRef))
    ) return status('poster', 'stale', 'copy_reference_stale', true)
    return status('poster', 'stale', 'owner_mismatch', recoverable)
  }
  if (
    state.confirmedPoster &&
    !isConfirmedPosterInternallyConsistent(state.confirmedPoster)
  ) return status('poster', 'stale', 'owner_mismatch', true)
  if (operationMatches(state.operation, state.project.inputSignatureSha256)) {
    return state.operation.kind === 'in_progress'
      ? status('poster', 'in_progress', 'request_in_progress', recoverable)
      : status('poster', 'failed', 'operation_failed', recoverable)
  }
  if (state.confirmedPoster) {
    return state.currentPosterRef &&
      confirmedPosterMatchesRef(state.confirmedPoster, state.currentPosterRef) &&
      isConfirmedPosterCurrent(
        state.confirmedPoster,
        state.basic,
        state.advice,
        state.currentCopy,
      )
      ? status('poster', 'completed', 'output_current', true)
      : status('poster', 'stale', 'output_stale', true)
  }
  if (
    state.recoverableDraftInputSignatureSha256 &&
    state.recoverableDraftInputSignatureSha256 !==
      state.project.inputSignatureSha256
  ) return status('poster', 'stale', 'output_stale', true)
  return status('poster', 'ready', 'inputs_current', recoverable)
}

export interface DetailModuleStatusInput {
  readonly currentPoster: ConfirmedPoster | null
  readonly confirmedDetail: ConfirmedDetail | null
  readonly currentDetailOutputSignatureSha256: string | null
  readonly recoverableDraftPosterRef?: PosterRef | null
  readonly operation: ModuleOperationState
  readonly capabilityAvailable?: boolean
}

export function selectDetailModuleStatus(
  state: DetailModuleStatusInput,
): WorkflowV2ModuleStatusResult {
  const recoverable = Boolean(
    state.confirmedDetail || state.recoverableDraftPosterRef,
  )
  if (!state.currentPoster || !isConfirmedPosterInternallyConsistent(state.currentPoster)) {
    return status('detail', 'locked', 'poster_not_confirmed', recoverable)
  }
  if (state.capabilityAvailable === false) {
    return status('detail', 'locked', 'capability_unavailable', recoverable)
  }
  const currentPosterRef = posterRefFromConfirmedPoster(state.currentPoster)
  if (
    state.confirmedDetail &&
    !isConfirmedDetailInternallyConsistent(state.confirmedDetail)
  ) return status('detail', 'stale', 'owner_mismatch', true)
  if (operationMatches(state.operation, currentPosterRef.outputSignatureSha256)) {
    return state.operation.kind === 'in_progress'
      ? status('detail', 'in_progress', 'request_in_progress', recoverable)
      : status('detail', 'failed', 'operation_failed', recoverable)
  }
  if (state.confirmedDetail) {
    return samePosterRef(
      state.confirmedDetail.owner.posterRef,
      currentPosterRef,
    ) &&
      state.currentDetailOutputSignatureSha256 ===
        state.confirmedDetail.outputSignatureSha256
      ? status('detail', 'completed', 'output_current', true)
      : status(
          'detail',
          'stale',
          samePosterRef(
            state.confirmedDetail.owner.posterRef,
            currentPosterRef,
          )
            ? 'output_stale'
            : 'poster_reference_stale',
          true,
        )
  }
  if (
    state.recoverableDraftPosterRef &&
    !samePosterRef(state.recoverableDraftPosterRef, currentPosterRef)
  ) return status('detail', 'stale', 'poster_reference_stale', true)
  return status('detail', 'ready', 'inputs_current', recoverable)
}

export interface ProgressiveResultsInput {
  readonly basic: BasicAuthority | null
  readonly advice: AdviceAuthority | null
  readonly confirmedCopy: ConfirmedCopy | null
  readonly confirmedPosters: readonly ConfirmedPoster[]
  readonly currentPosterRefs: readonly PosterRef[]
  readonly confirmedDetails: readonly ConfirmedDetail[]
  readonly currentDetailOutputSignatureSha256: readonly string[]
}

function progressiveMode(
  hasCopy: boolean,
  hasPoster: boolean,
  hasDetail: boolean,
): ProgressiveResultsMode {
  if (!hasPoster) return hasCopy ? 'copy_only' : 'none'
  if (!hasDetail) return hasCopy ? 'copy_and_poster' : 'poster_only'
  return hasCopy ? 'all_current' : 'poster_and_detail'
}

export function selectProgressiveResults(
  state: ProgressiveResultsInput,
): ProgressiveResultsSelection {
  const exclusions: ProgressiveResultsExclusion[] = []
  const authoritiesCurrent = Boolean(
    state.basic &&
      state.advice &&
      isBasicAuthorityInternallyConsistent(state.basic) &&
      isAdviceCurrentForBasic(state.advice, state.basic),
  )
  const copyInternallyValid = Boolean(
    state.confirmedCopy &&
      isConfirmedCopyInternallyConsistent(state.confirmedCopy),
  )
  const copyCurrent = Boolean(
    authoritiesCurrent &&
      copyInternallyValid &&
      state.confirmedCopy &&
      state.basic &&
      state.advice &&
      isCopyInputOwnedBy(
        state.confirmedCopy.input,
        state.basic,
        state.advice,
      ),
  )
  if (state.confirmedCopy && !copyCurrent) {
    exclusions.push({
      kind: 'promotional_copy',
      id: state.confirmedCopy.outputSignatureSha256,
      reason: copyInternallyValid ? 'stale' : 'mixed_owner',
    })
  }
  const promotionalCopy = copyCurrent && state.confirmedCopy
    ? {
        kind: 'promotional_copy' as const,
        label: 'Promotional Copy' as const,
        copyRef: copyRefFromConfirmedCopy(state.confirmedCopy),
        fields: {
          body: state.confirmedCopy.body,
          title: state.confirmedCopy.title,
          headline: state.confirmedCopy.headline,
          subline: state.confirmedCopy.subline,
        },
        artifactIdentitySha256:
          state.confirmedCopy.resultArtifactSignatureSha256,
      }
    : null

  const eligiblePosters: ConfirmedPoster[] = []
  for (const poster of state.confirmedPosters) {
    const internallyValid = isConfirmedPosterInternallyConsistent(poster)
    const current = Boolean(
      authoritiesCurrent &&
        internallyValid &&
        state.currentPosterRefs.some((posterRef) =>
          confirmedPosterMatchesRef(poster, posterRef),
        ) &&
        state.basic &&
        state.advice &&
        isConfirmedPosterCurrent(
          poster,
          state.basic,
          state.advice,
          copyCurrent ? state.confirmedCopy : null,
        ),
    )
    if (current) eligiblePosters.push(poster)
    else {
      exclusions.push({
        kind: 'poster',
        id: poster.project.projectId,
        reason: internallyValid ? 'stale' : 'mixed_owner',
      })
    }
  }

  const posters = eligiblePosters.map((poster) => ({
    kind: 'poster' as const,
    label: 'Confirmed Poster' as const,
    posterRef: posterRefFromConfirmedPoster(poster),
    artifactIdentitySha256: poster.resultArtifactSignatureSha256,
  }))
  const posterCopySnapshots = eligiblePosters.map((poster) => ({
    kind: 'poster_copy_snapshot' as const,
    label: 'Poster Frozen Copy Snapshot' as const,
    posterRef: posterRefFromConfirmedPoster(poster),
    fields: {
      body: poster.copySnapshot.body,
      title: poster.copySnapshot.title,
      headline: poster.copySnapshot.headline,
      subline: poster.copySnapshot.subline,
    },
    artifactIdentitySha256: poster.copySnapshot.snapshotSignatureSha256,
  }))

  const details = state.confirmedDetails.flatMap((detail) => {
    const internallyValid = isConfirmedDetailInternallyConsistent(detail)
    const poster = eligiblePosters.find((candidate) =>
      confirmedPosterMatchesRef(candidate, detail.owner.posterRef),
    )
    const outputCurrent = state.currentDetailOutputSignatureSha256.includes(
      detail.outputSignatureSha256,
    )
    if (!internallyValid || !poster || !outputCurrent) {
      const referencesKnownProject = state.confirmedPosters.some(
        (candidate) =>
          candidate.project.projectId === detail.owner.posterRef.projectId &&
          candidate.project.projectIdentitySha256 ===
            detail.owner.posterRef.projectIdentitySha256,
      )
      exclusions.push({
        kind: 'detail',
        id: detail.detailId,
        reason:
          internallyValid && referencesKnownProject
            ? 'stale'
            : 'mixed_owner',
      })
      return []
    }
    return [{
      kind: 'detail' as const,
      label: 'Confirmed Detail' as const,
      detailId: detail.detailId,
      posterRef: detail.owner.posterRef,
      artifactIdentitySha256: detail.resultArtifactSignatureSha256,
    }]
  })

  const artifacts: ProgressiveResultArtifact[] = [
    ...(promotionalCopy ? [promotionalCopy] : []),
    ...posters,
    ...posterCopySnapshots,
    ...details,
  ]
  return {
    version: PROGRESSIVE_RESULTS_VERSION,
    mode: progressiveMode(
      promotionalCopy !== null,
      posters.length > 0,
      details.length > 0,
    ),
    promotionalCopy,
    posters,
    posterCopySnapshots,
    details,
    artifacts,
    exclusions,
  }
}

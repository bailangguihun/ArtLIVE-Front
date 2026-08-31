import { validateProductInfo } from '../features/product-info/validation'
import { getPlatformCopyValidationError } from '../features/platform-copy/validation'
import { PRODUCT_INFO_LIMITS } from '../types/product-info'
import {
  createInitialPosterGenerationState,
  emptyBinaryResourceState,
} from '../types/poster-generation'
import { createInitialPosterEditorState } from '../types/poster-editor'
import type { PosterEditorState } from '../types/poster-editor'
import { createInitialDetailEditorState } from '../types/detail-editor'
import type { DetailOwnerIdentity, DetailResource } from '../types/detail-editor'
import { createInitialMarketingStrategyStepState } from '../types/marketing-strategy'
import {
  createInitialDetailEditor,
  sameDetailOwner,
} from '../features/detail-editor/detail-defaults'
import {
  normalizeCompletePosterLayout,
  sameNormalizedLayout,
} from '../features/poster-editor/poster-signature'
import type { CopyVariant } from '../types/platform-copy'
import type {
  NormalizedSequenceResult,
  PosterBinaryState,
} from '../types/poster-generation'
import {
  isEligibleReadySlot,
  isTerminalSequenceStatus,
} from '../features/poster-generation/poster-normalizer'
import {
  completionFromStep6View,
  isCurrentStep6Completion,
  selectStep6ViewModel,
} from '../features/marketing-strategy/marketing-strategy-model'
import { selectFinalResultsViewModel } from '../features/final-results/final-results-model'
import { selectProgressiveResults } from './workflow-v2/workflow-v2-selectors'
import type {
  WorkflowAction,
  WorkflowState,
  WorkflowStepId,
} from './workflow-types'
import {
  bumpBasicDraftRevision,
  bumpCopyDraftRevision,
  createActiveWorkflowV2Session,
  createInitialWorkflowV2Session,
} from './workflow-v2/workflow-v2-session'
import {
  adviceOwnerFromAuthority,
  createCopyInputAuthoritySync,
  isAdviceCurrentForBasic,
  isConfirmedCopyInternallyConsistent,
  isConfirmedDetailInternallyConsistent,
  isConfirmedPosterCurrent,
  isConfirmedPosterInternallyConsistent,
  isDetailProjectInternallyConsistent,
  isPosterProjectCurrent,
  posterRefFromConfirmedPoster,
  sameAdviceOwner,
  samePosterRef,
} from './workflow-v2/workflow-v2-authorities'
import type { PendingCopyRequest } from './workflow-v2/workflow-v2-session'

export function createInitialWorkflowState(): WorkflowState {
  const values = {
    productInfo: '',
    productShortName: '',
    creativeNote: '',
  }

  return {
    currentStep: 1,
    completedSteps: new Set<WorkflowStepId>(),
    productInfo: {
      values,
      productImage: null,
      errors: validateProductInfo(values),
      completedDraft: null,
    },
    platformCopy: {
      platform: 'xiaohongshu',
      style: 'premium',
      copyDraft: '',
      platformCopy: null,
      variants: [],
      selectedVariantIndex: null,
      generationPlatform: null,
      generationStyle: null,
      marketingStrategy: {},
      strategyOwner: null,
      copyGenerationError: '',
      requestBusy: false,
      pendingCopyFingerprint: null,
      pendingIdempotencyKey: null,
      completedDraft: null,
    },
    posterGeneration: createInitialPosterGenerationState(),
    posterEditor: createInitialPosterEditorState(),
    detailEditor: createInitialDetailEditorState(),
    marketingStrategyStep: createInitialMarketingStrategyStepState(),
    workflowV2: createInitialWorkflowV2Session(),
  }
}

function withBumpedBasicDraft(state: WorkflowState): WorkflowState {
  return { ...state, workflowV2: bumpBasicDraftRevision(state.workflowV2) }
}

function withBumpedCopyDraft(state: WorkflowState): WorkflowState {
  return { ...state, workflowV2: bumpCopyDraftRevision(state.workflowV2) }
}

function copyPendingMatches(
  state: WorkflowState,
  pending: PendingCopyRequest,
  requirePending = true,
): boolean {
  const session = state.workflowV2
  const basic = session.basicAuthority
  const advice = session.adviceAuthority
  if (
    session.phase !== 'active' ||
    !basic ||
    !advice ||
    !isAdviceCurrentForBasic(advice, basic) ||
    session.epoch !== pending.workflowEpoch ||
    session.basicDraftRevision !== pending.basicDraftRevision ||
    session.copyDraftRevision !== pending.copyDraftRevision ||
    basic.text.signatureSha256 !== pending.basicTextSignatureSha256 ||
    basic.settings.signatureSha256 !== pending.basicSettingsSignatureSha256 ||
    advice.inputSignatureSha256 !== pending.adviceInputSignatureSha256 ||
    advice.adviceSignatureSha256 !== pending.adviceSignatureSha256
  ) return false
  const input = createCopyInputAuthoritySync(basic, advice)
  if (input.inputSignatureSha256 !== pending.expectedCopyInputSignatureSha256) {
    return false
  }
  const active = session.pendingCopyRequest
  return !requirePending || Boolean(
    active &&
      active.requestId === pending.requestId &&
      active.fingerprintSha256 === pending.fingerprintSha256 &&
      active.idempotencyKey === pending.idempotencyKey,
  )
}

function confirmedCopyMatchesCurrentOwners(state: WorkflowState): boolean {
  const session = state.workflowV2
  const basic = session.basicAuthority
  const advice = session.adviceAuthority
  const copy = session.confirmedCopy
  return Boolean(
    basic &&
      advice &&
      copy &&
      isAdviceCurrentForBasic(advice, basic) &&
      isConfirmedCopyInternallyConsistent(copy) &&
      copy.input.basicOwner.textSignatureSha256 === basic.text.signatureSha256 &&
      copy.input.basicOwner.settingsSignatureSha256 === basic.settings.signatureSha256 &&
      copy.platform === basic.settings.platform &&
      copy.style === basic.settings.style &&
      sameAdviceOwner(copy.input.adviceOwner, adviceOwnerFromAuthority(advice)),
  )
}

function currentV2PosterRef(state: WorkflowState) {
  const session = state.workflowV2
  const basic = session.basicAuthority
  const advice = session.adviceAuthority
  const poster = session.confirmedPoster
  if (
    session.phase !== 'active' ||
    !basic ||
    !advice ||
    !poster ||
    !isAdviceCurrentForBasic(advice, basic) ||
    !isConfirmedPosterInternallyConsistent(poster) ||
    !isConfirmedPosterCurrent(
      poster,
      basic,
      advice,
      poster.project.copyRef ? session.confirmedCopy : null,
    )
  ) return null
  return posterRefFromConfirmedPoster(poster)
}

function hasCurrentProgressiveResults(state: WorkflowState): boolean {
  const session = state.workflowV2
  if (session.phase !== 'active') return false
  const poster = session.confirmedPoster
  const detail = session.confirmedDetail
  return selectProgressiveResults({
    basic: session.basicAuthority,
    advice: session.adviceAuthority,
    confirmedCopy: session.confirmedCopy,
    confirmedPosters: poster ? [poster] : [],
    currentPosterRefs: poster ? [posterRefFromConfirmedPoster(poster)] : [],
    confirmedDetails: detail ? [detail] : [],
    currentDetailOutputSignatureSha256:
      detail && session.currentDetailOutputSignatureSha256 === detail.outputSignatureSha256
        ? [detail.outputSignatureSha256]
        : [],
  }).mode !== 'none'
}

function legacyDetailEntryMatchesV2Poster(
  state: WorkflowState,
  legacyOwner: DetailOwnerIdentity,
  posterResource: DetailResource,
): boolean {
  const ref = currentV2PosterRef(state)
  const legacy = state.posterEditor.confirmedPoster
  return Boolean(
    ref &&
      legacy &&
      isCurrentStepFourConfirmation(state.posterEditor) &&
      legacyOwner.generationId === ref.generationId &&
      legacyOwner.posterId === ref.posterId &&
      legacyOwner.inputSignatureSha256 === ref.compositionInputSignatureSha256 &&
      legacyOwner.pngBlobSha256 === ref.pngBlobSha256 &&
      posterResource.id === 'poster-final' &&
      posterResource.kind === 'poster-final' &&
      posterResource.mimeType === 'image/png' &&
      posterResource.sha256 === ref.pngBlobSha256 &&
      posterResource.blob === legacy.pngBlob &&
      legacy.generationId === ref.generationId &&
      legacy.posterId === ref.posterId &&
      legacy.inputSignatureSha256 === ref.compositionInputSignatureSha256 &&
      legacy.pngBlobSha256 === ref.pngBlobSha256,
  )
}

function invalidatePosterEditorUpstream(
  editor: PosterEditorState,
): PosterEditorState {
  if (!editor.active && !editor.confirmedPoster && !editor.completion) {
    return editor
  }
  return {
    ...editor,
    compositionRevision: editor.compositionRevision + 1,
    currentLayoutSha256: null,
    completion: null,
  }
}

function invalidateCompletionFromStep(
  state: WorkflowState,
  firstAffectedStep: WorkflowStepId,
): WorkflowState {
  const completedSteps = new Set(
    [...state.completedSteps].filter((step) => step < firstAffectedStep),
  )

  // Completion is invalidated centrally. Existing copy results deliberately
  // remain intact to match the active frontend contract.
  return {
    ...state,
    completedSteps,
    productInfo:
      firstAffectedStep <= 1
        ? { ...state.productInfo, completedDraft: null }
        : state.productInfo,
    platformCopy:
      firstAffectedStep <= 2
        ? { ...state.platformCopy, completedDraft: null }
        : state.platformCopy,
    posterGeneration:
      firstAffectedStep <= 3
        ? { ...state.posterGeneration, completedDraft: null }
        : state.posterGeneration,
    posterEditor:
      firstAffectedStep <= 2
        ? invalidatePosterEditorUpstream(state.posterEditor)
        : state.posterEditor,
    marketingStrategyStep:
      firstAffectedStep <= 6
        ? createInitialMarketingStrategyStepState()
        : state.marketingStrategyStep,
  }
}

function selectedVariant(
  variants: CopyVariant[],
  index: number | null,
): CopyVariant | null {
  if (index === null || index < 0 || index >= variants.length) {
    return null
  }
  return variants[index]
}

function withoutCompletedStep(
  steps: ReadonlySet<WorkflowStepId>,
  firstAffectedStep: WorkflowStepId,
) {
  return new Set([...steps].filter((step) => step < firstAffectedStep))
}

function posterBinary(
  state: WorkflowState,
  posterId: string,
): PosterBinaryState {
  return (
    state.posterGeneration.posterBinaries[posterId] ?? {
      preview: emptyBinaryResourceState(),
      download: emptyBinaryResourceState(),
    }
  )
}

function clearActivePosterIdentity(editor: PosterEditorState): PosterEditorState {
  if (!editor.active && !editor.confirmedPoster && !editor.completion) {
    return editor
  }
  const resources = { ...editor.resources }
  if (editor.active) {
    delete resources[editor.active.baseBlobId]
  }
  return {
    ...editor,
    active: null,
    resources,
    compositionRevision: editor.compositionRevision + 1,
    resourceRevision: editor.resourceRevision + 1,
    currentLayoutSha256: null,
    confirmedPoster: null,
    completion: null,
    operations: {
      ...editor.operations,
      entryBusy: false,
      confirmationBusy: false,
      exportBusy: false,
      entryError: '',
      confirmationError: '',
      exportError: '',
    },
  }
}

function posterEditorDraftKey(active: PosterEditorState['active']): string | null {
  return active ? active.draftKey ?? active.generationId : null
}

function applyPosterResult(
  state: WorkflowState,
  result: NormalizedSequenceResult,
  source: 'admission' | 'poll',
  fingerprint?: string,
): WorkflowState {
  const terminal = isTerminalSequenceStatus(result.status)
  const selectedIndex = state.posterGeneration.selectedIndex
  const selectedPosterId = state.posterGeneration.selectedPosterId
  const selectedSlot =
    selectedIndex === null ? null : result.posters[selectedIndex] ?? null
  const selectionStillEligible =
    isEligibleReadySlot(selectedSlot) &&
    selectedSlot.posterId === selectedPosterId &&
    state.posterGeneration.result?.generationId === result.generationId
  const completedDraft = selectionStillEligible
    ? state.posterGeneration.completedDraft
    : null
  const completedSteps = completedDraft
    ? new Set(state.completedSteps)
    : withoutCompletedStep(state.completedSteps, 3)
  const selectedResourceChanged = Boolean(
    state.posterGeneration.selectedSlot &&
      selectedSlot &&
      (state.posterGeneration.selectedSlot.posterId !== selectedSlot.posterId ||
        state.posterGeneration.selectedSlot.status !== selectedSlot.status ||
        state.posterGeneration.selectedSlot.downloadUrl !== selectedSlot.downloadUrl),
  )
  const generationChanged = Boolean(
    state.posterGeneration.result &&
      state.posterGeneration.result.generationId !== result.generationId,
  )
  const selectionChanged =
    state.posterGeneration.selectedIndex !== (selectionStillEligible ? selectedIndex : null) ||
    state.posterGeneration.selectedPosterId !==
      (selectionStillEligible ? selectedPosterId : null)
  let posterEditor = state.posterEditor
  let detailEditor = state.detailEditor
  if (
    posterEditor.active &&
    (posterEditor.active.generationId !== result.generationId ||
      !selectionStillEligible ||
      posterEditor.active.posterId !== selectedPosterId)
  ) {
    posterEditor = clearActivePosterIdentity(posterEditor)
    detailEditor = createInitialDetailEditorState()
  }

  return {
    ...state,
    completedSteps,
    posterEditor,
    detailEditor,
    posterGeneration: {
      ...state.posterGeneration,
      result,
      resultIntentFingerprint:
        source === 'admission'
          ? fingerprint ?? state.posterGeneration.pendingFingerprint
          : state.posterGeneration.resultIntentFingerprint,
      activeGenerationId: result.generationId,
      pendingFingerprint: terminal
        ? null
        : state.posterGeneration.pendingFingerprint,
      pendingIdempotencyKey: terminal
        ? null
        : state.posterGeneration.pendingIdempotencyKey,
      pendingIntentPhase: terminal ? null : 'accepted',
      selectedIndex: selectionStillEligible ? selectedIndex : null,
      selectedPosterId: selectionStillEligible ? selectedPosterId : null,
      selectedSlot: selectionStillEligible ? selectedSlot : null,
      completedDraft,
      selectionRevision:
        state.posterGeneration.selectionRevision + (selectionChanged ? 1 : 0),
      resourceRevision:
        state.posterGeneration.resourceRevision +
        (generationChanged || selectedResourceChanged ? 1 : 0),
      succeededOnce:
        state.posterGeneration.succeededOnce || result.status === 'completed',
      errors: {
        admission:
          source === 'admission' ? '' : state.posterGeneration.errors.admission,
        polling: '',
      },
    },
  }
}

export function isCurrentStepFourConfirmation(editor: PosterEditorState) {
  const active = editor.active
  const confirmed = editor.confirmedPoster
  return Boolean(
    active &&
      confirmed &&
      editor.currentLayoutSha256 &&
      confirmed.generationId === active.generationId &&
      confirmed.posterId === active.posterId &&
      confirmed.slot === active.slot &&
      confirmed.baseBlobSha256 === active.baseBlobSha256 &&
      confirmed.upstreamSha256 === active.upstreamSha256 &&
      confirmed.layoutSha256 === editor.currentLayoutSha256 &&
      confirmed.confirmedRevision === editor.compositionRevision,
  )
}

function reduceWorkflowState(
  state: WorkflowState,
  action: WorkflowAction,
): WorkflowState {
  switch (action.type) {
    case 'UPDATE_STEP_ONE_FIELD': {
      const value = action.value.slice(0, PRODUCT_INFO_LIMITS[action.field])
      if (state.productInfo.values[action.field] === value) {
        return state
      }

      const invalidatedState = invalidateCompletionFromStep(state, 1)
      const values = {
        ...invalidatedState.productInfo.values,
        [action.field]: value,
      }

      return withBumpedBasicDraft({
        ...invalidatedState,
        productInfo: {
          ...invalidatedState.productInfo,
          values,
          errors: validateProductInfo(values),
        },
      })
    }

    case 'UPDATE_CREATIVE_NOTE': {
      // Poster-local creative direction only. Do not invalidate Basic/Advice.
      const value = action.value.slice(0, PRODUCT_INFO_LIMITS.creativeNote)
      if (state.productInfo.values.creativeNote === value) {
        return state
      }
      return {
        ...state,
        productInfo: {
          ...state.productInfo,
          values: {
            ...state.productInfo.values,
            creativeNote: value,
          },
          completedDraft: state.productInfo.completedDraft
            ? {
                ...state.productInfo.completedDraft,
                creativeNote: value,
              }
            : null,
        },
      }
    }

    case 'REPLACE_STEP_ONE_IMAGE': {
      const invalidatedState = invalidateCompletionFromStep(state, 1)
      return withBumpedBasicDraft({
        ...invalidatedState,
        // Product-image bytes are intentionally outside the Copy authority.
        // Keep the frozen confirmed-copy adapter so only downstream Poster
        // work becomes stale; the V2 selectors still reject stale Posters.
        platformCopy:
          state.workflowV2.phase === 'active'
            ? {
                ...invalidatedState.platformCopy,
                completedDraft: state.platformCopy.completedDraft,
              }
            : invalidatedState.platformCopy,
        productInfo: {
          ...invalidatedState.productInfo,
          productImage: action.image,
        },
      })
    }

    case 'REMOVE_STEP_ONE_IMAGE': {
      if (!state.productInfo.productImage) {
        return state
      }

      const invalidatedState = invalidateCompletionFromStep(state, 1)
      return withBumpedBasicDraft({
        ...invalidatedState,
        platformCopy:
          state.workflowV2.phase === 'active'
            ? {
                ...invalidatedState.platformCopy,
                completedDraft: state.platformCopy.completedDraft,
              }
            : invalidatedState.platformCopy,
        productInfo: {
          ...invalidatedState.productInfo,
          productImage: null,
        },
      })
    }

    case 'VALIDATE_STEP_ONE': {
      return {
        ...state,
        productInfo: {
          ...state.productInfo,
          errors: validateProductInfo(state.productInfo.values),
        },
      }
    }

    case 'COMPLETE_STEP_ONE': {
      const errors = validateProductInfo(state.productInfo.values)
      if (Object.keys(errors).length > 0) {
        return {
          ...state,
          productInfo: { ...state.productInfo, errors },
        }
      }

      const completedSteps = new Set(state.completedSteps)
      completedSteps.add(1)

      return {
        ...state,
        currentStep: 2,
        completedSteps,
        productInfo: {
          ...state.productInfo,
          errors,
          completedDraft: {
            ...state.productInfo.values,
            productImage: state.productInfo.productImage,
          },
        },
      }
    }

    case 'GO_TO_STEP_ONE': {
      if (state.platformCopy.requestBusy) {
        return state
      }
      return {
        ...state,
        currentStep: 1,
        workflowV2:
          state.workflowV2.phase === 'active'
            ? {
                ...state.workflowV2,
                view: 'workflow',
                resumeView: 'workflow',
                pendingAdviceRequest: null,
              }
            : state.workflowV2,
      }
    }

    case 'UPDATE_STEP_TWO_PLATFORM': {
      if (
        state.platformCopy.requestBusy ||
        state.platformCopy.platform === action.platform
      ) {
        return state
      }
      const invalidatedState = invalidateCompletionFromStep(state, 2)
      return withBumpedBasicDraft({
        ...invalidatedState,
        platformCopy: {
          ...invalidatedState.platformCopy,
          platform: action.platform,
        },
      })
    }

    case 'UPDATE_STEP_TWO_STYLE': {
      if (
        state.platformCopy.requestBusy ||
        state.platformCopy.style === action.style
      ) {
        return state
      }
      const invalidatedState = invalidateCompletionFromStep(state, 2)
      return withBumpedBasicDraft({
        ...invalidatedState,
        platformCopy: {
          ...invalidatedState.platformCopy,
          style: action.style,
        },
      })
    }

    case 'UPDATE_STEP_TWO_DRAFT': {
      const value = action.value.slice(0, 5000)
      if (state.platformCopy.copyDraft === value) {
        return state
      }
      // A V2 edit is a recoverable draft change. The independently confirmed
      // copy and its frozen legacy Poster adapter must remain untouched.
      const invalidatedState = state.workflowV2.phase === 'active'
        ? state
        : invalidateCompletionFromStep(state, 2)
      const base = selectedVariant(
        invalidatedState.platformCopy.variants,
        invalidatedState.platformCopy.selectedVariantIndex,
      )
      const next = {
        ...invalidatedState,
        platformCopy: {
          ...invalidatedState.platformCopy,
          copyDraft: value,
          platformCopy: base ? { ...base, body: value } : null,
        },
      }
      return state.workflowV2.phase === 'active'
        ? withBumpedCopyDraft(next)
        : next
    }

    case 'SELECT_STEP_TWO_VARIANT': {
      const variant = selectedVariant(state.platformCopy.variants, action.index)
      if (!variant) {
        return state
      }
      const invalidatedState = state.workflowV2.phase === 'active'
        ? state
        : invalidateCompletionFromStep(state, 2)
      const next = {
        ...invalidatedState,
        platformCopy: {
          ...invalidatedState.platformCopy,
          selectedVariantIndex: action.index,
          copyDraft: variant.body,
          platformCopy: { ...variant, body: variant.body },
        },
      }
      return state.workflowV2.phase === 'active'
        ? withBumpedCopyDraft(next)
        : next
    }

    case 'SET_COPY_GENERATION_ERROR': {
      if (state.platformCopy.requestBusy) {
        return state
      }
      return {
        ...state,
        platformCopy: {
          ...state.platformCopy,
          copyGenerationError: action.error,
        },
      }
    }

    case 'BEGIN_COPY_GENERATION': {
      if (state.platformCopy.requestBusy) {
        return state
      }
      return {
        ...state,
        platformCopy: {
          ...state.platformCopy,
          copyGenerationError: '',
          requestBusy: true,
          pendingCopyFingerprint: action.fingerprint,
          pendingIdempotencyKey: action.idempotencyKey,
        },
      }
    }

    case 'COPY_GENERATION_SUCCEEDED': {
      if (
        state.platformCopy.pendingCopyFingerprint !== action.fingerprint ||
        state.platformCopy.pendingIdempotencyKey !== action.idempotencyKey ||
        action.variants.length === 0
      ) {
        return state
      }
      const variants = action.variants.slice(0, 3)
      const first = variants[0]
      const invalidatedState = invalidateCompletionFromStep(state, 2)
      return {
        ...invalidatedState,
        platformCopy: {
          ...invalidatedState.platformCopy,
          variants,
          selectedVariantIndex: 0,
          copyDraft: first.body,
          platformCopy: { ...first, body: first.body },
          generationPlatform: action.generationPlatform,
          generationStyle: action.generationStyle,
          marketingStrategy: { ...action.marketingStrategy },
          strategyOwner: {
            sourceKind: 'copy',
            intentFingerprint: action.fingerprint,
            idempotencyKey: action.idempotencyKey,
            requestId: action.requestId,
            platform: action.generationPlatform,
            style: action.generationStyle,
          },
          copyGenerationError: '',
          pendingCopyFingerprint: null,
          pendingIdempotencyKey: null,
        },
      }
    }

    case 'COPY_GENERATION_FAILED': {
      if (
        state.platformCopy.pendingCopyFingerprint !== action.fingerprint ||
        state.platformCopy.pendingIdempotencyKey !== action.idempotencyKey
      ) {
        return state
      }
      return {
        ...state,
        platformCopy: {
          ...state.platformCopy,
          copyGenerationError: action.error,
        },
      }
    }

    case 'END_COPY_GENERATION': {
      if (!state.platformCopy.requestBusy) {
        return state
      }
      return {
        ...state,
        platformCopy: { ...state.platformCopy, requestBusy: false },
      }
    }

    case 'COMPLETE_STEP_TWO': {
      if (
        state.platformCopy.requestBusy ||
        getPlatformCopyValidationError(state.platformCopy)
      ) {
        return state
      }
      const index = state.platformCopy.selectedVariantIndex
      const variant = selectedVariant(state.platformCopy.variants, index)
      const generationPlatform = state.platformCopy.generationPlatform
      const generationStyle = state.platformCopy.generationStyle
      const strategyOwner = state.platformCopy.strategyOwner
      if (
        index === null ||
        !variant ||
        !generationPlatform ||
        !generationStyle ||
        !strategyOwner
      ) {
        return state
      }

      const platformCopy = {
        ...variant,
        body: state.platformCopy.copyDraft,
      }
      const completedSteps = new Set(state.completedSteps)
      completedSteps.add(2)

      return {
        ...state,
        currentStep: 3,
        completedSteps,
        platformCopy: {
          ...state.platformCopy,
          platformCopy,
          completedDraft: {
            platform: state.platformCopy.platform,
            style: state.platformCopy.style,
            copyDraft: state.platformCopy.copyDraft,
            platformCopy,
            variants: state.platformCopy.variants.map((item) => ({ ...item })),
            selectedVariantIndex: index,
            generationPlatform,
            generationStyle,
            marketingStrategy: { ...state.platformCopy.marketingStrategy },
            strategyOwner: { ...strategyOwner },
          },
        },
      }
    }

    case 'GO_TO_STEP_TWO':
      return {
        ...state,
        currentStep: 2,
        posterEditor: {
          ...state.posterEditor,
          operations: {
            ...state.posterEditor.operations,
            entryBusy: false,
            entryError: '',
          },
        },
      }

    case 'SET_POSTER_CONSENT':
      return {
        ...state,
        posterGeneration: {
          ...state.posterGeneration,
          consent: action.consent,
        },
      }

    case 'BEGIN_POSTER_CAPABILITIES':
      return {
        ...state,
        posterGeneration: {
          ...state.posterGeneration,
          capabilities: {
            ...state.posterGeneration.capabilities,
            status: 'loading',
            error: '',
          },
        },
      }

    case 'POSTER_CAPABILITIES_SUCCEEDED':
      return {
        ...state,
        posterGeneration: {
          ...state.posterGeneration,
          capabilities: {
            status: 'ready',
            sequenceEnabled: action.sequenceEnabled,
            seedreamConfigured: action.seedreamConfigured,
            error: '',
          },
        },
      }

    case 'POSTER_CAPABILITIES_FAILED':
      return {
        ...state,
        posterGeneration: {
          ...state.posterGeneration,
          capabilities: {
            ...state.posterGeneration.capabilities,
            status: 'error',
            error: action.error,
          },
        },
      }

    case 'SET_POSTER_ADMISSION_ERROR':
      return {
        ...state,
        posterGeneration: {
          ...state.posterGeneration,
          errors: {
            ...state.posterGeneration.errors,
            admission: action.error,
          },
        },
      }

    case 'BEGIN_POSTER_ADMISSION':
      return {
        ...state,
        completedSteps: withoutCompletedStep(state.completedSteps, 3),
        posterEditor: state.posterEditor.completion
          ? { ...state.posterEditor, completion: null }
          : state.posterEditor,
        posterGeneration: {
          ...state.posterGeneration,
          admissionBusy: true,
          errors: { admission: '', polling: '' },
          pendingIntentPhase: 'hashing',
          selectedIndex: null,
          selectedPosterId: null,
          selectedSlot: null,
          completedDraft: null,
          selectionRevision: state.posterGeneration.selectionRevision + 1,
        },
      }

    case 'SET_PENDING_POSTER_INTENT':
      return {
        ...state,
        posterGeneration: {
          ...state.posterGeneration,
          pendingFingerprint: action.fingerprint,
          pendingIdempotencyKey: action.idempotencyKey,
          pendingIntentPhase: 'submitting',
        },
      }

    case 'POSTER_ADMISSION_FAILED':
      return {
        ...state,
        posterGeneration: {
          ...state.posterGeneration,
          pendingIntentPhase: action.ambiguous ? 'ambiguous' : 'rejected',
          errors: {
            ...state.posterGeneration.errors,
            admission: action.error,
          },
        },
      }

    case 'END_POSTER_ADMISSION':
      return {
        ...state,
        posterGeneration: {
          ...state.posterGeneration,
          admissionBusy: false,
        },
      }

    case 'CANCEL_PENDING_POSTER_WORK': {
      const generation = state.posterGeneration
      const hasPendingWork = generation.admissionBusy || Boolean(
        generation.activeGenerationId &&
          generation.result &&
          generation.result.generationId === generation.activeGenerationId &&
          !isTerminalSequenceStatus(generation.result.status),
      )
      if (!hasPendingWork) return state
      const cleared = createInitialPosterGenerationState()
      return {
        ...state,
        completedSteps: withoutCompletedStep(state.completedSteps, 3),
        posterGeneration: {
          ...cleared,
          // Capability and consent are harmless editable setup choices. The
          // discarded request/result, selection, binary resources and intent
          // data are deliberately not retained across the route exit.
          consent: generation.consent,
          capabilities: generation.capabilities,
          selectionRevision: generation.selectionRevision + 1,
          resourceRevision: generation.resourceRevision + 1,
        },
      }
    }

    case 'APPLY_POSTER_RESULT':
      return applyPosterResult(
        state,
        action.result,
        action.source,
        action.fingerprint,
      )

    case 'SET_POSTER_POLL_ERROR':
      return {
        ...state,
        posterGeneration: {
          ...state.posterGeneration,
          errors: {
            ...state.posterGeneration.errors,
            polling: action.error,
          },
        },
      }

    case 'SELECT_POSTER_SLOT': {
      const result = state.posterGeneration.result
      const slot = result?.posters[action.index] ?? null
      if (!result || !isEligibleReadySlot(slot)) {
        return state
      }
      const posterChanged =
        state.posterGeneration.selectedPosterId !== slot.posterId
      return {
        ...state,
        completedSteps: withoutCompletedStep(state.completedSteps, 3),
        posterEditor: posterChanged
          ? clearActivePosterIdentity(state.posterEditor)
          : state.posterEditor,
        detailEditor: posterChanged
          ? createInitialDetailEditorState()
          : state.detailEditor,
        posterGeneration: {
          ...state.posterGeneration,
          selectedIndex: action.index,
          selectedPosterId: slot.posterId,
          selectedSlot: { ...slot },
          completedDraft: null,
          selectionRevision:
            state.posterGeneration.selectionRevision + (posterChanged ? 1 : 0),
        },
      }
    }

    case 'COMPLETE_STEP_THREE': {
      const result = state.posterGeneration.result
      const index = state.posterGeneration.selectedIndex
      const slot = index === null ? null : result?.posters[index] ?? null
      if (!result || index === null || !isEligibleReadySlot(slot)) {
        return state
      }
      if (slot.posterId !== state.posterGeneration.selectedPosterId) {
        return state
      }
      const completedSteps = new Set(state.completedSteps)
      completedSteps.add(3)
      return {
        ...state,
        currentStep: 3,
        completedSteps,
        posterGeneration: {
          ...state.posterGeneration,
          selectedSlot: { ...slot },
          completedDraft: {
            generationId: result.generationId,
            selectedIndex: index,
            posterId: slot.posterId,
            selectedSlot: { ...slot },
          },
        },
      }
    }

    case 'BEGIN_POSTER_BINARY': {
      const current = posterBinary(state, action.posterId)
      return {
        ...state,
        posterGeneration: {
          ...state.posterGeneration,
          posterBinaries: {
            ...state.posterGeneration.posterBinaries,
            [action.posterId]: {
              ...current,
              [action.kind]: {
                ...current[action.kind],
                status: 'loading',
                error: '',
              },
            },
          },
        },
      }
    }

    case 'POSTER_BINARY_SUCCEEDED': {
      const current = posterBinary(state, action.posterId)
      return {
        ...state,
        posterGeneration: {
          ...state.posterGeneration,
          resourceRevision: state.posterGeneration.resourceRevision + 1,
          posterBinaries: {
            ...state.posterGeneration.posterBinaries,
            [action.posterId]: {
              ...current,
              [action.kind]: {
                status: 'ready',
                blob: action.blob,
                objectUrl: action.objectUrl,
                error: '',
              },
            },
          },
        },
      }
    }

    case 'POSTER_BINARY_FAILED': {
      const current = posterBinary(state, action.posterId)
      return {
        ...state,
        posterGeneration: {
          ...state.posterGeneration,
          resourceRevision: state.posterGeneration.resourceRevision + 1,
          posterBinaries: {
            ...state.posterGeneration.posterBinaries,
            [action.posterId]: {
              ...current,
              [action.kind]: {
                ...current[action.kind],
                status: 'error',
                error: action.error,
              },
            },
          },
        },
      }
    }

    case 'RESET_POSTER_BINARY': {
      const current = posterBinary(state, action.posterId)
      return {
        ...state,
        posterGeneration: {
          ...state.posterGeneration,
          resourceRevision: state.posterGeneration.resourceRevision + 1,
          posterBinaries: {
            ...state.posterGeneration.posterBinaries,
            [action.posterId]: {
              ...current,
              [action.kind]: emptyBinaryResourceState(),
            },
          },
        },
      }
    }

    case 'BEGIN_POSTER_ZIP':
      return {
        ...state,
        posterGeneration: {
          ...state.posterGeneration,
          zipBinary: {
            ...state.posterGeneration.zipBinary,
            generationId: action.generationId,
            status: 'loading',
            error: '',
          },
        },
      }

    case 'POSTER_ZIP_SUCCEEDED':
      return {
        ...state,
        posterGeneration: {
          ...state.posterGeneration,
          zipBinary: {
            generationId: action.generationId,
            status: 'ready',
            blob: action.blob,
            objectUrl: action.objectUrl,
            error: '',
          },
        },
      }

    case 'POSTER_ZIP_FAILED':
      if (state.posterGeneration.zipBinary.generationId !== action.generationId) {
        return state
      }
      return {
        ...state,
        posterGeneration: {
          ...state.posterGeneration,
          zipBinary: {
            ...state.posterGeneration.zipBinary,
            status: 'error',
            error: action.error,
          },
        },
      }

    case 'BEGIN_STEP_FOUR_ENTRY':
      return {
        ...state,
        posterEditor: {
          ...state.posterEditor,
          operations: {
            ...state.posterEditor.operations,
            entryBusy: true,
            entryError: '',
          },
        },
      }

    case 'CANCEL_STEP_FOUR_ENTRY':
      return {
        ...state,
        posterEditor: {
          ...state.posterEditor,
          operations: {
            ...state.posterEditor.operations,
            entryBusy: false,
            entryError: '',
          },
        },
      }

    case 'STEP_FOUR_ENTRY_FAILED':
      return {
        ...state,
        posterEditor: {
          ...state.posterEditor,
          operations: {
            ...state.posterEditor.operations,
            entryBusy: false,
            entryError: action.error,
          },
        },
      }

    case 'ENTER_STEP_FOUR': {
      const result = state.posterGeneration.result
      const index = state.posterGeneration.selectedIndex
      const slot = index === null ? null : result?.posters[index] ?? null
      if (
        state.currentStep !== 3 ||
        !result ||
        index === null ||
        !isEligibleReadySlot(slot) ||
        result.generationId !== action.active.generationId ||
        slot.posterId !== action.active.posterId ||
        slot.downloadUrl !== action.active.downloadUrl ||
        action.baseResource.sha256 !== action.active.baseBlobSha256
      ) {
        return {
          ...state,
          posterEditor: {
            ...state.posterEditor,
            operations: {
              ...state.posterEditor.operations,
              entryBusy: false,
              entryError: '所选底图不可用，请返回步骤 3 重新选用。',
            },
          },
        }
      }

      const editor = state.posterEditor
      const priorActive = editor.active
      const sameBaseIdentity = Boolean(
        priorActive &&
          priorActive.generationId === action.active.generationId &&
          priorActive.posterId === action.active.posterId &&
          priorActive.slot === action.active.slot &&
          priorActive.baseBlobSha256 === action.active.baseBlobSha256,
      )
      const sameCompleteIdentity = Boolean(
        sameBaseIdentity &&
          priorActive?.upstreamSha256 === action.active.upstreamSha256,
      )
      const drafts = { ...editor.drafts }
      const draftKey = action.active.draftKey ?? action.active.generationId
      if (!drafts[draftKey]) {
        drafts[draftKey] = {
          generationId: action.active.generationId,
          draftKey,
          layout: normalizeCompletePosterLayout(action.initialLayout),
          nextCustomIndex: 1,
        }
      }
      const resources = { ...editor.resources }
      if (priorActive && priorActive.baseBlobId !== action.active.baseBlobId) {
        delete resources[priorActive.baseBlobId]
      }
      resources[action.baseResource.id] = action.baseResource
      const nextResourceRevision = editor.resourceRevision + 1
      const identityChanged = !sameCompleteIdentity
      const completedSteps = new Set(state.completedSteps)
      completedSteps.add(3)
      if (identityChanged) completedSteps.delete(4)
      return {
        ...state,
        currentStep: 4,
        completedSteps,
        posterGeneration: {
          ...state.posterGeneration,
          selectedSlot: { ...slot },
          completedDraft: {
            generationId: result.generationId,
            selectedIndex: index,
            posterId: slot.posterId,
            selectedSlot: { ...slot },
          },
        },
        posterEditor: {
          ...editor,
          drafts,
          active: {
            ...action.active,
            resourceRevision: nextResourceRevision,
          },
          activePanel: sameBaseIdentity ? editor.activePanel : 'text',
          selectedTextId: sameBaseIdentity ? editor.selectedTextId : 'box-title',
          selectedShapeId: sameBaseIdentity ? editor.selectedShapeId : null,
          selectedImageId: sameBaseIdentity ? editor.selectedImageId : null,
          compositionRevision:
            editor.compositionRevision + (identityChanged ? 1 : 0),
          resourceRevision: nextResourceRevision,
          resources,
          currentLayoutSha256: sameCompleteIdentity
            ? editor.currentLayoutSha256
            : null,
          confirmedPoster: sameBaseIdentity ? editor.confirmedPoster : null,
          completion: sameCompleteIdentity ? editor.completion : null,
          operations: {
            ...editor.operations,
            entryBusy: false,
            entryError: '',
            exportError: '',
            confirmationError: '',
          },
        },
      }
    }

    case 'GO_TO_STEP_THREE':
      return { ...state, currentStep: 3 }

    case 'SET_STEP_FOUR_UI':
      return {
        ...state,
        posterEditor: {
          ...state.posterEditor,
          activePanel: action.panel ?? state.posterEditor.activePanel,
          selectedTextId:
            action.selectedTextId === undefined
              ? state.posterEditor.selectedTextId
              : action.selectedTextId,
          selectedShapeId:
            action.selectedShapeId === undefined
              ? state.posterEditor.selectedShapeId
              : action.selectedShapeId,
          selectedImageId:
            action.selectedImageId === undefined
              ? state.posterEditor.selectedImageId
              : action.selectedImageId,
        },
      }

    case 'COMMIT_STEP_FOUR_MUTATION': {
      const active = state.posterEditor.active
      if (!active) return state
      const draftKey = posterEditorDraftKey(active)
      if (!draftKey) return state
      const draft = state.posterEditor.drafts[draftKey]
      if (!draft) return state
      const normalized = normalizeCompletePosterLayout(action.layout)
      const additions = action.addedResources ?? []
      const removals = action.removedResourceIds ?? []
      const layoutChanged = !sameNormalizedLayout(draft.layout, normalized)
      if (!layoutChanged && additions.length === 0 && removals.length === 0) {
        if (action.imageStatus === undefined) return state
        return {
          ...state,
          posterEditor: {
            ...state.posterEditor,
            operations: {
              ...state.posterEditor.operations,
              imageStatus: action.imageStatus,
            },
          },
        }
      }
      const resources = { ...state.posterEditor.resources }
      for (const id of removals) delete resources[id]
      for (const resource of additions) resources[resource.id] = resource
      const completedSteps = withoutCompletedStep(state.completedSteps, 4)
      const selectedTextId = normalized.textBoxes.some(
        (box) => box.id === state.posterEditor.selectedTextId,
      )
        ? state.posterEditor.selectedTextId
        : normalized.textBoxes[0]?.id ?? null
      const selectedShapeId = normalized.shapes.some(
        (shape) => shape.id === state.posterEditor.selectedShapeId,
      )
        ? state.posterEditor.selectedShapeId
        : null
      const selectedImageId = normalized.images.some(
        (image) => image.id === state.posterEditor.selectedImageId,
      )
        ? state.posterEditor.selectedImageId
        : null
      const nextCustomIndex =
        normalized.textBoxes.reduce((largest, box) => {
          const match = /^custom-(\d+)$/.exec(box.role)
          return match ? Math.max(largest, Number(match[1])) : largest
        }, 0) + 1
      return {
        ...state,
        completedSteps,
        posterEditor: {
          ...state.posterEditor,
          drafts: {
            ...state.posterEditor.drafts,
            [draftKey]: {
              ...draft,
              layout: normalized,
              nextCustomIndex,
            },
          },
          selectedTextId,
          selectedShapeId,
          selectedImageId,
          compositionRevision: state.posterEditor.compositionRevision + 1,
          resourceRevision:
            state.posterEditor.resourceRevision +
            (additions.length > 0 || removals.length > 0 ? 1 : 0),
          resources,
          currentLayoutSha256: null,
          completion: null,
          operations: {
            ...state.posterEditor.operations,
            confirmationError: '',
            exportError: '',
            imageStatus:
              action.imageStatus ?? state.posterEditor.operations.imageStatus,
          },
        },
      }
    }

    case 'BEGIN_STEP_FOUR_EXPORT':
      return {
        ...state,
        posterEditor: {
          ...state.posterEditor,
          operations: {
            ...state.posterEditor.operations,
            exportBusy: true,
            exportError: '',
          },
        },
      }

    case 'STEP_FOUR_EXPORT_FINISHED':
      return {
        ...state,
        posterEditor: {
          ...state.posterEditor,
          operations: {
            ...state.posterEditor.operations,
            exportBusy: false,
          },
        },
      }

    case 'STEP_FOUR_EXPORT_FAILED':
      return {
        ...state,
        posterEditor: {
          ...state.posterEditor,
          operations: {
            ...state.posterEditor.operations,
            exportBusy: false,
            exportError: action.error,
          },
        },
      }

    case 'BEGIN_STEP_FOUR_CONFIRMATION':
      return {
        ...state,
        completedSteps: withoutCompletedStep(state.completedSteps, 4),
        posterEditor: {
          ...state.posterEditor,
          currentLayoutSha256: null,
          completion: null,
          operations: {
            ...state.posterEditor.operations,
            confirmationBusy: true,
            confirmationError: '',
          },
        },
      }

    case 'STEP_FOUR_CONFIRMATION_SUCCEEDED': {
      const editor = state.posterEditor
      const active = editor.active
      const draftKey = posterEditorDraftKey(active)
      const draft = draftKey ? editor.drafts[draftKey] : null
      if (
        !active ||
        !draft ||
        editor.compositionRevision !== action.expectedRevision ||
        action.snapshot.confirmedRevision !== action.expectedRevision ||
        action.snapshot.generationId !== active.generationId ||
        action.snapshot.posterId !== active.posterId ||
        action.snapshot.slot !== active.slot ||
        action.snapshot.baseBlobSha256 !== active.baseBlobSha256 ||
        action.snapshot.upstreamSha256 !== active.upstreamSha256 ||
        !sameNormalizedLayout(draft.layout, action.snapshot.layout)
      ) {
        return {
          ...state,
          posterEditor: {
            ...editor,
            operations: {
              ...editor.operations,
              confirmationBusy: false,
              confirmationError: '',
            },
          },
        }
      }
      const retained = editor.confirmedPoster
      const sameInput = Boolean(
        retained &&
          retained.inputSignatureSha256 === action.snapshot.inputSignatureSha256,
      )
      const samePng = Boolean(
        sameInput && retained?.pngBlobSha256 === action.snapshot.pngBlobSha256,
      )
      const confirmedPoster = samePng && retained
        ? {
            ...action.snapshot,
            pngBlob: retained.pngBlob,
            pngBlobSha256: retained.pngBlobSha256,
          }
        : action.snapshot
      return {
        ...state,
        posterEditor: {
          ...editor,
          currentLayoutSha256: action.snapshot.layoutSha256,
          confirmedPoster,
          completion: null,
          rendererMismatchCount:
            editor.rendererMismatchCount + (sameInput && !samePng ? 1 : 0),
          operations: {
            ...editor.operations,
            confirmationBusy: false,
            confirmationError: '',
          },
        },
      }
    }

    case 'STEP_FOUR_CONFIRMATION_FAILED':
      return {
        ...state,
        posterEditor: {
          ...state.posterEditor,
          currentLayoutSha256: null,
          completion: null,
          operations: {
            ...state.posterEditor.operations,
            confirmationBusy: false,
            confirmationError: action.error,
          },
        },
      }

    case 'COMPLETE_STEP_FOUR': {
      const editor = state.posterEditor
      const confirmed = editor.confirmedPoster
      if (!confirmed || !isCurrentStepFourConfirmation(editor)) return state
      const completedSteps = new Set(state.completedSteps)
      completedSteps.add(4)
      const completion = {
        generationId: confirmed.generationId,
        posterId: confirmed.posterId,
        confirmedRevision: confirmed.confirmedRevision,
        baseBlobSha256: confirmed.baseBlobSha256,
        layoutSha256: confirmed.layoutSha256,
        upstreamSha256: confirmed.upstreamSha256,
        pngBlobSha256: confirmed.pngBlobSha256,
      }
      if (!action.entry) {
        return {
          ...state,
          currentStep: 4,
          completedSteps,
          posterEditor: { ...editor, completion },
        }
      }
      const { owner, posterResource } = action.entry
      const completionWasCurrent = Boolean(
        editor.completion &&
        editor.completion.generationId === confirmed.generationId &&
        editor.completion.posterId === confirmed.posterId &&
        editor.completion.confirmedRevision === confirmed.confirmedRevision &&
        editor.completion.baseBlobSha256 === confirmed.baseBlobSha256 &&
        editor.completion.layoutSha256 === confirmed.layoutSha256 &&
        editor.completion.upstreamSha256 === confirmed.upstreamSha256 &&
        editor.completion.pngBlobSha256 === confirmed.pngBlobSha256,
      )
      const validEntry =
        completionWasCurrent &&
        owner.generationId === confirmed.generationId &&
        owner.posterId === confirmed.posterId &&
        owner.inputSignatureSha256 === confirmed.inputSignatureSha256 &&
        owner.pngBlobSha256 === confirmed.pngBlobSha256 &&
        posterResource.id === 'poster-final' &&
        posterResource.kind === 'poster-final' &&
        posterResource.mimeType === 'image/png' &&
        posterResource.sha256 === confirmed.pngBlobSha256 &&
        posterResource.blob === confirmed.pngBlob &&
        posterResource.width === 1024 &&
        posterResource.height === 1536
      if (!validEntry) return state
      let detailEditor = state.detailEditor
      if (sameDetailOwner(detailEditor.owner, owner)) {
        const priorPoster = detailEditor.resources['poster-final']
        const resourceChanged = priorPoster?.blob !== posterResource.blob
        detailEditor = {
          ...detailEditor,
          resources: {
            ...detailEditor.resources,
            'poster-final': posterResource,
          },
          resourceRevision: detailEditor.resourceRevision + (resourceChanged ? 1 : 0),
          operations: {
            ...detailEditor.operations,
            exportError: '',
            confirmationError: '',
          },
        }
      } else {
        detailEditor = createInitialDetailEditor(owner, posterResource)
        completedSteps.delete(5)
      }
      return {
        ...state,
        currentStep: 5,
        completedSteps,
        posterEditor: { ...editor, completion },
        detailEditor,
      }
    }

    case 'GO_TO_STEP_FOUR':
      return state.currentStep === 5 ? { ...state, currentStep: 4 } : state

    case 'SET_STEP_FIVE_UI':
      if (state.currentStep !== 5 || !state.detailEditor.owner) return state
      return {
        ...state,
        detailEditor: {
          ...state.detailEditor,
          activePanel: action.panel ?? state.detailEditor.activePanel,
          selectedLayerId: action.selectedLayerId === undefined
            ? state.detailEditor.selectedLayerId
            : action.selectedLayerId,
          selectedResourceId: action.selectedResourceId === undefined
            ? state.detailEditor.selectedResourceId
            : action.selectedResourceId,
        },
      }

    case 'SET_STEP_FIVE_ACTIVE_PAGE': {
      const detail = state.detailEditor
      if (state.currentStep !== 5 || !detail.owner || action.index < 0 || action.index >= detail.pages.length || action.index === detail.activePageIndex) return state
      return {
        ...state,
        detailEditor: {
          ...detail,
          activePageIndex: action.index,
          selectedLayerId: null,
          selectedResourceId: detail.pages[action.index].activeProductId,
          operations: { ...detail.operations, exportError: '', confirmationError: '' },
        },
      }
    }

    case 'ADD_STEP_FIVE_PAGE': {
      const detail = state.detailEditor
      if (
        state.currentStep !== 5 ||
        !detail.owner ||
        detail.pages.some((page) => page.id === action.page.id) ||
        action.page.compositionRevision !== 0 ||
        action.page.currentExport !== null
      ) return state
      return {
        ...state,
        completedSteps: withoutCompletedStep(state.completedSteps, 5),
        detailEditor: {
          ...detail,
          pages: [...detail.pages, action.page],
          activePageIndex: detail.pages.length,
          selectedLayerId: null,
          selectedResourceId: action.page.activeProductId,
          nextPageSequence: detail.nextPageSequence + 1,
          confirmedDetails: null,
          completion: null,
          operations: { ...detail.operations, exportError: '', confirmationError: '' },
        },
        workflowV2: state.workflowV2.phase === 'active'
          ? { ...state.workflowV2, currentDetailOutputSignatureSha256: null }
          : state.workflowV2,
      }
    }

    case 'COMMIT_STEP_FIVE_PAGE_MUTATION': {
      const detail = state.detailEditor
      const index = detail.pages.findIndex((page) => page.id === action.pageId)
      const current = detail.pages[index]
      if (
        state.currentStep !== 5 ||
        !detail.owner ||
        index < 0 ||
        !current ||
        current.compositionRevision !== action.expectedRevision ||
        action.page.id !== current.id
      ) return state
      const resources = { ...detail.resources }
      for (const resource of action.addedResources ?? []) {
        const retained = resources[resource.id]
        if (retained && retained.sha256 !== resource.sha256) return state
        resources[resource.id] = retained ?? resource
      }
      const projectedPages = detail.pages.map((item, pageIndex) => pageIndex === index ? action.page : item)
      for (const resourceId of action.removedResourceIds ?? []) {
        const referenced = projectedPages.some((page) =>
          page.background.resourceId === resourceId ||
          page.layers.some((layer) => layer.kind === 'image' && layer.resourceId === resourceId),
        )
        if (!referenced && resourceId !== 'poster-final') delete resources[resourceId]
      }
      const page = {
        ...action.page,
        compositionRevision: current.compositionRevision + 1,
        currentExport: null,
      }
      const pages = detail.pages.map((item, pageIndex) => pageIndex === index ? page : item)
      return {
        ...state,
        completedSteps: withoutCompletedStep(state.completedSteps, 5),
        detailEditor: {
          ...detail,
          pages,
          resources,
          resourceRevision: detail.resourceRevision + ((action.addedResources?.length ?? 0) + (action.removedResourceIds?.length ?? 0) > 0 ? 1 : 0),
          selectedLayerId: action.selectedLayerId === undefined ? detail.selectedLayerId : action.selectedLayerId,
          selectedResourceId: action.selectedResourceId === undefined ? detail.selectedResourceId : action.selectedResourceId,
          nextLayerSequence: Math.max(detail.nextLayerSequence, action.page.layers.length + 1),
          confirmedDetails: null,
          completion: null,
          operations: { ...detail.operations, exportError: '', confirmationError: '' },
        },
        workflowV2: state.workflowV2.phase === 'active'
          ? { ...state.workflowV2, currentDetailOutputSignatureSha256: null }
          : state.workflowV2,
      }
    }

    case 'BEGIN_STEP_FIVE_PIXEL_MUTATION': {
      const detail = state.detailEditor
      const index = detail.pages.findIndex((page) => page.id === action.pageId)
      const page = detail.pages[index]
      if (state.currentStep !== 5 || !detail.owner || !page || page.compositionRevision !== action.expectedRevision) return state
      const pages = detail.pages.map((item, pageIndex) => pageIndex === index
        ? { ...item, compositionRevision: item.compositionRevision + 1, currentExport: null }
        : item)
      return {
        ...state,
        completedSteps: withoutCompletedStep(state.completedSteps, 5),
        detailEditor: {
          ...detail,
          pages,
          confirmedDetails: null,
          completion: null,
          operations: { ...detail.operations, exportError: '', confirmationError: '' },
        },
        workflowV2: state.workflowV2.phase === 'active'
          ? { ...state.workflowV2, currentDetailOutputSignatureSha256: null }
          : state.workflowV2,
      }
    }

    case 'COMMIT_STEP_FIVE_PIXEL_MUTATION': {
      const detail = state.detailEditor
      const index = detail.pages.findIndex((page) => page.id === action.pageId)
      const page = detail.pages[index]
      if (
        state.currentStep !== 5 ||
        !detail.owner ||
        !page ||
        page.compositionRevision !== action.expectedRevision ||
        action.page.id !== page.id
      ) return state
      return {
        ...state,
        completedSteps: withoutCompletedStep(state.completedSteps, 5),
        detailEditor: {
          ...detail,
          pages: detail.pages.map((item, pageIndex) => pageIndex === index
            ? { ...action.page, compositionRevision: action.expectedRevision, currentExport: null }
            : item),
        },
        workflowV2: state.workflowV2.phase === 'active'
          ? { ...state.workflowV2, currentDetailOutputSignatureSha256: null }
          : state.workflowV2,
      }
    }

    case 'SET_STEP_FIVE_OPERATIONS':
      if (!state.detailEditor.owner) return state
      return {
        ...state,
        detailEditor: {
          ...state.detailEditor,
          operations: { ...state.detailEditor.operations, ...action.operations },
        },
      }

    case 'STEP_FIVE_EXPORT_SUCCEEDED': {
      const detail = state.detailEditor
      const index = detail.pages.findIndex((page) => page.id === action.pageId)
      const page = detail.pages[index]
      if (
        state.currentStep !== 5 ||
        !sameDetailOwner(detail.owner, action.owner) ||
        !page ||
        page.compositionRevision !== action.expectedRevision ||
        detail.resourceRevision !== action.expectedResourceRevision ||
        action.pageExport.pageId !== page.id ||
        action.pageExport.revision !== page.compositionRevision ||
        action.pageExport.signatureSha256 !== action.expectedSignatureSha256 ||
        action.pageExport.width !== 750 ||
        action.pageExport.height !== 1334
      ) return state
      return {
        ...state,
        completedSteps: withoutCompletedStep(state.completedSteps, 5),
        detailEditor: {
          ...detail,
          pages: detail.pages.map((item, pageIndex) => pageIndex === index
            ? { ...item, currentExport: action.pageExport }
            : item),
          confirmedDetails: null,
          completion: null,
          operations: { ...detail.operations, exportBusy: false, exportError: '' },
        },
      }
    }

    case 'STEP_FIVE_CONFIRMATION_SUCCEEDED': {
      const detail = state.detailEditor
      if (
        state.currentStep !== 5 ||
        !detail.owner ||
        !sameDetailOwner(detail.owner, action.owner) ||
        detail.resourceRevision !== action.expectedResourceRevision ||
        action.pageExports.length !== detail.pages.length ||
        action.pageExports.length === 0 ||
        action.pageExports.some((item, index) => detail.pages[index].currentExport !== item)
      ) return state
      const pngBlobs = action.pageExports.map((item) => item.pngBlob)
      return {
        ...state,
        detailEditor: {
          ...detail,
          confirmedDetails: {
            owner: { ...action.owner },
            pageExports: [...action.pageExports],
            pngBlobs,
            firstPngBlob: pngBlobs[0],
            groupSignatureSha256: action.groupSignatureSha256,
            confirmedResourceRevision: action.expectedResourceRevision,
          },
          completion: null,
          operations: { ...detail.operations, confirmationBusy: false, confirmationError: '' },
        },
      }
    }

    case 'COMMIT_V2_DETAIL_CONFIRMATION': {
      const detail = state.detailEditor
      const ref = currentV2PosterRef(state)
      const project = state.workflowV2.detailProject
      if (
        state.workflowV2.phase !== 'active' ||
        state.workflowV2.view !== 'detail' ||
        state.currentStep !== 5 ||
        !ref ||
        !project ||
        project.projectSignatureSha256 !== action.project.projectSignatureSha256 ||
        !samePosterRef(project.owner.posterRef, ref) ||
        !isDetailProjectInternallyConsistent(action.project) ||
        !isConfirmedDetailInternallyConsistent(action.confirmedDetail) ||
        action.confirmedDetail.detailId !== project.detailId ||
        action.confirmedDetail.owner.ownerSignatureSha256 !== project.owner.ownerSignatureSha256 ||
        !samePosterRef(action.confirmedDetail.owner.posterRef, ref) ||
        !sameDetailOwner(detail.owner, action.legacyOwner) ||
        detail.resourceRevision !== action.expectedResourceRevision ||
        action.pageExports.length === 0 ||
        action.pageExports.length !== detail.pages.length ||
        action.confirmedDetail.pageSignatureSha256.length !== action.pageExports.length ||
        action.confirmedDetail.pngBlobSha256.length !== action.pageExports.length ||
        action.pageExports.some((item, index) => detail.pages[index].currentExport !== item) ||
        action.confirmedDetail.groupSignatureSha256 !== action.groupSignatureSha256 ||
        action.confirmedDetail.resourceRevision !== action.expectedResourceRevision ||
        action.confirmedDetail.pageSignatureSha256.some(
          (value, index) => value !== action.pageExports[index].signatureSha256,
        ) ||
        action.confirmedDetail.pngBlobSha256.some(
          (value, index) => value !== action.pageExports[index].pngBlobSha256,
        )
      ) return state
      const pngBlobs = action.pageExports.map((item) => item.pngBlob)
      const unchanged = Boolean(
        state.workflowV2.confirmedDetail &&
          state.workflowV2.confirmedDetail.outputSignatureSha256 ===
            action.confirmedDetail.outputSignatureSha256,
      )
      const completedSteps = new Set(state.completedSteps)
      completedSteps.add(5)
      return {
        ...state,
        completedSteps,
        detailEditor: {
          ...detail,
          confirmedDetails: {
            owner: { ...action.legacyOwner },
            pageExports: [...action.pageExports],
            pngBlobs,
            firstPngBlob: pngBlobs[0],
            groupSignatureSha256: action.groupSignatureSha256,
            confirmedResourceRevision: action.expectedResourceRevision,
          },
          completion: null,
          operations: {
            ...detail.operations,
            confirmationBusy: false,
            confirmationError: '',
          },
        },
        workflowV2: {
          ...state.workflowV2,
          confirmedDetail: unchanged
            ? state.workflowV2.confirmedDetail
            : action.confirmedDetail,
          currentDetailOutputSignatureSha256:
            action.confirmedDetail.outputSignatureSha256,
        },
      }
    }

    case 'COMPLETE_V2_DETAIL': {
      const detail = state.detailEditor
      const project = state.workflowV2.detailProject
      const confirmed = state.workflowV2.confirmedDetail
      const ref = currentV2PosterRef(state)
      if (
        state.workflowV2.phase !== 'active' ||
        !project ||
        !confirmed ||
        !ref ||
        !samePosterRef(project.owner.posterRef, ref) ||
        confirmed.detailId !== project.detailId ||
        confirmed.outputSignatureSha256 !==
          state.workflowV2.currentDetailOutputSignatureSha256 ||
        !sameDetailOwner(detail.owner, detail.confirmedDetails?.owner ?? null)
      ) return state
      return {
        ...state,
        workflowV2: {
          ...state.workflowV2,
          view: 'workspace',
          resumeView: 'workspace',
          workspaceFocusModule: 'detail',
        },
      }
    }

    case 'COMPLETE_STEP_FIVE': {
      const detail = state.detailEditor
      const confirmed = detail.confirmedDetails
      if (
        state.currentStep !== 5 ||
        !detail.owner ||
        !confirmed ||
        !sameDetailOwner(detail.owner, confirmed.owner) ||
        confirmed.confirmedResourceRevision !== detail.resourceRevision ||
        confirmed.pageExports.length !== detail.pages.length ||
        confirmed.pageExports.some((item, index) => detail.pages[index].currentExport !== item)
      ) return state
      const completedSteps = new Set(state.completedSteps)
      completedSteps.add(5)
      return {
        ...state,
        currentStep: 6,
        completedSteps,
        detailEditor: {
          ...detail,
          completion: {
            owner: { ...detail.owner },
            groupSignatureSha256: confirmed.groupSignatureSha256,
            pageCount: confirmed.pageExports.length,
            pngBlobSha256: confirmed.pageExports.map((item) => item.pngBlobSha256),
          },
        },
      }
    }

    case 'GO_TO_STEP_FIVE':
      return state.currentStep === 6 ? { ...state, currentStep: 5 } : state

    case 'COMPLETE_STEP_SIX': {
      if (state.currentStep !== 6) return state
      const view = selectStep6ViewModel(state)
      const completion = completionFromStep6View(view)
      if (!completion) return state
      const completionCurrent = Boolean(
        state.marketingStrategyStep.completion &&
        isCurrentStep6Completion(state),
      )
      const completedSteps = new Set(state.completedSteps)
      completedSteps.add(6)
      const candidate: WorkflowState = {
        ...state,
        currentStep: 7,
        completedSteps,
        marketingStrategyStep: completionCurrent
          ? state.marketingStrategyStep
          : { completion },
      }
      return selectFinalResultsViewModel(candidate) ? candidate : state
    }

    case 'GO_TO_STEP_SIX':
      return state.currentStep === 7 ? { ...state, currentStep: 6 } : state

    case 'START_V2_CREATION': {
      const fresh = createInitialWorkflowState()
      return {
        ...fresh,
        workflowV2: createActiveWorkflowV2Session(state.workflowV2.epoch + 1),
      }
    }

    case 'V2_RETURN_HOME':
      return {
        ...state,
        workflowV2: {
          ...state.workflowV2,
          resumeView:
            state.workflowV2.phase === 'active' &&
            state.workflowV2.view !== 'home' &&
            state.workflowV2.view !== 'history'
              ? state.workflowV2.view
              : state.workflowV2.resumeView,
          view: 'home',
        },
      }

    case 'ENTER_V2_HISTORY':
      return {
        ...state,
        workflowV2: {
          ...state.workflowV2,
          view: 'history',
        },
      }

    case 'V2_CONTINUE_SESSION': {
      if (state.workflowV2.phase !== 'active') return state
      const resultsStillEligible =
        state.workflowV2.resumeView !== 'results' || hasCurrentProgressiveResults(state)
      return {
        ...state,
        workflowV2: {
          ...state.workflowV2,
          view: resultsStillEligible ? state.workflowV2.resumeView : 'workspace',
          resumeView: resultsStillEligible ? state.workflowV2.resumeView : 'workspace',
          workspaceFocusModule: resultsStillEligible ? null : 'results',
        },
      }
    }

    case 'BEGIN_V2_BASIC_COMMIT':
      return state.workflowV2.phase === 'active' &&
        action.pending.workflowEpoch === state.workflowV2.epoch &&
        action.pending.draftRevision === state.workflowV2.basicDraftRevision
        ? {
            ...state,
            workflowV2: {
              ...state.workflowV2,
              pendingBasicCommit: action.pending,
              basicCommitError: '',
            },
          }
        : state

    case 'COMMIT_V2_BASIC': {
      const pending = state.workflowV2.pendingBasicCommit
      if (!pending || pending.requestId !== action.requestId ||
        pending.workflowEpoch !== action.workflowEpoch ||
        pending.draftRevision !== action.draftRevision ||
        state.workflowV2.epoch !== action.workflowEpoch ||
        state.workflowV2.basicDraftRevision !== action.draftRevision) {
        return state
      }
      const completedSteps = new Set(state.completedSteps)
      completedSteps.add(1)
      return {
        ...state,
        currentStep: 1,
        completedSteps,
        productInfo: {
          ...state.productInfo,
          errors: {},
          completedDraft: {
            ...state.productInfo.values,
            productImage: state.productInfo.productImage,
          },
        },
        workflowV2: {
          ...state.workflowV2,
          view: 'advice',
          resumeView: 'advice',
          basicAuthority: action.authority,
          pendingBasicCommit: null,
          basicCommitError: '',
          pendingAdviceRequest: null,
          adviceRequestError: null,
        },
      }
    }

    case 'FAIL_V2_BASIC_COMMIT': {
      const pending = state.workflowV2.pendingBasicCommit
      return pending && pending.requestId === action.requestId &&
        pending.workflowEpoch === action.workflowEpoch &&
        pending.draftRevision === action.draftRevision
        ? {
            ...state,
            workflowV2: {
              ...state.workflowV2,
              pendingBasicCommit: null,
              basicCommitError: action.error,
            },
        }
        : state
    }

    case 'COMMIT_V2_BASIC_AUTHORITY':
      return state.workflowV2.phase === 'active' &&
        state.workflowV2.epoch === action.workflowEpoch &&
        state.workflowV2.basicDraftRevision === action.draftRevision
        ? {
            ...state,
            workflowV2: {
              ...state.workflowV2,
              basicAuthority: action.authority,
              basicCommitError: '',
            },
          }
        : state

    case 'BEGIN_V2_ADVICE_REQUEST': {
      const basic = state.workflowV2.basicAuthority
      return state.workflowV2.phase === 'active' &&
        basic !== null &&
        action.pending.workflowEpoch === state.workflowV2.epoch &&
        action.pending.draftRevision === state.workflowV2.basicDraftRevision &&
        action.pending.expectedInputSignatureSha256 ===
          basic.text.adviceInputSignatureSha256 &&
        action.pending.basicTextSignatureSha256 === basic.text.signatureSha256 &&
        state.workflowV2.pendingAdviceRequest === null
        ? {
            ...state,
            workflowV2: {
              ...state.workflowV2,
              view: 'advice',
              resumeView: 'advice',
              pendingAdviceRequest: action.pending,
              adviceRequestError: null,
            },
          }
        : state
    }

    case 'COMMIT_V2_ADVICE': {
      const pending = state.workflowV2.pendingAdviceRequest
      const basic = state.workflowV2.basicAuthority
      if (!pending || !basic ||
        pending.requestId !== action.requestId ||
        pending.workflowEpoch !== action.workflowEpoch ||
        pending.draftRevision !== action.draftRevision ||
        pending.expectedInputSignatureSha256 !== action.expectedInputSignatureSha256 ||
        pending.basicTextSignatureSha256 !== action.basicTextSignatureSha256 ||
        state.workflowV2.epoch !== action.workflowEpoch ||
        state.workflowV2.basicDraftRevision !== action.draftRevision ||
        basic.text.signatureSha256 !== action.basicTextSignatureSha256 ||
        basic.text.adviceInputSignatureSha256 !== action.expectedInputSignatureSha256 ||
        !isAdviceCurrentForBasic(action.authority, basic)) {
        return state
      }
      return {
        ...state,
        workflowV2: {
          ...state.workflowV2,
          view: 'advice',
          resumeView: 'advice',
          adviceAuthority: action.authority,
          pendingAdviceRequest: null,
          adviceRequestError: null,
        },
      }
    }

    case 'FAIL_V2_ADVICE_REQUEST': {
      const pending = state.workflowV2.pendingAdviceRequest
      return pending &&
        pending.requestId === action.requestId &&
        pending.workflowEpoch === action.workflowEpoch &&
        pending.draftRevision === action.draftRevision &&
        pending.expectedInputSignatureSha256 === action.expectedInputSignatureSha256 &&
        pending.basicTextSignatureSha256 === action.basicTextSignatureSha256 &&
        state.workflowV2.epoch === action.workflowEpoch &&
        state.workflowV2.basicDraftRevision === action.draftRevision
        ? {
            ...state,
            workflowV2: {
              ...state.workflowV2,
              pendingAdviceRequest: null,
              adviceRequestError: action.error,
            },
          }
        : state
    }

    case 'CANCEL_V2_ADVICE_REQUEST': {
      const pending = state.workflowV2.pendingAdviceRequest
      return pending &&
        pending.requestId === action.requestId &&
        pending.workflowEpoch === action.workflowEpoch &&
        pending.draftRevision === action.draftRevision &&
        pending.expectedInputSignatureSha256 === action.expectedInputSignatureSha256 &&
        pending.basicTextSignatureSha256 === action.basicTextSignatureSha256
        ? {
            ...state,
            workflowV2: {
              ...state.workflowV2,
              pendingAdviceRequest: null,
            },
          }
        : state
    }

    case 'CONTINUE_FROM_V2_ADVICE': {
      const basic = state.workflowV2.basicAuthority
      const advice = state.workflowV2.adviceAuthority
      if (!basic || !advice || !isAdviceCurrentForBasic(advice, basic)) {
        return state
      }
      return {
        ...state,
        workflowV2: {
          ...state.workflowV2,
          view: 'workspace',
          resumeView: 'workspace',
          workspaceFocusModule: null,
        },
      }
    }

    case 'RETURN_TO_V2_ADVICE': {
      const basic = state.workflowV2.basicAuthority
      const advice = state.workflowV2.adviceAuthority
      return basic && advice && isAdviceCurrentForBasic(advice, basic)
        ? {
            ...state,
            workflowV2: {
              ...state.workflowV2,
              view: 'advice',
              resumeView: 'advice',
              workspaceFocusModule: null,
            },
          }
        : state
    }

    case 'ENTER_V2_ADVICE': {
      const basic = state.workflowV2.basicAuthority
      return state.workflowV2.phase === 'active' && basic
        ? {
            ...state,
            currentStep: 1,
            workflowV2: {
              ...state.workflowV2,
              view: 'advice',
              resumeView: 'advice',
              workspaceFocusModule: null,
            },
          }
        : state
    }

    case 'ENTER_V2_WORKSPACE': {
      const basic = state.workflowV2.basicAuthority
      const advice = state.workflowV2.adviceAuthority
      return state.workflowV2.phase === 'active' &&
        basic &&
        advice &&
        isAdviceCurrentForBasic(advice, basic)
        ? {
            ...state,
            workflowV2: {
              ...state.workflowV2,
              view: 'workspace',
              resumeView: 'workspace',
              workspaceFocusModule: null,
            },
          }
        : state
    }

    case 'CLEAR_V2_WORKSPACE_FOCUS':
      return state.workflowV2.workspaceFocusModule
        ? {
            ...state,
            workflowV2: {
              ...state.workflowV2,
              workspaceFocusModule: null,
            },
          }
        : state

    case 'ENTER_V2_COPY': {
      const basic = state.workflowV2.basicAuthority
      const advice = state.workflowV2.adviceAuthority
      if (!basic || !advice || !isAdviceCurrentForBasic(advice, basic)) {
        return state
      }
      return {
        ...state,
        workflowV2: {
          ...state.workflowV2,
          view: 'copy',
          resumeView: 'copy',
          workspaceFocusModule: null,
        },
      }
    }

    case 'RETURN_FROM_V2_COPY':
      return state.workflowV2.phase === 'active'
        ? {
            ...state,
            workflowV2: {
              ...state.workflowV2,
              view: 'workspace',
              resumeView: 'workspace',
              workspaceFocusModule: 'copy',
            },
          }
        : state

    case 'ENTER_V2_POSTER': {
      const basic = state.workflowV2.basicAuthority
      const advice = state.workflowV2.adviceAuthority
      if (
        state.workflowV2.phase !== 'active' ||
        !basic ||
        !advice ||
        basic.productImage.kind !== 'present' ||
        !isAdviceCurrentForBasic(advice, basic)
      ) return state
      return {
        ...state,
        currentStep: 3,
        workflowV2: {
          ...state.workflowV2,
          view: 'poster',
          resumeView: 'poster',
          workspaceFocusModule: null,
        },
      }
    }

    case 'RETURN_FROM_V2_POSTER':
      return state.workflowV2.phase === 'active'
        ? {
            ...state,
            currentStep: 3,
            workflowV2: {
              ...state.workflowV2,
              view: 'workspace',
              resumeView: 'workspace',
              workspaceFocusModule: 'poster',
            },
          }
        : state

    case 'ENTER_V2_RESULTS':
      return state.workflowV2.phase === 'active' && hasCurrentProgressiveResults(state)
        ? {
            ...state,
            workflowV2: {
              ...state.workflowV2,
              view: 'results',
              resumeView: 'results',
              workspaceFocusModule: null,
            },
          }
        : state

    case 'RETURN_FROM_V2_RESULTS':
      return state.workflowV2.phase === 'active'
        ? {
            ...state,
            workflowV2: {
              ...state.workflowV2,
              view: 'workspace',
              resumeView: 'workspace',
              workspaceFocusModule: 'results',
            },
          }
        : state

    case 'COMMIT_V2_POSTER_PROJECT': {
      const basic = state.workflowV2.basicAuthority
      const advice = state.workflowV2.adviceAuthority
      if (
        state.workflowV2.phase !== 'active' ||
        !basic ||
        !advice ||
        !isPosterProjectCurrent(
          action.project,
          basic,
          advice,
          action.project.copyRef ? state.workflowV2.confirmedCopy : null,
        )
      ) return state
      return {
        ...state,
        posterGeneration: createInitialPosterGenerationState(),
        posterEditor: createInitialPosterEditorState(),
        workflowV2: {
          ...state.workflowV2,
          posterProject: action.project,
          confirmedPoster: null,
          posterProjectRevision: state.workflowV2.posterProjectRevision + 1,
        },
      }
    }

    case 'COMMIT_V2_CONFIRMED_POSTER': {
      const basic = state.workflowV2.basicAuthority
      const advice = state.workflowV2.adviceAuthority
      const project = state.workflowV2.posterProject
      if (
        state.workflowV2.phase !== 'active' ||
        !basic ||
        !advice ||
        !project ||
        action.poster.project.inputSignatureSha256 !== project.inputSignatureSha256 ||
        !isConfirmedPosterInternallyConsistent(action.poster) ||
        !isConfirmedPosterCurrent(
          action.poster,
          basic,
          advice,
          action.poster.project.copyRef ? state.workflowV2.confirmedCopy : null,
        )
      ) return state
      return {
        ...state,
        workflowV2: {
          ...state.workflowV2,
          confirmedPoster: action.poster,
        },
      }
    }

    case 'ENTER_V2_LEGACY_POSTER':
      if (
        state.workflowV2.phase !== 'active' ||
        !confirmedCopyMatchesCurrentOwners(state) ||
        state.workflowV2.basicAuthority?.productImage.kind !== 'present' ||
        !state.platformCopy.completedDraft
      ) return state
      return {
        ...state,
        currentStep: 3,
        workflowV2: {
          ...state.workflowV2,
          view: 'workflow',
          resumeView: 'workflow',
          workspaceFocusModule: null,
        },
      }

    case 'ENTER_V2_LEGACY_DETAIL':
      // Compatibility alias retained for the proven Poster editor entry.
      // The provider validates bytes and installs the V2 owner before using it.
      return currentV2PosterRef(state)
        ? {
            ...state,
            currentStep: 5,
            workflowV2: {
              ...state.workflowV2,
              view: 'detail',
              resumeView: 'detail',
              detailEntryError: '',
              workspaceFocusModule: null,
            },
          }
        : state

    case 'SHOW_V2_DETAIL_UPDATE':
      return currentV2PosterRef(state)
        ? {
            ...state,
            workflowV2: {
              ...state.workflowV2,
              view: 'detail',
              resumeView: 'detail',
              detailEntryError: '',
              workspaceFocusModule: null,
            },
          }
        : state

    case 'COMMIT_V2_DETAIL_ENTRY': {
      const ref = currentV2PosterRef(state)
      if (
        !ref ||
        !isDetailProjectInternallyConsistent(action.project) ||
        !samePosterRef(action.project.owner.posterRef, ref) ||
        !legacyDetailEntryMatchesV2Poster(
          state,
          action.legacyOwner,
          action.posterResource,
        )
      ) return state
      const retained = state.workflowV2.detailProject
      const sameProject = Boolean(
        retained &&
          retained.projectSignatureSha256 === action.project.projectSignatureSha256 &&
          samePosterRef(retained.owner.posterRef, action.project.owner.posterRef) &&
          sameDetailOwner(state.detailEditor.owner, action.legacyOwner),
      )
      const detailEditor = sameProject
        ? state.detailEditor
        : createInitialDetailEditor(action.legacyOwner, action.posterResource)
      return {
        ...state,
        currentStep: 5,
        completedSteps: sameProject ? state.completedSteps : withoutCompletedStep(state.completedSteps, 5),
        detailEditor,
        workflowV2: {
          ...state.workflowV2,
          view: 'detail',
          resumeView: 'detail',
          detailProject: action.project,
          currentDetailOutputSignatureSha256: sameProject
            ? state.workflowV2.currentDetailOutputSignatureSha256
            : null,
          detailEntryError: '',
          workspaceFocusModule: null,
        },
      }
    }

    case 'FAIL_V2_DETAIL_ENTRY':
      return state.workflowV2.phase === 'active'
        ? {
            ...state,
            workflowV2: {
              ...state.workflowV2,
              detailEntryError: action.error,
            },
          }
        : state

    case 'RETURN_FROM_V2_DETAIL':
      return state.workflowV2.phase === 'active'
        ? {
            ...state,
            workflowV2: {
              ...state.workflowV2,
              view: 'workspace',
              resumeView: 'workspace',
              workspaceFocusModule: 'detail',
            },
          }
        : state

    case 'BEGIN_V2_COPY_REQUEST':
      if (!copyPendingMatches(state, action.pending, false) || state.workflowV2.pendingCopyRequest) {
        return state
      }
      return {
        ...state,
        platformCopy: {
          ...state.platformCopy,
          copyGenerationError: '',
          requestBusy: true,
          pendingCopyFingerprint: action.pending.fingerprintSha256,
          pendingIdempotencyKey: action.pending.idempotencyKey,
        },
        workflowV2: {
          ...state.workflowV2,
          pendingCopyRequest: action.pending,
          copyRequestFailure: null,
        },
      }

    case 'COMMIT_V2_COPY_REQUEST':
      if (!copyPendingMatches(state, action.pending)) {
        // A late response must still clear the matching in-flight request so
        // the loading chrome cannot remain stuck after ownership drifted.
        const active = state.workflowV2.pendingCopyRequest
        if (!active || active.requestId !== action.pending.requestId) return state
        return {
          ...state,
          platformCopy: {
            ...state.platformCopy,
            requestBusy: false,
            pendingCopyFingerprint: null,
            pendingIdempotencyKey: null,
          },
          workflowV2: {
            ...state.workflowV2,
            pendingCopyRequest: null,
          },
        }
      }
      if (
        action.variants.length === 0 ||
        action.generationPlatform !== state.platformCopy.platform ||
        action.generationStyle !== state.platformCopy.style
      ) {
        return {
          ...state,
          platformCopy: {
            ...state.platformCopy,
            requestBusy: false,
            pendingCopyFingerprint: null,
            pendingIdempotencyKey: null,
          },
          workflowV2: {
            ...state.workflowV2,
            pendingCopyRequest: null,
          },
        }
      }
      {
        const variants = action.variants.slice(0, 3)
        const first = variants[0]
        return {
          ...state,
          platformCopy: {
            ...state.platformCopy,
            variants,
            selectedVariantIndex: 0,
            copyDraft: first.body,
            platformCopy: { ...first, body: first.body },
            generationPlatform: action.generationPlatform,
            generationStyle: action.generationStyle,
            marketingStrategy: { ...action.marketingStrategy },
            strategyOwner: {
              sourceKind: 'copy',
              intentFingerprint: action.pending.fingerprintSha256,
              idempotencyKey: action.pending.idempotencyKey,
              requestId: action.requestId,
              platform: action.generationPlatform,
              style: action.generationStyle,
            },
            copyGenerationError: '',
            requestBusy: false,
            pendingCopyFingerprint: null,
            pendingIdempotencyKey: null,
          },
          workflowV2: {
            ...state.workflowV2,
            pendingCopyRequest: null,
            copyRequestFailure: null,
            generatedCopyInputSignatureSha256:
              action.pending.expectedCopyInputSignatureSha256,
          },
        }
      }

    case 'FAIL_V2_COPY_REQUEST':
      if (!copyPendingMatches(state, action.pending)) {
        const active = state.workflowV2.pendingCopyRequest
        if (!active || active.requestId !== action.pending.requestId) return state
        return {
          ...state,
          platformCopy: {
            ...state.platformCopy,
            requestBusy: false,
            pendingCopyFingerprint: null,
            pendingIdempotencyKey: null,
          },
          workflowV2: {
            ...state.workflowV2,
            pendingCopyRequest: null,
          },
        }
      }
      return {
        ...state,
        platformCopy: {
          ...state.platformCopy,
          copyGenerationError: action.message,
          requestBusy: false,
          pendingCopyFingerprint: null,
          pendingIdempotencyKey: null,
        },
        workflowV2: {
          ...state.workflowV2,
          pendingCopyRequest: null,
          copyRequestFailure: {
            ownerInputSignatureSha256:
              action.pending.expectedCopyInputSignatureSha256,
            error: action.error,
          },
        },
      }

    case 'CANCEL_V2_COPY_REQUEST': {
      const active = state.workflowV2.pendingCopyRequest
      if (!active || active.requestId !== action.pending.requestId) return state
      return {
        ...state,
        platformCopy: {
          ...state.platformCopy,
          requestBusy: false,
          pendingCopyFingerprint: null,
          pendingIdempotencyKey: null,
        },
        workflowV2: {
          ...state.workflowV2,
          pendingCopyRequest: null,
        },
      }
    }

    case 'COMMIT_V2_CONFIRMED_COPY':
    case 'COMMIT_V2_CONFIRMED_COPY_AND_RETURN': {
      const basic = state.workflowV2.basicAuthority
      const advice = state.workflowV2.adviceAuthority
      const copy = action.copy
      if (
        state.workflowV2.phase !== 'active' ||
        !basic ||
        !advice ||
        state.workflowV2.pendingCopyRequest ||
        !isAdviceCurrentForBasic(advice, basic) ||
        !isConfirmedCopyInternallyConsistent(copy) ||
        copy.input.basicOwner.textSignatureSha256 !== basic.text.signatureSha256 ||
        copy.input.basicOwner.settingsSignatureSha256 !== basic.settings.signatureSha256 ||
        !sameAdviceOwner(copy.input.adviceOwner, adviceOwnerFromAuthority(advice)) ||
        copy.platform !== basic.settings.platform ||
        copy.style !== basic.settings.style ||
        copy.platform !== state.platformCopy.platform ||
        copy.style !== state.platformCopy.style ||
        copy.body !== state.platformCopy.copyDraft ||
        state.platformCopy.selectedVariantIndex === null ||
        !state.platformCopy.strategyOwner
      ) return state
      const previous = state.workflowV2.confirmedCopy
      if (
        previous &&
        confirmedCopyMatchesCurrentOwners(state) &&
        previous.body === copy.body &&
        previous.title === copy.title &&
        previous.headline === copy.headline &&
        previous.subline === copy.subline
      ) return state
      const selected = selectedVariant(
        state.platformCopy.variants,
        state.platformCopy.selectedVariantIndex,
      )
      if (!selected) return state
      const platformCopy = {
        ...selected,
        body: copy.body,
        title: copy.title,
        headline: copy.headline,
        subline: copy.subline,
      }
      const completedSteps = new Set(state.completedSteps)
      completedSteps.add(2)
      return {
        ...state,
        completedSteps,
        platformCopy: {
          ...state.platformCopy,
          platformCopy,
          completedDraft: {
            platform: copy.platform,
            style: copy.style,
            copyDraft: copy.body,
            platformCopy: { ...platformCopy },
            variants: state.platformCopy.variants.map((item) => ({ ...item })),
            selectedVariantIndex: state.platformCopy.selectedVariantIndex,
            generationPlatform: copy.platform,
            generationStyle: copy.style,
            marketingStrategy: { ...state.platformCopy.marketingStrategy },
            strategyOwner: { ...state.platformCopy.strategyOwner },
          },
        },
        workflowV2: {
          ...state.workflowV2,
          confirmedCopy: copy,
          copyRequestFailure: null,
          ...(action.type === 'COMMIT_V2_CONFIRMED_COPY_AND_RETURN'
            ? {
                view: 'workspace' as const,
                resumeView: 'workspace' as const,
                workspaceFocusModule: 'copy' as const,
              }
            : {}),
        },
      }
    }

    case 'RESET_WORKFLOW':
      return createInitialWorkflowState()
  }
}

function reconcileStep6Completion(state: WorkflowState): WorkflowState {
  if (!state.marketingStrategyStep.completion || isCurrentStep6Completion(state)) {
    return state
  }
  return {
    ...state,
    completedSteps: withoutCompletedStep(state.completedSteps, 6),
    marketingStrategyStep: createInitialMarketingStrategyStepState(),
  }
}

function reconcileFinalResults(state: WorkflowState): WorkflowState {
  if (state.currentStep !== 7 || selectFinalResultsViewModel(state)) {
    return state
  }
  return { ...state, currentStep: 6 }
}

export function workflowReducer(
  state: WorkflowState,
  action: WorkflowAction,
): WorkflowState {
  return reconcileFinalResults(
    reconcileStep6Completion(reduceWorkflowState(state, action)),
  )
}

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react'
import type { ReactNode } from 'react'
import { flushSync } from 'react-dom'
import {
  WorkflowDispatchContext,
  WorkflowAdviceCommandsContext,
  WorkflowCopyCommandsContext,
  WorkflowDetailCommandsContext,
  WorkflowStateContext,
} from './workflow-context'
import {
  createInitialWorkflowState,
  workflowReducer,
} from './workflow-reducer'
import type { WorkflowAction, WorkflowState } from './workflow-types'
import {
  fetchMarketingAdvice,
  MarketingAdviceApiError,
  requestPayloadFromBasicText,
} from '../features/marketing-advice/advice-api'
import { syncCreationHistoryFromWorkflow } from '../features/creation-history/creation-history-archive'
import {
  createBasicAuthority,
  createConfirmedCopy,
  createDetailOwner,
  createCopyInputAuthority,
  createPresentAdviceAuthority,
  isAdviceCurrentForBasic,
  isConfirmedPosterCurrent,
  isConfirmedPosterInternallyConsistent,
  posterRefFromConfirmedPoster,
  samePosterRef,
} from './workflow-v2/workflow-v2-authorities'
import {
  createV2DetailProject,
  detailProjectMatchesPosterRef,
} from '../features/detail-editor/v2-detail-adapter'
import { domainSeparatedSignatureSha256 } from './workflow-v2/workflow-v2-signatures'
import {
  CopyApiError,
  EMPTY_COPY_RESULT_MESSAGE,
  generatePlatformCopy,
} from '../features/platform-copy/copy-api'
import {
  buildCopyOnlyPayload,
  canonicalJson,
  copyIntentFingerprint,
} from '../features/platform-copy/copy-fingerprint'
import { isTerminalSequenceStatus } from '../features/poster-generation/poster-normalizer'
import type { BasicAuthority } from './workflow-v2/workflow-v2-types'
import type {
  PendingAdviceRequest,
  PendingCopyRequest,
} from './workflow-v2/workflow-v2-session'

interface WorkflowProviderProps {
  children: ReactNode
  initialState?: WorkflowState
}

interface HistorySyncJob {
  key: string
  state: WorkflowState
}

interface HistorySyncCoordinator {
  enqueue(key: string, state: WorkflowState): void
  resume(): void
  suspend(): void
}

function reportHistorySyncError(error: unknown): void {
  if (typeof globalThis.reportError === 'function') {
    globalThis.reportError(error)
    return
  }

  globalThis.dispatchEvent(new ErrorEvent('error', {
    error,
    message: error instanceof Error ? error.message : String(error),
  }))
}

function createHistorySyncCoordinator(
  sync: (state: WorkflowState) => Promise<void>,
  reportError: (error: unknown) => void,
): HistorySyncCoordinator {
  const queue: HistorySyncJob[] = []
  const queuedKeys = new Set<string>()
  let accepting = false
  let activeKey: string | null = null
  let ownedDrain: Promise<void> | null = null

  const drain = async () => {
    try {
      while (queue.length > 0) {
        const job = queue.shift()
        if (!job) continue
        queuedKeys.delete(job.key)
        activeKey = job.key
        try {
          await sync(job.state)
        } catch (error) {
          reportError(error)
        } finally {
          activeKey = null
        }
      }
    } finally {
      ownedDrain = null
      if (queue.length > 0) startDrain()
    }
  }

  const startDrain = () => {
    if (ownedDrain || queue.length === 0) return
    ownedDrain = drain()
  }

  return {
    enqueue(key, state) {
      if (!accepting || activeKey === key || queuedKeys.has(key)) return
      queuedKeys.add(key)
      queue.push({ key, state })
      startDrain()
    },
    resume() {
      accepting = true
      startDrain()
    },
    suspend() {
      accepting = false
      startDrain()
    },
  }
}

export function WorkflowProvider({
  children,
  initialState,
}: WorkflowProviderProps) {
  const [state, reducerDispatch] = useReducer(
    workflowReducer,
    initialState ?? createInitialWorkflowState(),
  )
  const stateRef = useRef(state)
  const retainedImageRef = useRef(state.productInfo.productImage)
  const posterGenerationRef = useRef(state.posterGeneration)
  const releasedObjectUrlsRef = useRef(new Set<string>())
  const queuedObjectUrlRevocationsRef = useRef(new Set<string>())
  const adviceRequestRef = useRef<{
    pending: PendingAdviceRequest
    controller: AbortController
  } | null>(null)
  const copyRequestRef = useRef<{
    pending: PendingCopyRequest
    controller: AbortController
  } | null>(null)
  const copyPreparationRef = useRef(false)
  const detailEntryAdmissionRef = useRef(false)
  const [historySyncCoordinator] = useState(() =>
    createHistorySyncCoordinator(
      syncCreationHistoryFromWorkflow,
      reportHistorySyncError,
    ),
  )

  const revokeOnce = useCallback((objectUrl: string) => {
    if (releasedObjectUrlsRef.current.has(objectUrl)) return
    releasedObjectUrlsRef.current.add(objectUrl)
    URL.revokeObjectURL(objectUrl)
  }, [])

  const queueObjectUrlRevocation = useCallback((objectUrl: string) => {
    if (releasedObjectUrlsRef.current.has(objectUrl)) return
    queuedObjectUrlRevocationsRef.current.add(objectUrl)
  }, [])

  const releaseWorkflowObjectUrls = useCallback((workflow: WorkflowState) => {
    const objectUrls = new Set<string>()
    if (workflow.productInfo.productImage?.previewUrl) {
      objectUrls.add(workflow.productInfo.productImage.previewUrl)
    }
    for (const binary of Object.values(workflow.posterGeneration.posterBinaries)) {
      if (binary.preview.objectUrl) objectUrls.add(binary.preview.objectUrl)
      if (binary.download.objectUrl) objectUrls.add(binary.download.objectUrl)
    }
    if (workflow.posterGeneration.zipBinary.objectUrl) {
      objectUrls.add(workflow.posterGeneration.zipBinary.objectUrl)
    }
    objectUrls.forEach(queueObjectUrlRevocation)
  }, [queueObjectUrlRevocation])

  const releasePosterObjectUrls = useCallback((workflow: WorkflowState) => {
    const objectUrls = new Set<string>()
    for (const binary of Object.values(workflow.posterGeneration.posterBinaries)) {
      if (binary.preview.objectUrl) objectUrls.add(binary.preview.objectUrl)
      if (binary.download.objectUrl) objectUrls.add(binary.download.objectUrl)
    }
    if (workflow.posterGeneration.zipBinary.objectUrl) {
      objectUrls.add(workflow.posterGeneration.zipBinary.objectUrl)
    }
    objectUrls.forEach(queueObjectUrlRevocation)
  }, [queueObjectUrlRevocation])

  const cancelAdviceRequest = useCallback((dispatchCancel: boolean) => {
    const active = adviceRequestRef.current
    if (!active) return null
    adviceRequestRef.current = null
    active.controller.abort()
    if (dispatchCancel) {
      reducerDispatch({ type: 'CANCEL_V2_ADVICE_REQUEST', ...active.pending })
    }
    return active.pending
  }, [])

  const cancelCopyRequest = useCallback((dispatchCancel: boolean) => {
    const active = copyRequestRef.current
    if (!active) return null
    copyRequestRef.current = null
    copyPreparationRef.current = false
    active.controller.abort()
    if (dispatchCancel) {
      reducerDispatch({ type: 'CANCEL_V2_COPY_REQUEST', pending: active.pending })
    }
    return active.pending
  }, [])

  const requestAdvice = useCallback((input: {
    readonly authority: BasicAuthority
    readonly workflowEpoch: number
    readonly draftRevision: number
  }) => {
    if (adviceRequestRef.current) return
    const pending: PendingAdviceRequest = {
      requestId: globalThis.crypto.randomUUID(),
      workflowEpoch: input.workflowEpoch,
      draftRevision: input.draftRevision,
      expectedInputSignatureSha256:
        input.authority.text.adviceInputSignatureSha256,
      basicTextSignatureSha256: input.authority.text.signatureSha256,
    }
    const controller = new AbortController()
    adviceRequestRef.current = { pending, controller }
    reducerDispatch({ type: 'BEGIN_V2_ADVICE_REQUEST', pending })

    void (async () => {
      try {
        const response = await fetchMarketingAdvice(
          requestPayloadFromBasicText(input.authority.text.values),
          { signal: controller.signal },
        )
        const authority = await createPresentAdviceAuthority(response, input.authority)
        // The reducer owns the authoritative freshness decision. Avoid using a
        // render-phase ref here: an immediately resolved local response can
        // otherwise observe the pre-commit render and be rejected incorrectly.
        reducerDispatch({ type: 'COMMIT_V2_ADVICE', ...pending, authority })
      } catch (error) {
        if (
          (error instanceof DOMException && error.name === 'AbortError') ||
          (typeof error === 'object' && error !== null && 'name' in error &&
            (error as { name?: unknown }).name === 'AbortError')
        ) return
        const adviceError = error instanceof MarketingAdviceApiError
          ? error.kind
          : 'network_server'
        reducerDispatch({
          type: 'FAIL_V2_ADVICE_REQUEST',
          ...pending,
          error: adviceError,
        })
      } finally {
        if (adviceRequestRef.current?.pending.requestId === pending.requestId) {
          adviceRequestRef.current = null
        }
      }
    })()
  }, [])

  const retryAdvice = useCallback(() => {
    const current = stateRef.current.workflowV2
    if (
      current.phase !== 'active' ||
      !current.basicAuthority ||
      current.pendingAdviceRequest ||
      adviceRequestRef.current
    ) return
    requestAdvice({
      authority: current.basicAuthority,
      workflowEpoch: current.epoch,
      draftRevision: current.basicDraftRevision,
    })
  }, [requestAdvice])

  const syncBasicSettingsToPlatformCopy = useCallback(async () => {
    const captured = stateRef.current
    const session = captured.workflowV2
    const basic = session.basicAuthority
    if (session.phase !== 'active' || !basic) return null
    const platform = captured.platformCopy.platform
    const style = captured.platformCopy.style
    if (
      basic.settings.platform === platform &&
      basic.settings.style === style
    ) {
      return basic
    }
    const productImage =
      basic.productImage.kind === 'present'
        ? {
            byteSha256: basic.productImage.byteSha256,
            mimeType: basic.productImage.mimeType,
            byteSize: basic.productImage.byteSize,
          }
        : null
    const authority = await createBasicAuthority({
      ...basic.text.values,
      platform,
      style,
      productImage,
    })
    const live = stateRef.current
    if (
      live.workflowV2.phase !== 'active' ||
      live.workflowV2.epoch !== session.epoch ||
      live.platformCopy.platform !== platform ||
      live.platformCopy.style !== style
    ) {
      return null
    }
    flushSync(() => {
      reducerDispatch({
        type: 'COMMIT_V2_BASIC_AUTHORITY',
        workflowEpoch: live.workflowV2.epoch,
        draftRevision: live.workflowV2.basicDraftRevision,
        authority,
      })
    })
    return stateRef.current.workflowV2.basicAuthority
  }, [])

  const requestCopy = useCallback((options?: { readonly force?: boolean }) => {
    if (copyPreparationRef.current || copyRequestRef.current) return
    const force = Boolean(options?.force)
    const captured = stateRef.current
    const session = captured.workflowV2
    if (
      session.phase !== 'active' ||
      !session.basicAuthority ||
      !session.adviceAuthority ||
      !isAdviceCurrentForBasic(session.adviceAuthority, session.basicAuthority) ||
      session.pendingCopyRequest ||
      captured.platformCopy.requestBusy
    ) return
    copyPreparationRef.current = true
    void (async () => {
      try {
        const basic = await syncBasicSettingsToPlatformCopy()
        const liveAfterSync = stateRef.current
        const advice = liveAfterSync.workflowV2.adviceAuthority
        if (
          !basic ||
          !advice ||
          !isAdviceCurrentForBasic(advice, basic) ||
          liveAfterSync.workflowV2.pendingCopyRequest ||
          liveAfterSync.platformCopy.requestBusy ||
          copyRequestRef.current
        ) return
        const platform = liveAfterSync.platformCopy.platform
        const style = liveAfterSync.platformCopy.style
        if (
          basic.settings.platform !== platform ||
          basic.settings.style !== style
        ) return
        const copyInput = await createCopyInputAuthority(basic, advice)
        const reference = {
          advice_version: advice.adviceVersion,
          input_signature_sha256: advice.inputSignatureSha256,
          advice_signature_sha256: advice.adviceSignatureSha256,
        } as const
        const payload = buildCopyOnlyPayload(
          basic.text.values,
          platform,
          style,
          reference,
        )
        const canonicalPayload = canonicalJson(payload)
        const fingerprintSha256 = await copyIntentFingerprint(canonicalPayload)
        const live = stateRef.current
        const liveSession = live.workflowV2
        const liveBasic = liveSession.basicAuthority
        if (
          liveSession.phase !== 'active' ||
          !liveBasic ||
          liveSession.epoch !== liveAfterSync.workflowV2.epoch ||
          live.platformCopy.platform !== platform ||
          live.platformCopy.style !== style ||
          liveBasic.settings.platform !== platform ||
          liveBasic.settings.style !== style ||
          liveBasic.settings.signatureSha256 !== basic.settings.signatureSha256 ||
          liveBasic.text.signatureSha256 !== basic.text.signatureSha256 ||
          liveSession.adviceAuthority?.inputSignatureSha256 !== advice.inputSignatureSha256 ||
          liveSession.adviceAuthority?.adviceSignatureSha256 !== advice.adviceSignatureSha256 ||
          liveSession.pendingCopyRequest ||
          copyRequestRef.current
        ) return
        // The exact same current candidates are already reusable. This also
        // makes a fast double click a single explicit generation command.
        // An explicit regenerate (force) must bypass that reuse guard.
        if (
          !force &&
          liveSession.generatedCopyInputSignatureSha256 ===
            copyInput.inputSignatureSha256 &&
          live.platformCopy.variants.length > 0
        ) return
        const pending: PendingCopyRequest = {
          requestId: globalThis.crypto.randomUUID(),
          workflowEpoch: liveSession.epoch,
          basicDraftRevision: liveSession.basicDraftRevision,
          copyDraftRevision: liveSession.copyDraftRevision,
          basicTextSignatureSha256: liveBasic.text.signatureSha256,
          basicSettingsSignatureSha256: liveBasic.settings.signatureSha256,
          adviceInputSignatureSha256: advice.inputSignatureSha256,
          adviceSignatureSha256: advice.adviceSignatureSha256,
          expectedCopyInputSignatureSha256: copyInput.inputSignatureSha256,
          fingerprintSha256,
          idempotencyKey: globalThis.crypto.randomUUID(),
        }
        const controller = new AbortController()
        copyRequestRef.current = { pending, controller }
        reducerDispatch({ type: 'BEGIN_V2_COPY_REQUEST', pending })
        try {
          const result = await generatePlatformCopy(
            canonicalPayload,
            pending.idempotencyKey,
            { signal: controller.signal },
          )
          if (result.variants.length === 0) {
            reducerDispatch({
              type: 'FAIL_V2_COPY_REQUEST',
              pending,
              error: 'protocol',
              message: EMPTY_COPY_RESULT_MESSAGE,
            })
            return
          }
          reducerDispatch({
            type: 'COMMIT_V2_COPY_REQUEST',
            pending,
            variants: result.variants,
            marketingStrategy: result.marketingStrategy,
            requestId: result.requestId,
            generationPlatform: platform,
            generationStyle: style,
          })
        } catch (error) {
          if (controller.signal.aborted) return
          reducerDispatch({
            type: 'FAIL_V2_COPY_REQUEST',
            pending,
            error: error instanceof CopyApiError ? error.kind : 'network_server',
            message: error instanceof CopyApiError
              ? error.userMessage
              : '暂时无法生成文案，请稍后重试。',
          })
        } finally {
          if (copyRequestRef.current?.pending.requestId === pending.requestId) {
            copyRequestRef.current = null
          }
        }
      } catch {
        // Setup failures never commit a partial request or authority.
        const live = stateRef.current
        const pending = live.workflowV2.pendingCopyRequest
        if (pending) {
          reducerDispatch({
            type: 'FAIL_V2_COPY_REQUEST',
            pending,
            error: 'protocol',
            message: '文案生成请求准备失败，请重试。',
          })
        }
      } finally {
        copyPreparationRef.current = false
      }
    })()
  }, [syncBasicSettingsToPlatformCopy])

  const retryCopy = useCallback(() => {
    requestCopy()
  }, [requestCopy])

  const confirmCopy = useCallback(() => {
    const captured = stateRef.current
    const session = captured.workflowV2
    const selectedIndex = captured.platformCopy.selectedVariantIndex
    const selected = selectedIndex === null
      ? null
      : captured.platformCopy.variants[selectedIndex] ?? null
    if (
      session.phase !== 'active' ||
      !session.basicAuthority ||
      !session.adviceAuthority ||
      !selected ||
      !captured.platformCopy.copyDraft.trim() ||
      !captured.platformCopy.strategyOwner ||
      session.pendingCopyRequest
    ) return
    void (async () => {
      const basic = await syncBasicSettingsToPlatformCopy()
      const current = stateRef.current
      const currentSession = current.workflowV2
      const advice = currentSession.adviceAuthority
      const liveSelectedIndex = current.platformCopy.selectedVariantIndex
      const liveSelected = liveSelectedIndex === null
        ? null
        : current.platformCopy.variants[liveSelectedIndex] ?? null
      if (
        !basic ||
        !advice ||
        !liveSelected ||
        !isAdviceCurrentForBasic(advice, basic) ||
        currentSession.phase !== 'active' ||
        currentSession.pendingCopyRequest ||
        !current.platformCopy.strategyOwner ||
        basic.settings.platform !== current.platformCopy.platform ||
        basic.settings.style !== current.platformCopy.style
      ) return
      const input = await createCopyInputAuthority(basic, advice)
      const fields = {
        body: current.platformCopy.copyDraft,
        title: String(liveSelected.title ?? ''),
        headline: String(liveSelected.headline ?? ''),
        subline: String(liveSelected.subline ?? ''),
      }
      const latest = stateRef.current
      const latestSession = latest.workflowV2
      if (
        latestSession.phase !== 'active' ||
        latestSession.epoch !== currentSession.epoch ||
        latestSession.basicDraftRevision !== currentSession.basicDraftRevision ||
        latestSession.copyDraftRevision !== currentSession.copyDraftRevision ||
        latestSession.basicAuthority?.text.signatureSha256 !== basic.text.signatureSha256 ||
        latestSession.basicAuthority?.settings.signatureSha256 !== basic.settings.signatureSha256 ||
        latestSession.adviceAuthority?.inputSignatureSha256 !== advice.inputSignatureSha256 ||
        latestSession.adviceAuthority?.adviceSignatureSha256 !== advice.adviceSignatureSha256 ||
        latest.platformCopy.copyDraft !== fields.body ||
        latest.platformCopy.platform !== basic.settings.platform ||
        latest.platformCopy.style !== basic.settings.style
      ) return
      const previous = latestSession.confirmedCopy
      if (
        previous &&
        previous.input.inputSignatureSha256 === input.inputSignatureSha256 &&
        previous.body === fields.body &&
        previous.title === fields.title &&
        previous.headline === fields.headline &&
        previous.subline === fields.subline
      ) {
        reducerDispatch({ type: 'RETURN_FROM_V2_COPY' })
        return
      }
      const generated =
        latestSession.generatedCopyInputSignatureSha256 === input.inputSignatureSha256 &&
        latest.platformCopy.strategyOwner !== null
      const source = generated
        ? {
            kind: 'generated' as const,
            requestFingerprintSha256:
              latest.platformCopy.strategyOwner!.intentFingerprint,
            selectedVariantIndex: latest.platformCopy.selectedVariantIndex ?? 0,
            variantSignatureSha256: await domainSeparatedSignatureSha256(
              'workflow-v2-copy-variant-v1',
              liveSelected,
            ),
          }
        : {
            kind: 'manual' as const,
            baseOutputSignatureSha256: previous?.outputSignatureSha256 ?? null,
          }
      const copy = await createConfirmedCopy({
        copyInput: input,
        revision: previous ? previous.revision + 1 : 1,
        source,
        fields,
      })
      reducerDispatch({ type: 'COMMIT_V2_CONFIRMED_COPY_AND_RETURN', copy })
    })()
  }, [syncBasicSettingsToPlatformCopy])

  const enterDetail = useCallback((forceNew = false) => {
    if (detailEntryAdmissionRef.current) return
    const captured = stateRef.current
    const session = captured.workflowV2
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
    ) return
    const posterRef = posterRefFromConfirmedPoster(poster)
    const existing = session.detailProject
    if (detailProjectMatchesPosterRef(existing, posterRef)) {
      reducerDispatch({ type: 'ENTER_V2_LEGACY_DETAIL' })
      return
    }
    if (existing && !forceNew) {
      reducerDispatch({ type: 'SHOW_V2_DETAIL_UPDATE' })
      return
    }
    const legacyPoster = captured.posterEditor.confirmedPoster
    if (
      !legacyPoster ||
      legacyPoster.generationId !== posterRef.generationId ||
      legacyPoster.posterId !== posterRef.posterId ||
      legacyPoster.inputSignatureSha256 !== posterRef.compositionInputSignatureSha256 ||
      legacyPoster.pngBlobSha256 !== posterRef.pngBlobSha256
    ) return
    detailEntryAdmissionRef.current = true
    const capture = {
      epoch: session.epoch,
      posterRef,
      blob: legacyPoster.pngBlob,
      generationId: legacyPoster.generationId,
      posterId: legacyPoster.posterId,
      inputSignatureSha256: legacyPoster.inputSignatureSha256,
      pngBlobSha256: legacyPoster.pngBlobSha256,
    }
    void (async () => {
      try {
        const [{ validateStepFiveEntryPoster }, owner] = await Promise.all([
          import('../features/detail-editor/detail-resources'),
          createDetailOwner(capture.posterRef),
        ])
        const entry = await validateStepFiveEntryPoster(legacyPoster)
        const live = stateRef.current
        const liveSession = live.workflowV2
        const livePoster = liveSession.confirmedPoster
        const liveLegacyPoster = live.posterEditor.confirmedPoster
        if (
          liveSession.phase !== 'active' ||
          liveSession.epoch !== capture.epoch ||
          !livePoster ||
          !liveLegacyPoster ||
          !samePosterRef(posterRefFromConfirmedPoster(livePoster), capture.posterRef) ||
          liveLegacyPoster.generationId !== capture.generationId ||
          liveLegacyPoster.posterId !== capture.posterId ||
          liveLegacyPoster.inputSignatureSha256 !== capture.inputSignatureSha256 ||
          liveLegacyPoster.pngBlobSha256 !== capture.pngBlobSha256 ||
          liveLegacyPoster.pngBlob !== capture.blob
        ) return
        const project = createV2DetailProject(owner)
        reducerDispatch({
          type: 'COMMIT_V2_DETAIL_ENTRY',
          project,
          legacyOwner: entry.owner,
          posterResource: entry.resource,
        })
      } catch {
        const live = stateRef.current.workflowV2
        if (live.phase === 'active' && live.epoch === capture.epoch) {
          reducerDispatch({
            type: 'FAIL_V2_DETAIL_ENTRY',
            error: '无法验证当前海报，请重新确认海报后再试。',
          })
        }
      } finally {
        detailEntryAdmissionRef.current = false
      }
    })()
  }, [])

  const dispatch = useCallback((action: WorkflowAction) => {
    if (
      action.type === 'GO_TO_STEP_ONE' ||
      action.type === 'START_V2_CREATION' ||
      action.type === 'RESET_WORKFLOW' ||
      action.type === 'V2_RETURN_HOME' ||
      action.type === 'ENTER_V2_ADVICE' ||
      action.type === 'ENTER_V2_WORKSPACE' ||
      action.type === 'ENTER_V2_POSTER' ||
      action.type === 'ENTER_V2_LEGACY_DETAIL' ||
      action.type === 'ENTER_V2_RESULTS' ||
      action.type === 'RETURN_FROM_V2_COPY' ||
      action.type === 'RETURN_FROM_V2_POSTER' ||
      action.type === 'RETURN_FROM_V2_DETAIL' ||
      action.type === 'RETURN_FROM_V2_RESULTS' ||
      action.type === 'UPDATE_STEP_ONE_FIELD' ||
      action.type === 'REPLACE_STEP_ONE_IMAGE' ||
      action.type === 'REMOVE_STEP_ONE_IMAGE' ||
      action.type === 'UPDATE_STEP_TWO_PLATFORM' ||
      action.type === 'UPDATE_STEP_TWO_STYLE' ||
      action.type === 'UPDATE_STEP_TWO_DRAFT' ||
      action.type === 'SELECT_STEP_TWO_VARIANT'
    ) {
      cancelAdviceRequest(true)
      cancelCopyRequest(true)
    }
    if (action.type === 'COMMIT_V2_POSTER_PROJECT') {
      releasePosterObjectUrls(stateRef.current)
    }
    if (action.type === 'CANCEL_PENDING_POSTER_WORK') {
      const generation = stateRef.current.posterGeneration
      const hasPendingWork = generation.admissionBusy || Boolean(
        generation.activeGenerationId &&
          generation.result &&
          generation.result.generationId === generation.activeGenerationId &&
          !isTerminalSequenceStatus(generation.result.status),
      )
      if (hasPendingWork) releasePosterObjectUrls(stateRef.current)
    }
    if (action.type === 'RESET_WORKFLOW' || action.type === 'START_V2_CREATION') {
      releaseWorkflowObjectUrls(stateRef.current)
    }
    reducerDispatch(action)
  }, [cancelAdviceRequest, cancelCopyRequest, releasePosterObjectUrls, releaseWorkflowObjectUrls])

  useLayoutEffect(() => {
    stateRef.current = state
    retainedImageRef.current = state.productInfo.productImage
    posterGenerationRef.current = state.posterGeneration
  }, [state])

  const historySyncKey = [
    state.workflowV2.epoch,
    state.workflowV2.confirmedCopy?.outputSignatureSha256 ?? '',
    state.workflowV2.confirmedPoster?.outputSignatureSha256 ?? '',
    state.workflowV2.confirmedDetail?.outputSignatureSha256 ?? '',
    state.workflowV2.currentDetailOutputSignatureSha256 ?? '',
    state.posterEditor.confirmedPoster?.pngBlobSha256 ?? '',
    state.posterEditor.currentLayoutSha256 ?? '',
    state.detailEditor.confirmedDetails?.pageExports.map((page) => page.pngBlobSha256).join('|') ?? '',
  ].join(':')

  useEffect(() => {
    historySyncCoordinator.resume()
    return () => {
      historySyncCoordinator.suspend()
    }
  }, [historySyncCoordinator])

  useEffect(() => {
    historySyncCoordinator.enqueue(historySyncKey, stateRef.current)
  }, [historySyncCoordinator, historySyncKey])

  useEffect(() => {
    const queued = [...queuedObjectUrlRevocationsRef.current]
    queuedObjectUrlRevocationsRef.current.clear()
    queued.forEach(revokeOnce)
  }, [state, revokeOnce])

  useEffect(() => {
    const queuedObjectUrlRevocations = queuedObjectUrlRevocationsRef.current
    return () => {
      cancelAdviceRequest(false)
      cancelCopyRequest(false)
      const retainedImage = retainedImageRef.current
      if (retainedImage) {
        revokeOnce(retainedImage.previewUrl)
      }
      const objectUrls = new Set<string>()
      for (const binary of Object.values(
        posterGenerationRef.current.posterBinaries,
      )) {
        if (binary.preview.objectUrl) {
          objectUrls.add(binary.preview.objectUrl)
        }
        if (binary.download.objectUrl) {
          objectUrls.add(binary.download.objectUrl)
        }
      }
      if (posterGenerationRef.current.zipBinary.objectUrl) {
        objectUrls.add(posterGenerationRef.current.zipBinary.objectUrl)
      }
      for (const objectUrl of queuedObjectUrlRevocations) {
        objectUrls.add(objectUrl)
      }
      queuedObjectUrlRevocations.clear()
      for (const objectUrl of objectUrls) {
        revokeOnce(objectUrl)
      }
    }
  }, [cancelAdviceRequest, cancelCopyRequest, revokeOnce])

  const adviceCommands = useMemo(
    () => ({ requestAdvice, retryAdvice }),
    [requestAdvice, retryAdvice],
  )
  const copyCommands = useMemo(
    () => ({
      requestCopy,
      retryCopy,
      confirmCopy,
      cancelCopy: () => {
        cancelCopyRequest(true)
      },
    }),
    [cancelCopyRequest, confirmCopy, requestCopy, retryCopy],
  )
  const detailCommands = useMemo(
    () => ({
      enterDetail: () => enterDetail(false),
      startNewDetailProject: () => enterDetail(true),
    }),
    [enterDetail],
  )

  return (
    <WorkflowStateContext.Provider value={state}>
      <WorkflowDispatchContext.Provider value={dispatch}>
        <WorkflowAdviceCommandsContext.Provider value={adviceCommands}>
          <WorkflowCopyCommandsContext.Provider value={copyCommands}>
            <WorkflowDetailCommandsContext.Provider value={detailCommands}>
              {children}
            </WorkflowDetailCommandsContext.Provider>
          </WorkflowCopyCommandsContext.Provider>
        </WorkflowAdviceCommandsContext.Provider>
      </WorkflowDispatchContext.Provider>
    </WorkflowStateContext.Provider>
  )
}

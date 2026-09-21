import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useWorkflowDispatch, useWorkflowState } from '../../state/use-workflow'
import { POSTER_SLOT_TITLES } from '../../types/poster-generation'
import {
  acquirePendingSequenceIntent,
  canonicalSequenceJson,
  sequenceIntentFingerprint,
} from './poster-fingerprint'
import {
  createPosterSequence,
  fetchPosterPng,
  fetchPosterZip,
  POSTER_DOWNLOAD_ERROR_MESSAGE,
  PosterApiError,
  triggerBlobDownload,
  ZIP_DOWNLOAD_ERROR_MESSAGE,
} from './poster-api'
import {
  isEligibleReadySlot,
  isTerminalSequenceStatus,
  safeRelativeApiUrl,
} from './poster-normalizer'
import { getPosterSubmissionValidationError } from './poster-validation'
import { buildPosterSequencePayload, buildV2PosterSequencePayload } from './sequence-payload'
import { PosterConsentStatus } from './PosterConsentStatus'
import { PosterSlot } from './PosterSlot'
import { POSTER_STYLE_TEMPLATE_OPTIONS } from './poster-style-templates'
import { usePosterCapabilities } from './use-poster-capabilities'
import { usePosterPolling } from './use-poster-polling'
import { createDefaultPosterLayout, createProviderDirectPosterLayout } from '../poster-editor/poster-defaults'
import {
  decodeRasterBlob,
  POSTER_BASE_DECODE_MESSAGE,
} from '../poster-editor/poster-resources'
import {
  sha256Blob,
  upstreamSha256,
} from '../poster-editor/poster-signature'
import {
  createCopyInputAuthoritySync,
  isAdviceCurrentForBasic,
  isConfirmedCopyCurrent,
} from '../../state/workflow-v2/workflow-v2-authorities'
import type {
  PosterGenerationKind,
  PosterTypographyMode,
} from '../../state/workflow-v2/workflow-v2-types'
import type { PosterStyleTemplateId } from '../../types/poster-style-template'
import { PRODUCT_INFO_LIMITS } from '../../types/product-info'
import {
  createPosterProjectWithOptions,
  DEFAULT_POSTER_GENERATION_KIND,
  DEFAULT_POSTER_TYPOGRAPHY_MODE,
  defaultTemplateId,
  providerDirectPosterEnabled,
  posterProjectNeedsRefresh,
} from './poster-project-options'

const GENERATION_SETUP_ERROR_MESSAGE = '无法准备海报生成请求，请重试。'

export function PosterGenerationStep() {
  const workflow = useWorkflowState()
  const { platformCopy, posterEditor, posterGeneration, productInfo } = workflow
  const dispatch = useWorkflowDispatch()
  const immediateBusy = useRef(false)
  const projectAdmission = useRef(false)
  const projectCancellation = useRef(0)
  const modeFieldsetRef = useRef<HTMLFieldSetElement>(null)
  const styleTemplateFieldsetRef = useRef<HTMLFieldSetElement>(null)
  const styleAdmission = useRef(false)
  const styleCancellation = useRef(0)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const entryAdmission = useRef(false)
  const entryCancellation = useRef(0)
  const mounted = useRef(true)
  const latestWorkflow = useRef(workflow)
  const result = posterGeneration.result
  const [modeError, setModeError] = useState('')
  const [modeSwitchPending, setModeSwitchPending] = useState(false)
  const [styleTemplateError, setStyleTemplateError] = useState('')
  const [styleTemplateSwitchPending, setStyleTemplateSwitchPending] = useState(false)
  const session = workflow.workflowV2
  const v2PosterFlow = session.phase === 'active' && session.view === 'poster'
  const v2Basic = session.basicAuthority
  const v2Advice = session.adviceAuthority
  const v2Project = session.posterProject
  const v2Copy = session.confirmedCopy
  const v2CurrentCopy = (() => {
    if (!v2Copy || !v2Basic || !v2Advice || !isAdviceCurrentForBasic(v2Advice, v2Basic)) return null
    try {
      return isConfirmedCopyCurrent(v2Copy, createCopyInputAuthoritySync(v2Basic, v2Advice))
        ? v2Copy
        : null
    } catch {
      return null
    }
  })()

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      entryCancellation.current += 1
      if (v2PosterFlow) {
        // A V2 route exit unmounts this module while an admission request may
        // still be awaiting a non-cooperative transport. Invalidate the same
        // captured source token used by the source-switch guards so that a
        // late response cannot become the current project on re-entry.
        projectCancellation.current += 1
        styleCancellation.current += 1
        dispatch({ type: 'CANCEL_PENDING_POSTER_WORK' })
      }
    }
  }, [dispatch, v2PosterFlow])

  useEffect(() => {
    if (v2PosterFlow) headingRef.current?.focus({ preventScroll: true })
  }, [v2PosterFlow])

  useLayoutEffect(() => {
    latestWorkflow.current = workflow
  }, [workflow])

  usePosterCapabilities(posterGeneration.capabilities.status)
  usePosterPolling(
    modeSwitchPending || styleTemplateSwitchPending
      ? null
      : posterGeneration.activeGenerationId,
    result?.status ?? null,
    result,
  )

  const activeNonterminal = Boolean(
    posterGeneration.activeGenerationId &&
      result &&
      result.generationId === posterGeneration.activeGenerationId &&
      !isTerminalSequenceStatus(result.status),
  )
  const primaryDisabled =
    posterGeneration.capabilities.sequenceEnabled === false ||
    posterGeneration.admissionBusy ||
    activeNonterminal ||
    modeSwitchPending ||
    styleTemplateSwitchPending ||
    (v2PosterFlow && !v2Project)

  const templateOptions = POSTER_STYLE_TEMPLATE_OPTIONS.filter(
    (option) => option.styleTemplateId !== null,
  )

  const commitPosterProjectOptions = async (options: {
    generationKind: PosterGenerationKind
    typographyMode: PosterTypographyMode
    styleTemplateId: PosterStyleTemplateId | null
  }) => {
    if (projectAdmission.current || !v2PosterFlow || !v2Basic || !v2Advice) return
    if (!isAdviceCurrentForBasic(v2Advice, v2Basic)) return
    projectAdmission.current = true
    projectCancellation.current += 1
    immediateBusy.current = false
    setModeSwitchPending(true)
    setModeError('')
    setStyleTemplateError('')
    try {
      const project = await createPosterProjectWithOptions({
        projectId: globalThis.crypto.randomUUID(),
        basic: v2Basic,
        advice: v2Advice,
        confirmedCopy: v2CurrentCopy,
        generationKind: options.generationKind,
        typographyMode: options.typographyMode,
        styleTemplateId: options.styleTemplateId,
      })
      const live = latestWorkflow.current.workflowV2
      if (
        live.phase !== 'active' ||
        live.view !== 'poster' ||
        live.epoch !== session.epoch ||
        live.basicAuthority?.text.signatureSha256 !== v2Basic.text.signatureSha256 ||
        live.basicAuthority?.settings.signatureSha256 !== v2Basic.settings.signatureSha256 ||
        live.adviceAuthority?.inputSignatureSha256 !== v2Advice.inputSignatureSha256 ||
        live.adviceAuthority?.adviceSignatureSha256 !== v2Advice.adviceSignatureSha256
      ) return
      dispatch({ type: 'COMMIT_V2_POSTER_PROJECT', project })
    } catch {
      setModeError('无法准备海报生成方式，请重新选择。')
    } finally {
      projectAdmission.current = false
      setModeSwitchPending(false)
    }
  }

  useEffect(() => {
    if (!v2PosterFlow || !v2Basic || !v2Advice || projectAdmission.current) return
    if (!isAdviceCurrentForBasic(v2Advice, v2Basic)) return
    if (!posterProjectNeedsRefresh(v2Project, v2Basic, v2Advice, v2CurrentCopy)) return
    let cancelled = false
    const admissionId = projectCancellation.current + 1
    projectCancellation.current = admissionId
    projectAdmission.current = true
    immediateBusy.current = false
    const options = {
      generationKind: v2Project?.generationKind ?? DEFAULT_POSTER_GENERATION_KIND,
      typographyMode: v2Project?.typographyMode ?? DEFAULT_POSTER_TYPOGRAPHY_MODE,
      styleTemplateId:
        (v2Project?.generationKind ?? DEFAULT_POSTER_GENERATION_KIND) === 'template'
          ? v2Project?.styleTemplateId ?? defaultTemplateId()
          : null,
    }
    void Promise.resolve()
      .then(() => {
        if (cancelled || projectCancellation.current !== admissionId) return null
        setModeSwitchPending(true)
        setModeError('')
        setStyleTemplateError('')
        return createPosterProjectWithOptions({
          projectId: globalThis.crypto.randomUUID(),
          basic: v2Basic,
          advice: v2Advice,
          confirmedCopy: v2CurrentCopy,
          ...options,
        })
      })
      .then((project) => {
        if (!project || cancelled || projectCancellation.current !== admissionId) return
        const live = latestWorkflow.current.workflowV2
        if (
          live.phase !== 'active' ||
          live.view !== 'poster' ||
          live.epoch !== session.epoch ||
          live.basicAuthority?.text.signatureSha256 !== v2Basic.text.signatureSha256 ||
          live.basicAuthority?.settings.signatureSha256 !== v2Basic.settings.signatureSha256 ||
          live.adviceAuthority?.inputSignatureSha256 !== v2Advice.inputSignatureSha256 ||
          live.adviceAuthority?.adviceSignatureSha256 !== v2Advice.adviceSignatureSha256
        ) return
        dispatch({ type: 'COMMIT_V2_POSTER_PROJECT', project })
      })
      .catch(() => {
        if (!cancelled && projectCancellation.current === admissionId) {
          setModeError('无法准备海报生成方式，请重新选择。')
        }
      })
      .finally(() => {
        if (projectCancellation.current === admissionId) {
          projectAdmission.current = false
          setModeSwitchPending(false)
        }
      })
    return () => {
      cancelled = true
      if (projectCancellation.current === admissionId) {
        projectCancellation.current += 1
        projectAdmission.current = false
      }
    }
  }, [
    dispatch,
    v2PosterFlow,
    v2Basic,
    v2Advice,
    v2Project,
    v2CurrentCopy,
    session.epoch,
  ])

  const chooseGenerationKind = async (generationKind: PosterGenerationKind) => {
    if (!v2Project || v2Project.generationKind === generationKind) return
    await commitPosterProjectOptions({
      generationKind,
      typographyMode:
        generationKind === 'blank_base'
          ? 'textless'
          : v2Project.typographyMode,
      styleTemplateId:
        generationKind === 'blank_base'
          ? null
          : v2Project.styleTemplateId ?? defaultTemplateId(),
    })
  }

  const chooseTypographyMode = async (typographyMode: PosterTypographyMode) => {
    if (
      !v2Project ||
      v2Project.generationKind !== 'template' ||
      v2Project.typographyMode === typographyMode
    ) return
    await commitPosterProjectOptions({
      generationKind: 'template',
      typographyMode,
      styleTemplateId: v2Project.styleTemplateId ?? defaultTemplateId(),
    })
  }

  const chooseStyleTemplate = async (styleTemplateId: PosterStyleTemplateId) => {
    if (
      styleAdmission.current ||
      !v2PosterFlow ||
      !v2Basic ||
      !v2Advice ||
      !v2Project ||
      v2Project.generationKind !== 'template' ||
      !isAdviceCurrentForBasic(v2Advice, v2Basic) ||
      v2Project.styleTemplateId === styleTemplateId
    ) return
    styleAdmission.current = true
    styleCancellation.current += 1
    immediateBusy.current = false
    setStyleTemplateSwitchPending(true)
    setStyleTemplateError('')
    try {
      await commitPosterProjectOptions({
        generationKind: 'template',
        typographyMode: v2Project.typographyMode,
        styleTemplateId,
      })
    } catch {
      setStyleTemplateError('无法切换海报风格模板，请重新选择。')
    } finally {
      styleAdmission.current = false
      setStyleTemplateSwitchPending(false)
    }
  }

  const handleGenerate = async () => {
    const completedCopy = platformCopy.completedDraft
    const v2CopyFields = v2Project?.copySource === 'confirmed_copy' && v2CurrentCopy
      ? {
          copyDraft: v2CurrentCopy.body,
          platformCopy: {
            body: v2CurrentCopy.body,
            title: v2CurrentCopy.title,
            headline: v2CurrentCopy.headline,
            subline: v2CurrentCopy.subline,
          },
        }
      : null
    const copyBody = v2PosterFlow
      ? (v2Project?.copySource === 'confirmed_copy' ? v2CopyFields?.copyDraft ?? '' : 'poster-owned')
      : completedCopy?.copyDraft ?? ''
    if (
      v2PosterFlow &&
      v2Project?.copySource === 'confirmed_copy' &&
      (!v2CurrentCopy ||
        !v2Project.copyRef ||
        v2Project.copyRef.outputSignatureSha256 !== v2CurrentCopy.outputSignatureSha256 ||
        v2Project.copyRef.revision !== v2CurrentCopy.revision)
    ) {
      setModeError('文案已更新，请稍候系统同步后再生成海报。')
      return
    }
    const validationError = getPosterSubmissionValidationError({
      busy:
        immediateBusy.current ||
        posterGeneration.admissionBusy ||
        activeNonterminal,
      copyBody,
      sequenceEnabled: posterGeneration.capabilities.sequenceEnabled,
      productInfo: productInfo.values.productInfo,
      productImagePresent: Boolean(productInfo.productImage),
      consent: posterGeneration.consent,
    })
    if (validationError) {
      dispatch({ type: 'SET_POSTER_ADMISSION_ERROR', error: validationError })
      return
    }
    if (
      !productInfo.productImage ||
      (v2PosterFlow && (!v2Basic || !v2Advice || !v2Project)) ||
      (!v2PosterFlow && !completedCopy)
    ) {
      dispatch({
        type: 'SET_POSTER_ADMISSION_ERROR',
        error: GENERATION_SETUP_ERROR_MESSAGE,
      })
      return
    }

    const capturedProjectSignature = v2Project?.inputSignatureSha256 ?? null
    const capturedProjectId = v2Project?.projectId ?? null
    const capturedProjectIdentity = v2Project?.projectIdentitySha256 ?? null
    const capturedProjectCancellation = projectCancellation.current
    const capturedStyleCancellation = styleCancellation.current
    const captureIsCurrent = () => {
      if (!v2PosterFlow) return true
      const live = latestWorkflow.current.workflowV2
      return (
        projectCancellation.current === capturedProjectCancellation &&
        styleCancellation.current === capturedStyleCancellation &&
        live.phase === 'active' &&
        live.view === 'poster' &&
        live.epoch === session.epoch &&
        live.posterProject?.projectId === capturedProjectId &&
        live.posterProject?.projectIdentitySha256 === capturedProjectIdentity &&
        live.posterProject?.inputSignatureSha256 === capturedProjectSignature
      )
    }

    immediateBusy.current = true
    dispatch({ type: 'BEGIN_POSTER_ADMISSION' })

    const capturedPayload = v2PosterFlow && v2Project && v2Advice
      ? buildV2PosterSequencePayload(
          { ...productInfo.values },
          v2Project,
          v2Advice,
          v2Project.copySource === 'confirmed_copy' ? v2CurrentCopy : null,
        )
      : buildPosterSequencePayload(
          { ...productInfo.values },
          {
            ...completedCopy!,
            platformCopy: { ...completedCopy!.platformCopy },
            variants: completedCopy!.variants.map((variant) => ({ ...variant })),
            marketingStrategy: { ...completedCopy!.marketingStrategy },
          },
        )
    const capturedMimeType = productInfo.productImage.mimeType
    const capturedFile = productInfo.productImage.file

    try {
      const imageBytes = await capturedFile.arrayBuffer()
      if (!captureIsCurrent()) return
      const canonicalPayload = canonicalSequenceJson(capturedPayload)
      const fingerprint = await sequenceIntentFingerprint(
        canonicalPayload,
        imageBytes,
      )
      const intent = acquirePendingSequenceIntent(
        posterGeneration,
        fingerprint,
        () => globalThis.crypto.randomUUID(),
      )
      if (!captureIsCurrent()) return
      dispatch({
        type: 'SET_PENDING_POSTER_INTENT',
        fingerprint: intent.fingerprint,
        idempotencyKey: intent.idempotencyKey,
      })
      try {
        const created = await createPosterSequence(
          canonicalPayload,
          imageBytes,
          capturedMimeType,
          intent.idempotencyKey,
        )
        if (!captureIsCurrent()) return
        dispatch({
          type: 'APPLY_POSTER_RESULT',
          result: created,
          source: 'admission',
          fingerprint: intent.fingerprint,
        })
      } catch (error) {
        if (!captureIsCurrent()) return
        dispatch({
          type: 'POSTER_ADMISSION_FAILED',
          error:
            error instanceof PosterApiError
              ? error.userMessage
              : GENERATION_SETUP_ERROR_MESSAGE,
          ambiguous:
            error instanceof PosterApiError ? error.ambiguous : false,
        })
      }
    } catch {
      if (!captureIsCurrent()) return
      dispatch({
        type: 'POSTER_ADMISSION_FAILED',
        error: GENERATION_SETUP_ERROR_MESSAGE,
        ambiguous: false,
      })
    } finally {
      immediateBusy.current = false
      if (captureIsCurrent()) {
        dispatch({ type: 'END_POSTER_ADMISSION' })
      }
    }
  }

  const selectedSlot =
    posterGeneration.selectedIndex === null
      ? null
      : result?.posters[posterGeneration.selectedIndex] ?? null
  const selectedReady =
    isEligibleReadySlot(selectedSlot) &&
    selectedSlot.posterId === posterGeneration.selectedPosterId
  const generationReadyForEditor =
    !v2PosterFlow ||
    result?.status === 'completed' ||
    result?.status === 'partial_failed'
  const editorEntryReady = Boolean(
    selectedReady &&
      generationReadyForEditor &&
      !posterGeneration.admissionBusy &&
      !activeNonterminal &&
      !modeSwitchPending &&
      !styleTemplateSwitchPending,
  )
  const hasReadyPoster = Boolean(
    result?.posters.some((slot) => isEligibleReadySlot(slot)),
  )

  const handleEnterTextEditor = async () => {
    if (
      entryAdmission.current ||
      posterEditor.operations.entryBusy ||
      !editorEntryReady
    ) return

    const capturedResult = posterGeneration.result
    const capturedIndex = posterGeneration.selectedIndex
    const capturedSlot =
      capturedIndex === null ? null : capturedResult?.posters[capturedIndex] ?? null
    const capturedDownloadUrl = safeRelativeApiUrl(capturedSlot?.downloadUrl)
    const capturedProject = v2PosterFlow ? session.posterProject : null
    if (
      workflow.currentStep !== 3 ||
      !capturedResult ||
      capturedIndex === null ||
      !isEligibleReadySlot(capturedSlot) ||
      capturedSlot.posterId !== posterGeneration.selectedPosterId ||
      !capturedDownloadUrl
    ) {
      dispatch({
        type: 'STEP_FOUR_ENTRY_FAILED',
        error: capturedResult
          ? '所选底图不可用，请返回步骤 3 重新选用。'
          : '暂无可用底图，请等待至少一张海报生成完成。',
      })
      return
    }
    if (v2PosterFlow && !capturedProject) {
      dispatch({ type: 'STEP_FOUR_ENTRY_FAILED', error: GENERATION_SETUP_ERROR_MESSAGE })
      return
    }

    // Admission and every mutable identity are captured before the first await.
    entryAdmission.current = true
    const cancellationToken = entryCancellation.current
    const captured = {
      generationId: capturedResult.generationId,
      selectedIndex: capturedIndex,
      posterId: capturedSlot.posterId,
      slot: capturedSlot.displayIndex,
      downloadUrl: capturedDownloadUrl,
      selectionRevision: posterGeneration.selectionRevision,
      resourceRevision: posterGeneration.resourceRevision,
      location: workflow.currentStep,
      workflowEpoch: session.epoch,
      projectInputSignatureSha256: capturedProject?.inputSignatureSha256 ?? null,
    } as const
    const editorCopy = capturedProject
      ? capturedProject.copySource === 'confirmed_copy' && v2CurrentCopy
        ? { body: v2CurrentCopy.body, title: v2CurrentCopy.title, headline: v2CurrentCopy.headline, subline: v2CurrentCopy.subline }
        : capturedResult.marketingCopy
      : platformCopy.completedDraft?.platformCopy ?? platformCopy.platformCopy
    const editorPlatform = capturedProject?.platform ?? platformCopy.platform
    const editorStyle = capturedProject?.style ?? platformCopy.style
    const copySnapshot = {
      body: String(editorCopy?.body ?? ''),
      title: String(editorCopy?.title ?? ''),
      headline: String(editorCopy?.headline ?? ''),
      subline: String(editorCopy?.subline ?? ''),
      platform: editorPlatform,
      style: editorStyle,
    }
    const initialLayout = providerDirectPosterEnabled(capturedProject)
      ? createProviderDirectPosterLayout(editorPlatform)
      : createDefaultPosterLayout(editorPlatform, editorCopy)
    const selectedVariant =
      platformCopy.selectedVariantIndex === null
        ? null
        : platformCopy.variants[platformCopy.selectedVariantIndex] ?? null
    dispatch({ type: 'BEGIN_STEP_FOUR_ENTRY' })

    const assertCurrent = () => {
      const current = latestWorkflow.current
      const currentResult = current.posterGeneration.result
      const currentIndex = current.posterGeneration.selectedIndex
      const currentSlot =
        currentIndex === null ? null : currentResult?.posters[currentIndex] ?? null
      if (
        !mounted.current ||
        entryCancellation.current !== cancellationToken ||
        current.currentStep !== captured.location ||
        currentResult?.generationId !== captured.generationId ||
        currentIndex !== captured.selectedIndex ||
        current.posterGeneration.selectedPosterId !== captured.posterId ||
        currentSlot?.posterId !== captured.posterId ||
        safeRelativeApiUrl(currentSlot.downloadUrl) !== captured.downloadUrl ||
        current.posterGeneration.selectionRevision !== captured.selectionRevision ||
        current.posterGeneration.resourceRevision !== captured.resourceRevision ||
        (captured.projectInputSignatureSha256 !== null && (
          current.workflowV2.epoch !== captured.workflowEpoch ||
          current.workflowV2.posterProject?.inputSignatureSha256 !== captured.projectInputSignatureSha256
        ))
      ) {
        throw new Error('stale-step-four-entry')
      }
    }

    try {
      const cached = posterGeneration.posterBinaries[captured.posterId]?.download
      const fromCache = cached?.status === 'ready' && cached.blob
      const baseBlob = fromCache
        ? cached.blob!
        : await fetchPosterPng(captured.downloadUrl)
      assertCurrent()
      const baseBlobSha256 = await sha256Blob(baseBlob)
      assertCurrent()
      const decoded = await decodeRasterBlob(baseBlob, POSTER_BASE_DECODE_MESSAGE)
      const intrinsicWidth = decoded.width
      const intrinsicHeight = decoded.height
      decoded.close()
      assertCurrent()
      const currentUpstreamSha256 = await upstreamSha256({
        generationId: captured.generationId,
        product: { ...productInfo.values },
        productImage: productInfo.productImage,
        platform: editorPlatform,
        style: editorStyle,
        selectedVariantIndex: platformCopy.selectedVariantIndex,
        selectedVariant: selectedVariant ? { ...selectedVariant } : null,
        finalBody: platformCopy.copyDraft,
      })
      assertCurrent()

      const baseBlobId = `base:${captured.generationId}:${captured.posterId}:${baseBlobSha256}`
      if (!fromCache) {
        dispatch({
          type: 'POSTER_BINARY_SUCCEEDED',
          kind: 'download',
          posterId: captured.posterId,
          blob: baseBlob,
          objectUrl: URL.createObjectURL(baseBlob),
        })
      }
      dispatch({
        type: 'ENTER_STEP_FOUR',
        active: {
          generationId: captured.generationId,
          posterId: captured.posterId,
          slot: captured.slot,
          downloadUrl: captured.downloadUrl,
          baseBlobId,
          baseBlobSha256,
          intrinsicWidth,
          intrinsicHeight,
          upstreamSha256: currentUpstreamSha256,
          copySnapshot,
          resourceRevision: posterEditor.resourceRevision,
          draftKey: captured.projectInputSignatureSha256
            ? `v2:${captured.projectInputSignatureSha256}:${captured.generationId}:${captured.posterId}:${baseBlobSha256}`
            : undefined,
          posterProjectInputSignatureSha256: captured.projectInputSignatureSha256,
          posterCopySource: capturedProject?.copySource ?? null,
        },
        baseResource: {
          id: baseBlobId,
          kind: 'base',
          blob: baseBlob,
          sha256: baseBlobSha256,
          mimeType: 'image/png',
          name: `poster-base-${captured.slot}.png`,
          width: intrinsicWidth,
          height: intrinsicHeight,
        },
        initialLayout,
      })
    } catch (error) {
      if (error instanceof Error && error.message === 'stale-step-four-entry') {
        dispatch({ type: 'CANCEL_STEP_FOUR_ENTRY' })
        return
      }
      if (mounted.current && entryCancellation.current === cancellationToken) {
        dispatch({
          type: 'STEP_FOUR_ENTRY_FAILED',
          error:
            error instanceof PosterApiError
              ? error.userMessage
              : error instanceof Error && error.message === POSTER_BASE_DECODE_MESSAGE
                ? POSTER_BASE_DECODE_MESSAGE
                : POSTER_DOWNLOAD_ERROR_MESSAGE,
        })
      }
    } finally {
      entryAdmission.current = false
    }
  }

  const handlePrevious = () => {
    entryCancellation.current += 1
    dispatch(v2PosterFlow ? { type: 'RETURN_FROM_V2_POSTER' } : { type: 'GO_TO_STEP_TWO' })
  }

  const handleZipDownload = async () => {
    if (
      !result ||
      result.status !== 'completed' ||
      !result.zipDownloadUrl
    ) {
      return
    }
    const cached = posterGeneration.zipBinary
    if (
      cached.generationId === result.generationId &&
      cached.status === 'ready' &&
      cached.objectUrl
    ) {
      triggerBlobDownload(cached.objectUrl, 'posters-base.zip')
      return
    }
    if (
      cached.generationId === result.generationId &&
      cached.status === 'loading'
    ) {
      return
    }
    dispatch({ type: 'BEGIN_POSTER_ZIP', generationId: result.generationId })
    try {
      const blob = await fetchPosterZip(result.zipDownloadUrl)
      const objectUrl = URL.createObjectURL(blob)
      if (cached.objectUrl) {
        URL.revokeObjectURL(cached.objectUrl)
      }
      dispatch({
        type: 'POSTER_ZIP_SUCCEEDED',
        generationId: result.generationId,
        blob,
        objectUrl,
      })
      triggerBlobDownload(objectUrl, 'posters-base.zip')
    } catch (error) {
      dispatch({
        type: 'POSTER_ZIP_FAILED',
        generationId: result.generationId,
        error:
          error instanceof PosterApiError
            ? error.userMessage
            : ZIP_DOWNLOAD_ERROR_MESSAGE,
      })
    }
  }

  return (
    <section
      aria-labelledby="poster-generation-heading"
      className="poster-generation-step"
    >
      <h1 ref={headingRef} id="poster-generation-heading" tabIndex={-1}>
        {v2PosterFlow ? '海报创作' : '步骤 3：生成海报'}
      </h1>

      {v2PosterFlow ? (
        <>
          <p className="poster-generation-step__supporting">
            选择生成方式，系统会默认使用上一步文案；若尚未生成文案，将在生成海报时自动补写。
          </p>
          <dl className="poster-generation-step__context">
            <div><dt>商品</dt><dd>{v2Basic?.text.values.productShortName || v2Basic?.text.values.productInfo}</dd></div>
            <div><dt>投放平台</dt><dd>{v2Basic?.settings.platform}</dd></div>
            <div><dt>文案风格</dt><dd>{v2Basic?.settings.style}</dd></div>
            <div><dt>营销方向</dt><dd>{v2Advice?.advice.strategy.name}</dd></div>
          </dl>
          {v2CurrentCopy ? (
            <p className="poster-copy-source__summary">
              将使用当前已确认文案（第 {v2CurrentCopy.revision} 版）：{v2CurrentCopy.title || v2CurrentCopy.body}
            </p>
          ) : (
            <p className="poster-copy-source__summary">
              当前没有已确认文案，生成海报时会自动补写本轮海报文案。
            </p>
          )}
          <fieldset
            ref={modeFieldsetRef}
            className="poster-copy-source"
            aria-describedby="poster-generation-mode-help"
          >
            <legend>海报生成方式</legend>
            <label>
              <input
                checked={v2Project?.generationKind === 'blank_base'}
                disabled={!v2Project || modeSwitchPending || styleTemplateSwitchPending}
                name="poster-generation-kind"
                onChange={() => void chooseGenerationKind('blank_base')}
                type="radio"
                value="blank_base"
              />
              <span>只生成无字海报底图，自行编辑海报文字</span>
              <small>不套用固定模板，生成无字底图后进入海报编辑。</small>
            </label>
            <label>
              <input
                checked={v2Project?.generationKind === 'template'}
                disabled={!v2Project || modeSwitchPending || styleTemplateSwitchPending}
                name="poster-generation-kind"
                onChange={() => void chooseGenerationKind('template')}
                type="radio"
                value="template"
              />
              <span>选择海报模板</span>
              <small>按模板构图生成；可选有字成图或无字底图。</small>
            </label>
          </fieldset>
          <div className="poster-generation-options">
            <div className="poster-generation-options__primary">
              {v2Project?.generationKind === 'blank_base' ? (
                <div className="poster-creative-note">
                  <div className="field-heading">
                    <label className="field-label" htmlFor="poster-creative-note">
                      创意补充（可选）
                    </label>
                    <span className="character-count" id="poster-creative-note-count">
                      {productInfo.values.creativeNote.length} / {PRODUCT_INFO_LIMITS.creativeNote}
                    </span>
                  </div>
                  <textarea
                    aria-describedby="poster-creative-note-count"
                    className="text-control text-control--creative-note"
                    id="poster-creative-note"
                    maxLength={PRODUCT_INFO_LIMITS.creativeNote}
                    onChange={(event) =>
                      dispatch({
                        type: 'UPDATE_CREATIVE_NOTE',
                        value: event.target.value,
                      })
                    }
                    placeholder="补充海报氛围、构图或画面方向，仅用于无字底图生成。"
                    value={productInfo.values.creativeNote}
                  />
                </div>
              ) : null}
            </div>
            <div className="poster-generation-options__secondary">
              {v2Project?.generationKind === 'template' ? (
                <fieldset
                  ref={styleTemplateFieldsetRef}
                  className="poster-style-template"
                  aria-describedby="poster-style-template-help"
                >
                  <legend>海报风格模板</legend>
                  <p className="poster-style-template__intro">
                    选择一种固定模板构图方向。
                  </p>
                  <div className="poster-style-template__options">
                    {templateOptions.map((option) => {
                      const selected = v2Project.styleTemplateId === option.styleTemplateId
                      return (
                        <label
                          className={[
                            'poster-style-template__card',
                            selected ? 'is-selected' : '',
                          ].filter(Boolean).join(' ')}
                          key={option.optionId}
                        >
                          <input
                            aria-label={option.accessibilityText}
                            checked={selected}
                            disabled={
                              !v2Project ||
                              modeSwitchPending ||
                              styleTemplateSwitchPending ||
                              !option.styleTemplateId
                            }
                            name="poster-style-template"
                            onChange={() => {
                              if (option.styleTemplateId) {
                                void chooseStyleTemplate(option.styleTemplateId)
                              }
                            }}
                            type="radio"
                            value={option.optionId}
                          />
                          <span className="poster-style-template__card-body">
                            <span className="poster-style-template__preview">
                              {option.previewKind === 'asset' && option.previewUrl ? (
                                <img alt="" src={option.previewUrl} />
                              ) : null}
                            </span>
                            <span className="poster-style-template__copy">
                              <span className="poster-style-template__alias">{option.alias}</span>
                              <span className="poster-style-template__description">
                                {option.description}
                              </span>
                              <span className="poster-style-template__selected">
                                {selected ? '已选择' : '可选择'}
                              </span>
                            </span>
                          </span>
                        </label>
                      )
                    })}
                  </div>
                </fieldset>
              ) : null}
              {v2Project?.generationKind === 'template' ? (
                <fieldset className="poster-typography-mode" aria-describedby="poster-typography-mode-help">
                  <legend>模板文字处理</legend>
                  <label>
                    <input
                      checked={v2Project.typographyMode === 'textless'}
                      disabled={modeSwitchPending || styleTemplateSwitchPending}
                      name="poster-typography-mode"
                      onChange={() => void chooseTypographyMode('textless')}
                      type="radio"
                      value="textless"
                    />
                    <span>无文字</span>
                    <small>生成无字底图，进入海报编辑自行叠字。</small>
                  </label>
                  <label>
                    <input
                      checked={v2Project.typographyMode === 'with_text'}
                      disabled={modeSwitchPending || styleTemplateSwitchPending}
                      name="poster-typography-mode"
                      onChange={() => void chooseTypographyMode('with_text')}
                      type="radio"
                      value="with_text"
                    />
                    <span>有文字</span>
                    <small>模型结合文案创新生成整张海报，确认后直接导出。</small>
                  </label>
                </fieldset>
              ) : null}
              {v2Project?.generationKind === 'template' ? (
                <p
                  id="poster-style-template-help"
                  className="poster-style-template__help"
                  role={styleTemplateError ? 'alert' : undefined}
                >
                  {styleTemplateError || '风格切换不会生成海报；请在确认授权后手动生成。'}
                </p>
              ) : null}
            </div>
          </div>
          <p id="poster-generation-mode-help" role={modeError ? 'alert' : undefined}>
            {modeError}
          </p>
        </>
      ) : null}

      <PosterConsentStatus
        admissionBusy={posterGeneration.admissionBusy}
        admissionError={posterGeneration.errors.admission}
        capabilities={posterGeneration.capabilities}
        consent={posterGeneration.consent}
        hasProductImage={Boolean(productInfo.productImage)}
        onConsentChange={(consent) =>
          dispatch({ type: 'SET_POSTER_CONSENT', consent })
        }
        onSubmit={handleGenerate}
        pollingError={posterGeneration.errors.polling}
        primaryDisabled={primaryDisabled}
        primaryLabel={
          posterGeneration.succeededOnce ? '重新生成' : v2PosterFlow ? '生成海报' : '开始生成海报'
        }
        result={result}
      />

      <div className="poster-generation-workspace">
        {result ? (
          <div className="poster-grid" data-generation-status={result.status}>
            {result.posters.map((slot, index) => (
              <PosterSlot
                binary={
                  slot.posterId
                    ? posterGeneration.posterBinaries[slot.posterId]
                    : undefined
                }
                key={`${result.generationId}-${index}`}
                selected={
                  posterGeneration.selectedIndex === index &&
                  posterGeneration.selectedPosterId === slot.posterId
                }
                slot={{
                  ...slot,
                  displayIndex: (index + 1) as 1 | 2 | 3,
                  concept: slot.concept || POSTER_SLOT_TITLES[index],
                }}
              />
            ))}
          </div>
        ) : null}
      </div>

      {hasReadyPoster && !selectedReady ? (
        <p className="poster-selection-help" role="status">
          {v2PosterFlow
            ? '请先选用一张海报，再进入海报编辑。'
            : '请先选用一张底图，再进入文字编辑。'}
        </p>
      ) : (
        <div className="poster-selection-help" aria-hidden="true" />
      )}

      <div className="poster-generation-navigation">
        <button
          className="poster-generation-navigation__previous"
          onClick={handlePrevious}
          type="button"
        >
          上一步
        </button>
        {result?.status === 'completed' && result.zipDownloadUrl ? (
          <button
            aria-busy={
              posterGeneration.zipBinary.generationId === result.generationId &&
              posterGeneration.zipBinary.status === 'loading'
            }
            className="poster-generation-navigation__zip"
            onClick={handleZipDownload}
            type="button"
          >
            下载全部无字底 ZIP
          </button>
        ) : (
          <span className="poster-generation-navigation__zip-space" />
        )}
        <button
          className="poster-generation-navigation__next"
          aria-busy={posterEditor.operations.entryBusy}
          disabled={!editorEntryReady || posterEditor.operations.entryBusy}
          onClick={handleEnterTextEditor}
          type="button"
        >
          {posterEditor.operations.entryBusy
            ? '正在载入底图…'
            : v2PosterFlow ? '进入海报编辑' : '下一步：文字编辑'}
        </button>
      </div>
      {posterEditor.operations.entryError ? (
        <p className="poster-step-four-entry-error" role="alert">
          {posterEditor.operations.entryError}
        </p>
      ) : null}
      {posterGeneration.zipBinary.error ? (
        <p className="poster-zip-error" role="alert">
          {posterGeneration.zipBinary.error}
        </p>
      ) : null}
    </section>
  )
}

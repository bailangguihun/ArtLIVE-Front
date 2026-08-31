import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { selectCurrentStepFourCompletion } from '../poster-editor/poster-selectors'
import {
  useWorkflowDetailCommands,
  useWorkflowDispatch,
  useWorkflowState,
} from '../../state/use-workflow'
import {
  createConfirmedDetail,
  isConfirmedDetailInternallyConsistent,
  isConfirmedPosterCurrent,
  isConfirmedPosterInternallyConsistent,
  posterRefFromConfirmedPoster,
  samePosterRef,
} from '../../state/workflow-v2/workflow-v2-authorities'
import type {
  DetailOwnerIdentity,
  DetailPage,
  DetailPageExport,
  DetailResource,
  DetailEditorOperations,
} from '../../types/detail-editor'
import { DetailEditorCanvas } from './DetailEditorCanvas'
import { DetailEditorInspector } from './DetailEditorInspector'
import {
  createImageLayer,
  detailBackgroundDefinition,
  sameDetailOwner,
  systemBackground,
} from './detail-defaults'
import { requestDetailCutout } from './detail-cutout-api'
import { composeDetailPng } from './detail-renderer'
import {
  DETAIL_STALE_ERROR,
  DETAIL_UPLOAD_DECODE_ERROR,
  DETAIL_UPLOAD_SIZE_ERROR,
  DETAIL_UPLOAD_TYPE_ERROR,
  detailResourceByteIdentity,
  validateDetailExport,
  validateDetailUpload,
  validatePngBlob,
} from './detail-resources'
import {
  detailGroupSignatureSha256,
  detailPageSignatureSha256,
} from './detail-signature'
import { removeDetailNearWhiteBackground } from './detail-white-removal'

interface MutationOptions {
  addedResources?: DetailResource[]
  removedResourceIds?: string[]
  selectedLayerId?: string | null
  selectedResourceId?: string | null
}

function currentV2PosterRef(workflow: ReturnType<typeof useWorkflowState>) {
  const session = workflow.workflowV2
  const basic = session.basicAuthority
  const advice = session.adviceAuthority
  const poster = session.confirmedPoster
  if (
    session.phase !== 'active' ||
    !basic ||
    !advice ||
    !poster ||
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

function isV2DetailView(workflow: ReturnType<typeof useWorkflowState>) {
  return workflow.workflowV2.phase === 'active' &&
    workflow.workflowV2.view === 'detail'
}

function entryAuthority(workflow: ReturnType<typeof useWorkflowState>) {
  if (isV2DetailView(workflow)) {
    const project = workflow.workflowV2.detailProject
    const ref = currentV2PosterRef(workflow)
    const owner = workflow.detailEditor.owner
    return Boolean(
      project &&
        ref &&
        owner &&
        samePosterRef(project.owner.posterRef, ref) &&
        owner.generationId === ref.generationId &&
        owner.posterId === ref.posterId &&
        owner.inputSignatureSha256 === ref.compositionInputSignatureSha256 &&
        owner.pngBlobSha256 === ref.pngBlobSha256,
    )
  }
  const confirmed = workflow.posterEditor.confirmedPoster
  const completion = selectCurrentStepFourCompletion(workflow.posterEditor)
  const owner = workflow.detailEditor.owner
  return Boolean(
    workflow.currentStep === 5 &&
    confirmed &&
    completion &&
    owner &&
    owner.generationId === confirmed.generationId &&
    owner.posterId === confirmed.posterId &&
    owner.inputSignatureSha256 === confirmed.inputSignatureSha256 &&
    owner.pngBlobSha256 === confirmed.pngBlobSha256,
  )
}

function currentConfirmation(workflow: ReturnType<typeof useWorkflowState>) {
  const detail = workflow.detailEditor
  const confirmed = detail.confirmedDetails
  if (isV2DetailView(workflow)) {
    const authority = workflow.workflowV2.confirmedDetail
    const project = workflow.workflowV2.detailProject
    const ref = currentV2PosterRef(workflow)
    return Boolean(
      confirmed &&
        authority &&
        project &&
        ref &&
        isConfirmedDetailInternallyConsistent(authority) &&
        authority.outputSignatureSha256 ===
          workflow.workflowV2.currentDetailOutputSignatureSha256 &&
        authority.detailId === project.detailId &&
        samePosterRef(authority.owner.posterRef, ref) &&
        sameDetailOwner(detail.owner, confirmed.owner) &&
        confirmed.confirmedResourceRevision === detail.resourceRevision &&
        confirmed.pageExports.length === detail.pages.length &&
        confirmed.pageExports.every((item, index) =>
          detail.pages[index].currentExport === item,
        ),
    )
  }
  return Boolean(
    detail.owner &&
    confirmed &&
    sameDetailOwner(detail.owner, confirmed.owner) &&
    confirmed.confirmedResourceRevision === detail.resourceRevision &&
    confirmed.pageExports.length === detail.pages.length &&
    confirmed.pageExports.length > 0 &&
    confirmed.pageExports.every((item, index) => detail.pages[index].currentExport === item),
  )
}

function operationError(error: unknown) {
  const message = error instanceof Error ? error.message : ''
  if ([DETAIL_UPLOAD_DECODE_ERROR, DETAIL_UPLOAD_SIZE_ERROR, DETAIL_UPLOAD_TYPE_ERROR].includes(message)) return message
  if (message === DETAIL_STALE_ERROR) return '编辑内容已变化，请重新操作。'
  return '图片处理失败，请重试。'
}

function useDetailResourceUrls(resources: Readonly<Record<string, DetailResource>>) {
  const [urls, setUrls] = useState<Record<string, string>>({})
  useEffect(() => {
    let retained = true
    const next: Record<string, string> = {}
    for (const resource of Object.values(resources)) next[resource.id] = URL.createObjectURL(resource.blob)
    queueMicrotask(() => { if (retained) setUrls(next) })
    return () => {
      retained = false
      Object.values(next).forEach((url) => URL.revokeObjectURL(url))
    }
  }, [resources])
  return urls
}

export function DetailEditorStep() {
  const workflow = useWorkflowState()
  const dispatch = useWorkflowDispatch()
  const { startNewDetailProject } = useWorkflowDetailCommands()
  const v2DetailView = workflow.workflowV2.phase === 'active' &&
    workflow.workflowV2.view === 'detail'
  const detail = workflow.detailEditor
  const page = detail.pages[detail.activePageIndex] ?? null
  const latestWorkflow = useRef(workflow)
  const exportAdmission = useRef(false)
  const confirmationAdmission = useRef(false)
  const imageAdmission = useRef(false)
  const imageOperationToken = useRef(0)
  const cutoutAbortController = useRef<AbortController | null>(null)
  const [canvasError, setCanvasError] = useState('')
  const [canvasRetryToken, setCanvasRetryToken] = useState(0)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const focusedEntryRef = useRef(false)
  const resourceUrls = useDetailResourceUrls(detail.resources)

  useLayoutEffect(() => { latestWorkflow.current = workflow }, [workflow])

  useEffect(() => {
    if (!v2DetailView || focusedEntryRef.current) return
    focusedEntryRef.current = true
    headingRef.current?.focus()
  }, [v2DetailView])

  const setOperations = useCallback((operations: Partial<DetailEditorOperations>) => {
    dispatch({ type: 'SET_STEP_FIVE_OPERATIONS', operations })
  }, [dispatch])

  const invalidateImageOperation = useCallback(() => {
    imageOperationToken.current += 1
    cutoutAbortController.current?.abort()
    cutoutAbortController.current = null
    imageAdmission.current = false
  }, [])

  useEffect(() => () => invalidateImageOperation(), [invalidateImageOperation])

  const mutatePage = useCallback((nextPage: DetailPage, options: MutationOptions = {}) => {
    const live = latestWorkflow.current
    const current = live.detailEditor.pages[live.detailEditor.activePageIndex]
    if (!current || current.id !== nextPage.id || live.currentStep !== 5) return
    dispatch({
      type: 'COMMIT_STEP_FIVE_PAGE_MUTATION',
      pageId: current.id,
      expectedRevision: current.compositionRevision,
      page: nextPage,
      addedResources: options.addedResources,
      removedResourceIds: options.removedResourceIds,
      selectedLayerId: options.selectedLayerId,
      selectedResourceId: options.selectedResourceId,
    })
  }, [dispatch])

  const captureV2Ownership = useCallback((live: ReturnType<typeof useWorkflowState>) => {
    const project = isV2DetailView(live) ? live.workflowV2.detailProject : null
    return {
      workflowEpoch: project ? live.workflowV2.epoch : null,
      detailProjectSignatureSha256: project?.projectSignatureSha256 ?? null,
      posterOutputSignatureSha256:
        project?.owner.posterRef.outputSignatureSha256 ?? null,
    }
  }, [])

  const selectLayer = useCallback((id: string | null) => {
    const live = latestWorkflow.current.detailEditor
    const current = live.pages[live.activePageIndex]
    const layer = current?.layers.find((item) => item.id === id)
    dispatch({
      type: 'SET_STEP_FIVE_UI',
      panel: layer?.kind === 'shape' ? 'shape' : layer?.kind === 'image' ? 'image' : live.activePanel,
      selectedLayerId: id,
      selectedResourceId: layer?.kind === 'image' ? layer.resourceId : undefined,
    })
  }, [dispatch])

  useEffect(() => {
    const handleDelete = (event: KeyboardEvent) => {
      if (event.key !== 'Delete' && event.key !== 'Backspace') return
      const target = event.target
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) return
      const live = latestWorkflow.current
      const current = live.detailEditor.pages[live.detailEditor.activePageIndex]
      const selectedId = live.detailEditor.selectedLayerId
      if (!current || !selectedId || !current.layers.some((layer) => layer.id === selectedId)) return
      event.preventDefault()
      mutatePage({ ...current, layers: current.layers.filter((layer) => layer.id !== selectedId) }, { selectedLayerId: null })
    }
    window.addEventListener('keydown', handleDelete)
    return () => window.removeEventListener('keydown', handleDelete)
  }, [mutatePage])

  const assertCapture = useCallback((capture: {
    owner: DetailOwnerIdentity
    pageId: string
    revision: number
    resourceRevision: number
    workflowEpoch: number | null
    detailProjectSignatureSha256: string | null
    posterOutputSignatureSha256: string | null
  }) => {
    const live = latestWorkflow.current
    const current = live.detailEditor.pages.find((item) => item.id === capture.pageId)
    const v2Current = capture.workflowEpoch === null || Boolean(
      live.workflowV2.phase === 'active' &&
        live.workflowV2.view === 'detail' &&
        live.workflowV2.epoch === capture.workflowEpoch &&
        live.workflowV2.detailProject?.projectSignatureSha256 ===
          capture.detailProjectSignatureSha256 &&
        live.workflowV2.detailProject?.owner.posterRef.outputSignatureSha256 ===
          capture.posterOutputSignatureSha256,
    )
    if (
      live.currentStep !== 5 ||
      !sameDetailOwner(live.detailEditor.owner, capture.owner) ||
      !current ||
      current.compositionRevision !== capture.revision ||
      live.detailEditor.resourceRevision !== capture.resourceRevision ||
      !v2Current
    ) throw new Error(DETAIL_STALE_ERROR)
  }, [])

  const uploadAndPlace = async (file: File) => {
    if (imageAdmission.current) return
    imageAdmission.current = true
    const operationToken = imageOperationToken.current + 1
    imageOperationToken.current = operationToken
    const assertOperationCurrent = () => {
      if (imageOperationToken.current !== operationToken) throw new Error(DETAIL_STALE_ERROR)
    }
    const live = latestWorkflow.current
    const current = live.detailEditor.pages[live.detailEditor.activePageIndex]
    const owner = live.detailEditor.owner
    if (!current || !owner) {
      imageAdmission.current = false
      return
    }
    const capture = { owner: { ...owner }, pageId: current.id, revision: current.compositionRevision, resourceRevision: live.detailEditor.resourceRevision, ...captureV2Ownership(live) }
    setOperations({ imageBusy: true, imageStatus: '' })
    try {
      const validated = await validateDetailUpload(file)
      assertOperationCurrent()
      assertCapture(capture)
      const retained = Object.values(latestWorkflow.current.detailEditor.resources).find((resource) => detailResourceByteIdentity(resource) === detailResourceByteIdentity(validated))
      const resource = retained ?? validated
      const currentLive = latestWorkflow.current.detailEditor.pages.find((item) => item.id === capture.pageId)
      if (!currentLive) throw new Error(DETAIL_STALE_ERROR)
      const count = currentLive.layers.filter((layer) => layer.kind === 'image').length
      const layer = createImageLayer(`image-${latestWorkflow.current.detailEditor.nextLayerSequence}`, resource, count)
      mutatePage(
        { ...currentLive, activeProductId: resource.id, layers: [...currentLive.layers, layer] },
        {
          addedResources: retained ? undefined : [resource],
          selectedLayerId: layer.id,
          selectedResourceId: resource.id,
        },
      )
      setOperations({ imageBusy: false, imageStatus: '已上传图片并追加到画布。' })
    } catch (error) {
      if (imageOperationToken.current !== operationToken) return
      setOperations({ imageBusy: false, imageStatus: `上传失败：${operationError(error)}` })
    } finally {
      if (imageOperationToken.current === operationToken) imageAdmission.current = false
    }
  }

  const customBackground = async (file: File) => {
    if (imageAdmission.current) return
    imageAdmission.current = true
    const operationToken = imageOperationToken.current + 1
    imageOperationToken.current = operationToken
    const assertOperationCurrent = () => {
      if (imageOperationToken.current !== operationToken) throw new Error(DETAIL_STALE_ERROR)
    }
    const live = latestWorkflow.current
    const current = live.detailEditor.pages[live.detailEditor.activePageIndex]
    const owner = live.detailEditor.owner
    if (!current || !owner) {
      imageAdmission.current = false
      return
    }
    const capture = { owner: { ...owner }, pageId: current.id, revision: current.compositionRevision, resourceRevision: live.detailEditor.resourceRevision, ...captureV2Ownership(live) }
    setOperations({ imageBusy: true, imageStatus: '' })
    try {
      const resource = await validateDetailUpload(file, 'custom-background')
      assertOperationCurrent()
      assertCapture(capture)
      const currentLive = latestWorkflow.current.detailEditor.pages.find((item) => item.id === capture.pageId)
      if (!currentLive) throw new Error(DETAIL_STALE_ERROR)
      const fallbackId = currentLive.background.kind === 'system' ? currentLive.background.catalogId : currentLive.background.fallbackCatalogId
      const fallback = detailBackgroundDefinition(fallbackId)
      mutatePage({
        ...currentLive,
        background: {
          kind: 'custom',
          resourceId: resource.id,
          sha256: resource.sha256,
          fallbackCatalogId: fallback.id,
          fallbackSha256: fallback.sha256,
        },
      }, { addedResources: latestWorkflow.current.detailEditor.resources[resource.id] ? undefined : [resource] })
      setOperations({ imageBusy: false, imageStatus: '' })
    } catch (error) {
      if (imageOperationToken.current !== operationToken) return
      setOperations({ imageBusy: false, imageStatus: `上传失败：${operationError(error)}` })
    } finally {
      if (imageOperationToken.current === operationToken) imageAdmission.current = false
    }
  }

  const selectedSource = () => {
    const live = latestWorkflow.current.detailEditor
    const current = live.pages[live.activePageIndex]
    const selectedLayer = current?.layers.find((layer) => layer.id === live.selectedLayerId)
    const resourceId = selectedLayer?.kind === 'image' ? selectedLayer.resourceId : live.selectedResourceId
    return resourceId ? live.resources[resourceId] ?? null : null
  }

  const transformResource = async (kind: 'cutout' | 'near-white') => {
    if (imageAdmission.current) return
    const source = selectedSource()
    if (!source) {
      setOperations({ imageStatus: '请先上传或选择一张图片再去除背景/白底。' })
      return
    }
    imageAdmission.current = true
    const operationToken = imageOperationToken.current + 1
    imageOperationToken.current = operationToken
    const assertOperationCurrent = () => {
      if (imageOperationToken.current !== operationToken) throw new Error(DETAIL_STALE_ERROR)
    }
    const controller = kind === 'cutout' ? new AbortController() : null
    if (controller) cutoutAbortController.current = controller
    const live = latestWorkflow.current
    const current = live.detailEditor.pages[live.detailEditor.activePageIndex]
    const owner = live.detailEditor.owner
    if (!current || !owner) {
      if (cutoutAbortController.current === controller) cutoutAbortController.current = null
      imageAdmission.current = false
      return
    }
    const capture = { owner: { ...owner }, pageId: current.id, revision: current.compositionRevision, resourceRevision: live.detailEditor.resourceRevision, ...captureV2Ownership(live) }
    const sourceIdentity = `${source.id}:${source.sha256}`
    setOperations({ imageBusy: true, imageStatus: kind === 'cutout' ? '正在去除背景…' : '正在去除白底…' })
    try {
      const pageSignature = await detailPageSignatureSha256(current, live.detailEditor.resources)
      assertOperationCurrent()
      assertCapture(capture)
      const blob = kind === 'cutout'
        ? await requestDetailCutout(source.blob, controller?.signal)
        : await removeDetailNearWhiteBackground(source.blob)
      assertOperationCurrent()
      assertCapture(capture)
      if (`${source.id}:${source.sha256}` !== sourceIdentity) throw new Error(DETAIL_STALE_ERROR)
      const validated = await validatePngBlob(blob, kind === 'cutout' ? { requireAlpha: true } : undefined)
      assertOperationCurrent()
      assertCapture(capture)
      const livePage = latestWorkflow.current.detailEditor.pages.find((item) => item.id === capture.pageId)
      if (!livePage || await detailPageSignatureSha256(livePage, latestWorkflow.current.detailEditor.resources) !== pageSignature) throw new Error(DETAIL_STALE_ERROR)
      assertOperationCurrent()
      const resource: DetailResource = {
        id: `${kind}:${validated.sha256}`,
        kind,
        name: kind === 'cutout' ? `${source.name}-去除背景` : `${source.name}-去除白底`,
        blob,
        sha256: validated.sha256,
        mimeType: 'image/png',
        width: validated.width,
        height: validated.height,
      }
      const retained = Object.values(latestWorkflow.current.detailEditor.resources).find((item) => detailResourceByteIdentity(item) === detailResourceByteIdentity(resource))
      const placed = retained ?? resource
      const count = livePage.layers.filter((layer) => layer.kind === 'image').length
      const layer = createImageLayer(`image-${latestWorkflow.current.detailEditor.nextLayerSequence}`, placed, count)
      mutatePage(
        { ...livePage, activeProductId: placed.id, layers: [...livePage.layers, layer] },
        { addedResources: retained ? undefined : [placed], selectedLayerId: layer.id, selectedResourceId: placed.id },
      )
      setOperations({
        imageBusy: false,
        imageStatus: kind === 'cutout' ? '已去除背景，图片已追加到画布。' : '已去除近白背景，图片已追加到画布。',
      })
    } catch (error) {
      if (imageOperationToken.current !== operationToken) return
      const safe = error instanceof Error ? error.message : operationError(error)
      setOperations({
        imageBusy: false,
        imageStatus: `${kind === 'cutout' ? '去除背景失败：' : '去除白底失败：'}${safe === DETAIL_STALE_ERROR ? '编辑内容已变化，请重新操作。' : safe}`,
      })
    } finally {
      if (cutoutAbortController.current === controller) cutoutAbortController.current = null
      if (imageOperationToken.current === operationToken) imageAdmission.current = false
    }
  }

  const placeResource = (resourceId: string) => {
    const live = latestWorkflow.current.detailEditor
    const current = live.pages[live.activePageIndex]
    const resource = live.resources[resourceId]
    if (!current || !resource) return
    const count = current.layers.filter((layer) => layer.kind === 'image').length
    const layer = createImageLayer(`image-${live.nextLayerSequence}`, resource, count)
    mutatePage({ ...current, activeProductId: resource.id, layers: [...current.layers, layer] }, { selectedLayerId: layer.id, selectedResourceId: resource.id })
  }

  const removeResourcePlacement = (resourceId: string) => {
    const live = latestWorkflow.current.detailEditor
    const current = live.pages[live.activePageIndex]
    if (!current) return
    const removedIds = new Set(current.layers.filter((layer) => layer.kind === 'image' && layer.resourceId === resourceId).map((layer) => layer.id))
    mutatePage({ ...current, layers: current.layers.filter((layer) => !removedIds.has(layer.id)) }, {
      selectedLayerId: removedIds.has(live.selectedLayerId ?? '') ? null : live.selectedLayerId,
      selectedResourceId: resourceId,
    })
  }

  const handleExport = async () => {
    if (exportAdmission.current || confirmationAdmission.current || imageAdmission.current) return
    exportAdmission.current = true
    const live = latestWorkflow.current
    const current = live.detailEditor.pages[live.detailEditor.activePageIndex]
    const owner = live.detailEditor.owner
    if (!current || !owner) { exportAdmission.current = false; return }
    const capture = { owner: { ...owner }, pageId: current.id, revision: current.compositionRevision, resourceRevision: live.detailEditor.resourceRevision, ...captureV2Ownership(live) }
    const snapshot = { page: current, resources: { ...live.detailEditor.resources } }
    setOperations({ exportBusy: true, exportError: '', confirmationError: '' })
    try {
      const signatureSha256 = await detailPageSignatureSha256(current, snapshot.resources)
      assertCapture(capture)
      const pngBlob = await composeDetailPng(snapshot, () => assertCapture(capture))
      const validated = await validateDetailExport(pngBlob)
      assertCapture(capture)
      const pageExport: DetailPageExport = {
        pageId: current.id,
        revision: current.compositionRevision,
        signatureSha256,
        pngBlob,
        pngBlobSha256: validated.sha256,
        width: 750,
        height: 1334,
      }
      dispatch({
        type: 'STEP_FIVE_EXPORT_SUCCEEDED',
        owner: capture.owner,
        pageId: capture.pageId,
        expectedRevision: capture.revision,
        expectedSignatureSha256: signatureSha256,
        expectedResourceRevision: capture.resourceRevision,
        pageExport,
      })
    } catch (error) {
      setOperations({ exportBusy: false, exportError: error instanceof Error && error.message === DETAIL_STALE_ERROR ? '编辑内容已变化，请重新同步导出。' : '无法生成详情页 PNG，请重试。' })
    } finally {
      exportAdmission.current = false
    }
  }

  const handleConfirmation = async () => {
    if (confirmationAdmission.current || exportAdmission.current || imageAdmission.current) return
    const live = latestWorkflow.current
    const owner = live.detailEditor.owner
    if (!owner) return
    const exports = live.detailEditor.pages.map((item) => item.currentExport)
    if (exports.every((item) => item === null)) {
      setOperations({ confirmationError: '保存失败：还没有可导出的详情页，请先编辑并同步导出。' })
      return
    }
    const missing = exports.flatMap((item, index) => item ? [] : [index + 1])
    if (missing.length > 0) {
      setOperations({ confirmationError: `保存失败：第 ${missing.join('、')} 页还没有同步导出。请打开这些页稍等自动导出完成后再确认保存。` })
      return
    }
    confirmationAdmission.current = true
    const pageExports = exports as DetailPageExport[]
    const capture = {
      owner: { ...owner },
      pageId: live.detailEditor.pages[live.detailEditor.activePageIndex].id,
      revision: live.detailEditor.pages[live.detailEditor.activePageIndex].compositionRevision,
      resourceRevision: live.detailEditor.resourceRevision,
      ...captureV2Ownership(live),
    }
    setOperations({ confirmationBusy: true, confirmationError: '' })
    try {
      for (const item of pageExports) {
        const validated = await validateDetailExport(item.pngBlob)
        if (validated.sha256 !== item.pngBlobSha256) throw new Error(DETAIL_STALE_ERROR)
        assertCapture(capture)
        const livePage = latestWorkflow.current.detailEditor.pages.find((candidate) => candidate.id === item.pageId)
        if (livePage?.currentExport !== item) throw new Error(DETAIL_STALE_ERROR)
      }
      const groupSignatureSha256 = await detailGroupSignatureSha256(capture.owner, pageExports)
      assertCapture(capture)
      if (isV2DetailView(latestWorkflow.current)) {
        const session = latestWorkflow.current.workflowV2
        const project = session.detailProject
        const posterRef = currentV2PosterRef(latestWorkflow.current)
        if (!project || !posterRef || !samePosterRef(project.owner.posterRef, posterRef)) {
          throw new Error(DETAIL_STALE_ERROR)
        }
        const detailRevision = Math.max(
          ...latestWorkflow.current.detailEditor.pages.map(
            (item) => item.compositionRevision,
          ),
        )
        const confirmedDetail = await createConfirmedDetail({
          detailId: project.detailId,
          posterRef,
          detailRevision,
          resourceRevision: capture.resourceRevision,
          pageSignatureSha256: pageExports.map((item) => item.signatureSha256),
          pngBlobSha256: pageExports.map((item) => item.pngBlobSha256),
          groupSignatureSha256,
        })
        assertCapture(capture)
        dispatch({
          type: 'COMMIT_V2_DETAIL_CONFIRMATION',
          project,
          confirmedDetail,
          legacyOwner: capture.owner,
          expectedResourceRevision: capture.resourceRevision,
          pageExports,
          groupSignatureSha256,
        })
        return
      }
      dispatch({
        type: 'STEP_FIVE_CONFIRMATION_SUCCEEDED',
        owner: capture.owner,
        expectedResourceRevision: capture.resourceRevision,
        pageExports,
        groupSignatureSha256,
      })
    } catch {
      setOperations({ confirmationBusy: false, confirmationError: '保存失败：编辑内容已变化，请重新同步导出。' })
    } finally {
      confirmationAdmission.current = false
    }
  }

  const validAuthority = entryAuthority(workflow)
  const validConfirmation = currentConfirmation(workflow)
  const busy = detail.operations.exportBusy || detail.operations.confirmationBusy || detail.operations.imageBusy
  const navigationBusy = detail.operations.exportBusy || detail.operations.confirmationBusy
  const v2Detail = v2DetailView
  const v2PosterRef = currentV2PosterRef(workflow)

  if (v2Detail && (!validAuthority || !page || !detail.owner)) {
    const canStart = Boolean(v2PosterRef)
    return (
      <section aria-labelledby="detail-editor-heading" className="detail-editor-step detail-editor-step--guard">
        <h1 id="detail-editor-heading" ref={headingRef} tabIndex={-1}>详情页编辑</h1>
        <p>基于当前已确认海报，编辑并确认本轮使用的详情页。</p>
        <p role={workflow.workflowV2.detailEntryError ? 'alert' : undefined}>
          {workflow.workflowV2.detailEntryError || (
            canStart
              ? '当前海报已更新。保留的详情页不会被自动改绑。'
              : '请先确认一张当前海报，再开始详情页编辑。'
          )}
        </p>
        <div className="detail-editor-footer">
          {canStart ? (
            <button onClick={startNewDetailProject} type="button">使用当前海报开始新的详情页</button>
          ) : null}
          <button onClick={() => dispatch({ type: 'RETURN_FROM_V2_DETAIL' })} type="button">返回创作工作台</button>
        </div>
      </section>
    )
  }

  if (!validAuthority || !page || !detail.owner) {
    return (
      <section aria-labelledby="detail-editor-heading" className="detail-editor-step detail-editor-step--guard">
        <h1 id="detail-editor-heading">步骤 5：详情页制作</h1>
        <p role="alert">请先完成步骤 4 并确认保存定稿海报。</p>
        <div className="detail-editor-footer"><button onClick={() => dispatch({ type: 'GO_TO_STEP_FOUR' })} type="button">上一步</button></div>
      </section>
    )
  }

  const addPage = () => {
    const live = latestWorkflow.current.detailEditor
    const source = live.pages[live.activePageIndex]
    const owner = live.owner
    if (!source || !owner) return
    const next: DetailPage = {
      id: `page-${owner.generationId}-${owner.posterId}-${live.nextPageSequence}`,
      background: { ...source.background },
      activeProductId: source.activeProductId,
      selectedFontId: source.selectedFontId,
      layers: [],
      compositionRevision: 0,
      currentExport: null,
    }
    dispatch({ type: 'ADD_STEP_FIVE_PAGE', page: next })
  }

  const statusError = detail.operations.confirmationError || detail.operations.exportError || canvasError
  const pageSynchronized = page.currentExport?.revision === page.compositionRevision
  const hasCurrentExport = v2Detail
    ? detail.pages.length > 0 && detail.pages.every(
        (item) => item.currentExport?.revision === item.compositionRevision,
      )
    : detail.pages.some(
        (item) => item.currentExport?.revision === item.compositionRevision,
      )

  return (
    <section
      aria-busy={busy}
      aria-labelledby="detail-editor-heading"
      className="detail-editor-step"
      data-confirmed={validConfirmation ? 'true' : 'false'}
    >
      <h1 id="detail-editor-heading" ref={headingRef} tabIndex={v2Detail ? -1 : undefined}>
        {v2Detail ? '详情页编辑' : '步骤 5：详情页制作'}
      </h1>
      {v2Detail ? <p>基于当前已确认海报，编辑并确认本轮使用的详情页。</p> : null}
      <div className="detail-workbench">
        <div className="detail-canvas-column">
          {canvasError ? (
            <div className="detail-canvas-error">
              <p>详情页编辑器加载失败，请重试。</p>
              <button onClick={() => { setCanvasError(''); setCanvasRetryToken((value) => value + 1) }} type="button">重试加载编辑器</button>
            </div>
          ) : (
            <DetailEditorCanvas
              disabled={busy}
              onBeginPixelMutation={(pageId, expectedRevision) => dispatch({ type: 'BEGIN_STEP_FIVE_PIXEL_MUTATION', pageId, expectedRevision })}
              onCommitPixelMutation={(nextPage, expectedRevision) => dispatch({ type: 'COMMIT_STEP_FIVE_PIXEL_MUTATION', pageId: nextPage.id, expectedRevision, page: nextPage })}
              onRenderError={setCanvasError}
              onRenderSuccess={() => setCanvasError('')}
              onSelect={selectLayer}
              page={page}
              resources={detail.resources}
              retryToken={canvasRetryToken}
              selectedLayerId={detail.selectedLayerId}
            />
          )}
          <div aria-live="polite" className={`detail-page-status${statusError ? ' detail-page-status--error' : pageSynchronized ? ' detail-page-status--synced' : ''}`} role={statusError ? 'alert' : 'status'}>
            {statusError || (pageSynchronized ? `本页已同步导出（rev ${page.compositionRevision}）` : `第 ${detail.activePageIndex + 1} 页尚未同步导出`)}
          </div>
        </div>

        <aside className="detail-page-manager">
          <h2>页面</h2>
          <div className="detail-page-list">
            {detail.pages.map((item, index) => (
              <button aria-current={index === detail.activePageIndex ? 'page' : undefined} key={item.id} onClick={() => dispatch({ type: 'SET_STEP_FIVE_ACTIVE_PAGE', index })} type="button">
                <span>第 {index + 1} 页</span>
                <small>{item.currentExport?.revision === item.compositionRevision ? `rev ${item.compositionRevision}` : '未同步'}</small>
              </button>
            ))}
          </div>
          <div className="detail-page-navigation">
            <button disabled={busy || detail.activePageIndex === 0} onClick={() => dispatch({ type: 'SET_STEP_FIVE_ACTIVE_PAGE', index: detail.activePageIndex - 1 })} type="button">上一张</button>
            <span aria-live="polite">{detail.activePageIndex + 1} / {detail.pages.length}</span>
            <button disabled={busy || detail.activePageIndex === detail.pages.length - 1} onClick={() => dispatch({ type: 'SET_STEP_FIVE_ACTIVE_PAGE', index: detail.activePageIndex + 1 })} type="button">下一张</button>
          </div>
          <button className="detail-add-page" disabled={busy} onClick={addPage} type="button">添加页数</button>
        </aside>

        <DetailEditorInspector
          activePanel={detail.activePanel}
          busy={busy}
          imageStatus={detail.operations.imageStatus}
          nextLayerSequence={detail.nextLayerSequence}
          onBackground={(catalogId) => mutatePage({ ...page, background: systemBackground(catalogId) })}
          onClearCustomBackground={() => {
            if (page.background.kind !== 'custom') return
            mutatePage({ ...page, background: systemBackground(page.background.fallbackCatalogId) }, { removedResourceIds: [page.background.resourceId] })
          }}
          onCustomBackground={(file) => void customBackground(file)}
          onCutout={() => void transformResource('cutout')}
          onLibraryUpload={(file) => void uploadAndPlace(file)}
          onMutation={mutatePage}
          onPanel={(panel) => dispatch({ type: 'SET_STEP_FIVE_UI', panel })}
          onPlaceResource={placeResource}
          onRemoveResourcePlacement={removeResourcePlacement}
          onRemoveWhite={() => void transformResource('near-white')}
          onSelectResource={(resourceId) => dispatch({ type: 'SET_STEP_FIVE_UI', selectedResourceId: resourceId })}
          onUploadToCanvas={(file) => void uploadAndPlace(file)}
          page={page}
          resources={detail.resources}
          resourceUrls={resourceUrls}
          selectedLayerId={detail.selectedLayerId}
          selectedResourceId={detail.selectedResourceId}
        />
      </div>

      <div className="detail-editor-actions">
        <button aria-busy={detail.operations.exportBusy} disabled={busy} onClick={() => void handleExport()} type="button">{detail.operations.exportBusy ? '正在同步导出…' : '同步导出'}</button>
        <div className="detail-group-status">
          <p>{v2Detail
            ? (validConfirmation ? '详情页已确认' : '当前修改尚未确认')
            : (validConfirmation ? `已确认保存详情页（共 ${detail.pages.length} 页），可以进入下一步。` : '可添加多页并翻页编辑；确认保存会提交全部已导出的页面。')}</p>
          <button aria-busy={detail.operations.confirmationBusy} disabled={busy || !hasCurrentExport} onClick={() => void handleConfirmation()} type="button">{detail.operations.confirmationBusy ? '正在保存…' : (v2Detail ? '确认详情页' : '确认保存详情页')}</button>
        </div>
      </div>

      <div className="detail-editor-footer">
        <button className="detail-editor-footer__previous" disabled={v2Detail ? navigationBusy : busy} onClick={() => {
          if (v2Detail) {
            invalidateImageOperation()
            setOperations({ imageBusy: false, imageStatus: '' })
          }
          dispatch(v2Detail ? { type: 'RETURN_FROM_V2_DETAIL' } : { type: 'GO_TO_STEP_FOUR' })
        }} type="button">{v2Detail ? '返回创作工作台' : '上一步'}</button>
        <button className="detail-editor-footer__next" disabled={!validConfirmation || busy} onClick={() => dispatch(v2Detail ? { type: 'COMPLETE_V2_DETAIL' } : { type: 'COMPLETE_STEP_FIVE' })} type="button">{v2Detail ? '完成并返回创作工作台' : '下一步：营销策略'}</button>
      </div>
    </section>
  )
}

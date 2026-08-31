import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { isCurrentStepFourConfirmation } from '../../state/workflow-reducer'
import {
  useWorkflowDetailCommands,
  useWorkflowDispatch,
  useWorkflowState,
} from '../../state/use-workflow'
import { selectCurrentStepFourCompletion } from './poster-selectors'
import type {
  CompletePosterLayout,
  ConfirmedPoster,
  PosterBlobResource,
} from '../../types/poster-editor'
import { PosterEditorCanvas } from './PosterEditorCanvas'
import type { PosterEditorCanvasHandle } from './PosterEditorCanvas'
import { PosterEditorInspector } from './PosterEditorInspector'
import { composePosterPng } from './poster-renderer'
import type { PosterRenderSnapshot } from './poster-renderer'
import {
  POSTER_EXPORT_ERROR_MESSAGE,
  POSTER_IMAGE_DECODE_MESSAGE,
  POSTER_IMAGE_TYPE_MESSAGE,
  decodeRasterBlob,
  triggerPngDownload,
  validateRasterUpload,
} from './poster-resources'
import {
  completeInputSignatureSha256,
  layoutSha256,
  normalizeCompletePosterLayout,
  sameNormalizedLayout,
  sha256Blob,
} from './poster-signature'
import { removeNearWhiteBackground } from './white-removal'
import {
  createConfirmedPoster as createWorkflowV2ConfirmedPoster,
  createPosterCopySnapshot,
} from '../../state/workflow-v2/workflow-v2-authorities'

const STALE_COMPOSITION = 'stale-poster-composition'

function safeOperationError(error: unknown) {
  const message = error instanceof Error ? error.message : ''
  if (message === STALE_COMPOSITION) return '编辑内容已变化，请重新操作。'
  if (message === POSTER_IMAGE_TYPE_MESSAGE || message === POSTER_IMAGE_DECODE_MESSAGE) return message
  if (/font/i.test(message)) return '字体加载失败，请重试。'
  if (/overlay|image|图片/.test(message)) return '图片资源不可用，请重新上传。'
  return POSTER_EXPORT_ERROR_MESSAGE
}

function renderSnapshot(
  active: NonNullable<ReturnType<typeof useWorkflowState>['posterEditor']['active']>,
  layout: CompletePosterLayout,
  resources: ReturnType<typeof useWorkflowState>['posterEditor']['resources'],
): PosterRenderSnapshot {
  const base = resources[active.baseBlobId]
  if (!base || base.kind !== 'base' || base.sha256 !== active.baseBlobSha256) {
    throw new Error('base unavailable')
  }
  const overlays = new Map<string, PosterBlobResource>()
  for (const image of layout.images) {
    const resource = resources[image.blobId]
    if (!resource || resource.kind !== 'overlay' || resource.sha256 !== image.sha256) {
      throw new Error('overlay unavailable')
    }
    overlays.set(image.blobId, resource)
  }
  return { active: { ...active }, layout, base, overlays }
}

function completionMatchesConfirmation(
  completion: ReturnType<typeof useWorkflowState>['posterEditor']['completion'],
  confirmed: ConfirmedPoster | null,
) {
  return Boolean(
    completion &&
      confirmed &&
      completion.generationId === confirmed.generationId &&
      completion.posterId === confirmed.posterId &&
      completion.confirmedRevision === confirmed.confirmedRevision &&
      completion.baseBlobSha256 === confirmed.baseBlobSha256 &&
      completion.layoutSha256 === confirmed.layoutSha256 &&
      completion.upstreamSha256 === confirmed.upstreamSha256 &&
      completion.pngBlobSha256 === confirmed.pngBlobSha256,
  )
}

export function PosterEditorStep() {
  const workflow = useWorkflowState()
  const dispatch = useWorkflowDispatch()
  const { enterDetail } = useWorkflowDetailCommands()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const editor = workflow.posterEditor
  const v2PosterFlow = workflow.workflowV2.phase === 'active' && workflow.workflowV2.view === 'poster'

  useEffect(() => {
    if (v2PosterFlow) headingRef.current?.focus({ preventScroll: true })
  }, [v2PosterFlow])
  const active = editor.active
  const draft = active ? editor.drafts[active.draftKey ?? active.generationId] ?? null : null
  const latestWorkflow = useRef(workflow)
  const canvasHandle = useRef<PosterEditorCanvasHandle>(null)
  const exportAdmission = useRef(false)
  const confirmationAdmission = useRef(false)
  const imageAdmission = useRef(false)
  const stepFiveAdmission = useRef(false)
  const [imageBusy, setImageBusy] = useState(false)
  const [previewError, setPreviewError] = useState('')
  const [stepFiveEntryRequested, setStepFiveEntryRequested] = useState(false)
  const [stepFiveEntryError, setStepFiveEntryError] = useState('')
  const handlePreviewSuccess = useCallback(() => setPreviewError(''), [])

  useLayoutEffect(() => {
    latestWorkflow.current = workflow
  }, [workflow])

  const snapshot = useMemo(() => {
    if (!active || !draft) return null
    try {
      return renderSnapshot(active, draft.layout, editor.resources)
    } catch {
      return null
    }
  }, [active, draft, editor.resources])

  const validConfirmation = isCurrentStepFourConfirmation(editor)
  const completionCurrent = validConfirmation && completionMatchesConfirmation(editor.completion, editor.confirmedPoster)
  const operationBusy = editor.operations.exportBusy || editor.operations.confirmationBusy || imageBusy || stepFiveEntryRequested

  useEffect(() => {
    if (!stepFiveEntryRequested || !completionCurrent) return
    let disposed = false
    const enter = async () => {
      try {
        const captured = latestWorkflow.current
        const confirmed = captured.posterEditor.confirmedPoster
        const completion = selectCurrentStepFourCompletion(captured.posterEditor)
        if (captured.currentStep !== 4 || !confirmed || !completion) throw new Error(STALE_COMPOSITION)
        const expected = {
          generationId: confirmed.generationId,
          posterId: confirmed.posterId,
          inputSignatureSha256: confirmed.inputSignatureSha256,
          pngBlobSha256: confirmed.pngBlobSha256,
          blob: confirmed.pngBlob,
        }
        const { validateStepFiveEntryPoster } = await import('../detail-editor/detail-resources')
        const entry = await validateStepFiveEntryPoster(confirmed)
        const live = latestWorkflow.current
        const liveConfirmed = live.posterEditor.confirmedPoster
        const liveCompletion = selectCurrentStepFourCompletion(live.posterEditor)
        if (
          live.currentStep !== 4 ||
          !liveCompletion ||
          !liveConfirmed ||
          liveConfirmed.generationId !== expected.generationId ||
          liveConfirmed.posterId !== expected.posterId ||
          liveConfirmed.inputSignatureSha256 !== expected.inputSignatureSha256 ||
          liveConfirmed.pngBlobSha256 !== expected.pngBlobSha256 ||
          liveConfirmed.pngBlob !== expected.blob
        ) throw new Error(STALE_COMPOSITION)
        dispatch(v2PosterFlow
          ? { type: 'ENTER_V2_LEGACY_DETAIL' }
          : { type: 'COMPLETE_STEP_FOUR', entry: { owner: entry.owner, posterResource: entry.resource } })
      } catch {
        if (!disposed) setStepFiveEntryError('无法验证定稿海报，请重新确认保存。')
      } finally {
        stepFiveAdmission.current = false
        if (!disposed) setStepFiveEntryRequested(false)
      }
    }
    void enter()
    return () => { disposed = true }
  }, [completionCurrent, dispatch, stepFiveEntryRequested, v2PosterFlow])

  const handleStepFiveEntry = () => {
    if (stepFiveAdmission.current || operationBusy || !validConfirmation) return
    if (v2PosterFlow) {
      enterDetail()
      return
    }
    stepFiveAdmission.current = true
    setStepFiveEntryError('')
    setStepFiveEntryRequested(true)
    dispatch(v2PosterFlow ? { type: 'ENTER_V2_LEGACY_DETAIL' } : { type: 'COMPLETE_STEP_FOUR' })
  }

  const commitLayout = useCallback(
    (layout: CompletePosterLayout, options?: { addedResources?: PosterBlobResource[]; removedResourceIds?: string[]; imageStatus?: string }) => {
      const current = latestWorkflow.current.posterEditor
      const currentActive = current.active
      if (!currentActive) return
      const currentDraft = current.drafts[currentActive.draftKey ?? currentActive.generationId]
      if (!currentDraft) return
      const normalized = normalizeCompletePosterLayout(layout)
      const retainedIds = new Set(normalized.images.map((image) => image.blobId))
      const removedResourceIds = new Set(options?.removedResourceIds ?? [])
      for (const image of currentDraft.layout.images) {
        if (!retainedIds.has(image.blobId)) removedResourceIds.add(image.blobId)
      }
      dispatch({
        type: 'COMMIT_STEP_FOUR_MUTATION',
        layout: normalized,
        addedResources: options?.addedResources,
        removedResourceIds: [...removedResourceIds],
        imageStatus: options?.imageStatus,
      })
    },
    [dispatch],
  )

  const selectObject = useCallback(
    (kind: 'text' | 'shape' | 'image', id: string) => {
      dispatch({
        type: 'SET_STEP_FOUR_UI',
        panel: kind,
        selectedTextId: kind === 'text' ? id : null,
        selectedShapeId: kind === 'shape' ? id : null,
        selectedImageId: kind === 'image' ? id : null,
      })
    },
    [dispatch],
  )

  useEffect(() => {
    const handleDelete = (event: KeyboardEvent) => {
      if (event.key !== 'Delete' && event.key !== 'Backspace') return
      const target = event.target
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) return
      const current = latestWorkflow.current.posterEditor
      const currentActive = current.active
      if (!currentActive) return
      const currentDraft = current.drafts[currentActive.draftKey ?? currentActive.generationId]
      if (!currentDraft) return
      if (current.selectedShapeId && currentDraft.layout.shapes.some((shape) => shape.id === current.selectedShapeId)) {
        event.preventDefault()
        commitLayout({ ...currentDraft.layout, shapes: currentDraft.layout.shapes.filter((shape) => shape.id !== current.selectedShapeId) })
        return
      }
      if (current.selectedImageId && currentDraft.layout.images.some((image) => image.id === current.selectedImageId)) {
        event.preventDefault()
        commitLayout({ ...currentDraft.layout, images: currentDraft.layout.images.filter((image) => image.id !== current.selectedImageId) })
        return
      }
      const text = currentDraft.layout.textBoxes.find((box) => box.id === current.selectedTextId)
      if (text?.role.startsWith('custom-')) {
        event.preventDefault()
        commitLayout({ ...currentDraft.layout, textBoxes: currentDraft.layout.textBoxes.filter((box) => box.id !== text.id) })
      }
    }
    window.addEventListener('keydown', handleDelete)
    return () => window.removeEventListener('keydown', handleDelete)
  }, [commitLayout])

  if (!active || !draft) {
    const hasReady = Boolean(
      workflow.posterGeneration.result?.posters.some((slot) => slot.status === 'ready' && slot.posterId),
    )
    return (
      <section aria-labelledby="poster-editor-heading" className="poster-editor-step poster-editor-step--guard">
        <h1 id="poster-editor-heading">步骤 4：文字编辑</h1>
        <p role="alert">{hasReady ? '所选底图不可用，请返回步骤 3 重新选用。' : '暂无可用底图，请等待至少一张海报生成完成。'}</p>
        <div className="poster-editor-footer poster-editor-footer--guard">
          <button className="poster-editor-footer__previous" onClick={() => dispatch({ type: 'GO_TO_STEP_THREE' })} type="button">上一步</button>
        </div>
      </section>
    )
  }

  if (!snapshot) {
    return (
      <section aria-labelledby="poster-editor-heading" className="poster-editor-step poster-editor-step--guard">
        <h1 id="poster-editor-heading">步骤 4：文字编辑</h1>
        <p role="alert">所选底图不可用，请返回步骤 3 重新选用。</p>
        <div className="poster-editor-footer poster-editor-footer--guard">
          <button className="poster-editor-footer__previous" onClick={() => dispatch({ type: 'GO_TO_STEP_THREE' })} type="button">上一步</button>
        </div>
      </section>
    )
  }

  const captureCandidate = () => {
    const current = latestWorkflow.current
    const currentEditor = current.posterEditor
    const currentActive = currentEditor.active
    if (!currentActive || current.currentStep !== 4) throw new Error(STALE_COMPOSITION)
    const currentDraft = currentEditor.drafts[currentActive.draftKey ?? currentActive.generationId]
    if (!currentDraft) throw new Error(STALE_COMPOSITION)
    const candidate = normalizeCompletePosterLayout(
      canvasHandle.current?.materializeLayout() ?? currentDraft.layout,
    )
    const differs = !sameNormalizedLayout(candidate, currentDraft.layout)
    const expectedRevision = currentEditor.compositionRevision + (differs ? 1 : 0)
    if (differs) {
      dispatch({ type: 'COMMIT_STEP_FOUR_MUTATION', layout: candidate })
    }
    const resourceSnapshot = { ...currentEditor.resources }
    const render = renderSnapshot({ ...currentActive }, candidate, resourceSnapshot)
    const captured = {
      active: { ...currentActive },
      candidate,
      expectedRevision,
      editorResourceRevision: currentEditor.resourceRevision,
      resources: resourceSnapshot,
      render,
    }
    const assertCurrent = () => {
      const live = latestWorkflow.current
      const liveEditor = live.posterEditor
      const liveActive = liveEditor.active
      const liveDraft = liveActive ? liveEditor.drafts[liveActive.draftKey ?? liveActive.generationId] : null
      if (
        live.currentStep !== 4 ||
        !liveActive ||
        !liveDraft ||
        liveActive.generationId !== captured.active.generationId ||
        liveActive.posterId !== captured.active.posterId ||
        liveActive.slot !== captured.active.slot ||
        liveActive.baseBlobSha256 !== captured.active.baseBlobSha256 ||
        liveActive.upstreamSha256 !== captured.active.upstreamSha256 ||
        liveEditor.compositionRevision !== captured.expectedRevision ||
        liveEditor.resourceRevision !== captured.editorResourceRevision ||
        !sameNormalizedLayout(liveDraft.layout, captured.candidate)
      ) throw new Error(STALE_COMPOSITION)
      for (const image of captured.candidate.images) {
        const liveResource = liveEditor.resources[image.blobId]
        if (!liveResource || liveResource.sha256 !== image.sha256) throw new Error(STALE_COMPOSITION)
      }
    }
    return { ...captured, assertCurrent }
  }

  const handleExport = async () => {
    if (exportAdmission.current || confirmationAdmission.current) return
    exportAdmission.current = true
    try {
      const captured = captureCandidate()
      dispatch({ type: 'BEGIN_STEP_FOUR_EXPORT' })
      const blob = await composePosterPng(captured.render, captured.assertCurrent)
      captured.assertCurrent()
      triggerPngDownload(blob, `poster-composed-${captured.active.slot}.png`)
      dispatch({ type: 'STEP_FOUR_EXPORT_FINISHED' })
    } catch (error) {
      dispatch({ type: 'STEP_FOUR_EXPORT_FAILED', error: safeOperationError(error) })
    } finally {
      exportAdmission.current = false
    }
  }

  const handleConfirm = async () => {
    if (confirmationAdmission.current || exportAdmission.current) return
    confirmationAdmission.current = true
    try {
      const captured = captureCandidate()
      dispatch({ type: 'BEGIN_STEP_FOUR_CONFIRMATION' })
      const candidateLayoutSha256 = await layoutSha256(captured.candidate)
      captured.assertCurrent()
      const inputSignatureSha256 = await completeInputSignatureSha256({
        generationId: captured.active.generationId,
        posterId: captured.active.posterId,
        slot: captured.active.slot,
        baseBlobSha256: captured.active.baseBlobSha256,
        layoutSha256: candidateLayoutSha256,
        upstreamSha256: captured.active.upstreamSha256,
        overlayBlobSha256: captured.candidate.images.map((image) => image.sha256),
      })
      captured.assertCurrent()
      const pngBlob = await composePosterPng(captured.render, captured.assertCurrent)
      const pngBlobSha256 = await sha256Blob(pngBlob)
      captured.assertCurrent()
      const confirmed: ConfirmedPoster = {
        generationId: captured.active.generationId,
        posterId: captured.active.posterId,
        slot: captured.active.slot,
        baseBlobSha256: captured.active.baseBlobSha256,
        layoutSha256: candidateLayoutSha256,
        upstreamSha256: captured.active.upstreamSha256,
        inputSignatureSha256,
        copySnapshot: { ...captured.active.copySnapshot },
        layout: captured.candidate,
        pngBlob,
        pngBlobSha256,
        confirmedRevision: captured.expectedRevision,
      }
      dispatch({ type: 'STEP_FOUR_CONFIRMATION_SUCCEEDED', snapshot: confirmed, expectedRevision: captured.expectedRevision })
      const capturedSession = latestWorkflow.current.workflowV2
      const project = captured.active.posterProjectInputSignatureSha256
        ? capturedSession.posterProject
        : null
      if (
        project &&
        project.inputSignatureSha256 === captured.active.posterProjectInputSignatureSha256
      ) {
        const copySnapshot = await createPosterCopySnapshot({
          fields: {
            body: captured.active.copySnapshot.body,
            title: captured.active.copySnapshot.title,
            headline: captured.active.copySnapshot.headline,
            subline: captured.active.copySnapshot.subline,
          },
          platform: project.platform,
          style: project.style,
          sourceMode: project.copySource,
          sourceCopyRef: project.copyRef ?? undefined,
        })
        captured.assertCurrent()
        const v2Poster = await createWorkflowV2ConfirmedPoster({
          project,
          generationId: captured.active.generationId,
          posterId: captured.active.posterId,
          slot: captured.active.slot,
          baseBlobSha256: captured.active.baseBlobSha256,
          layoutSha256: candidateLayoutSha256,
          upstreamSha256: captured.active.upstreamSha256,
          compositionInputSignatureSha256: inputSignatureSha256,
          pngBlobSha256,
          confirmedRevision: captured.expectedRevision,
          resourceRevision: captured.editorResourceRevision,
          copySnapshot,
        })
        const live = latestWorkflow.current.workflowV2
        if (
          live.phase === 'active' &&
          live.epoch === capturedSession.epoch &&
          live.posterProject?.inputSignatureSha256 === project.inputSignatureSha256
        ) {
          dispatch({ type: 'COMMIT_V2_CONFIRMED_POSTER', poster: v2Poster })
        }
      }
    } catch (error) {
      dispatch({ type: 'STEP_FOUR_CONFIRMATION_FAILED', error: safeOperationError(error) })
    } finally {
      confirmationAdmission.current = false
    }
  }

  const handleUpload = async (file: File) => {
    if (imageAdmission.current) return
    imageAdmission.current = true
    setImageBusy(true)
    const starting = latestWorkflow.current.posterEditor
    const startingActive = starting.active
    const startingDraft = startingActive ? starting.drafts[startingActive.draftKey ?? startingActive.generationId] : null
    try {
      if (!startingActive || !startingDraft) throw new Error(STALE_COMPOSITION)
      const validated = await validateRasterUpload(file)
      const sha256 = await sha256Blob(validated.blob)
      const live = latestWorkflow.current.posterEditor
      if (
        live.active?.generationId !== startingActive.generationId ||
        live.active?.posterId !== startingActive.posterId ||
        live.compositionRevision !== starting.compositionRevision
      ) throw new Error(STALE_COMPOSITION)
      const blobId = `overlay:${sha256}:${globalThis.crypto.randomUUID()}`
      const imageId = `img-${globalThis.crypto.randomUUID()}`
      const resource: PosterBlobResource = {
        id: blobId,
        kind: 'overlay',
        blob: validated.blob,
        sha256,
        mimeType: validated.mimeType,
        name: file.name,
        width: validated.width,
        height: validated.height,
      }
      commitLayout(
        {
          ...startingDraft.layout,
          images: [
            ...startingDraft.layout.images,
            { id: imageId, name: file.name, x: 0.08, y: 0.08, w: 0.22, h: 0.14, blobId, sha256 },
          ],
        },
        { addedResources: [resource], imageStatus: '' },
      )
      selectObject('image', imageId)
    } catch (error) {
      const current = latestWorkflow.current.posterEditor
      const currentDraft = current.active ? current.drafts[current.active.draftKey ?? current.active.generationId] : null
      if (currentDraft) commitLayout(currentDraft.layout, { imageStatus: `上传失败：${safeOperationError(error)}` })
    } finally {
      imageAdmission.current = false
      setImageBusy(false)
    }
  }

  const handleRemoveWhite = async () => {
    if (imageAdmission.current) return
    imageAdmission.current = true
    setImageBusy(true)
    const starting = latestWorkflow.current.posterEditor
    const startingActive = starting.active
    const startingDraft = startingActive ? starting.drafts[startingActive.draftKey ?? startingActive.generationId] : null
    const selected = startingDraft?.layout.images.find((image) => image.id === starting.selectedImageId)
    const source = selected ? starting.resources[selected.blobId] : null
    try {
      if (!startingActive || !startingDraft || !selected || !source) throw new Error(POSTER_IMAGE_DECODE_MESSAGE)
      const blob = await removeNearWhiteBackground(source.blob)
      const sha256 = await sha256Blob(blob)
      const decoded = await decodeRasterBlob(blob)
      const width = decoded.width
      const height = decoded.height
      decoded.close()
      const live = latestWorkflow.current.posterEditor
      if (
        live.active?.generationId !== startingActive.generationId ||
        live.active?.posterId !== startingActive.posterId ||
        live.compositionRevision !== starting.compositionRevision
      ) throw new Error(STALE_COMPOSITION)
      const blobId = `overlay:${sha256}:${globalThis.crypto.randomUUID()}`
      const resource: PosterBlobResource = { id: blobId, kind: 'overlay', blob, sha256, mimeType: 'image/png', name: selected.name, width, height }
      commitLayout(
        { ...startingDraft.layout, images: startingDraft.layout.images.map((image) => image.id === selected.id ? { ...image, blobId, sha256 } : image) },
        { addedResources: [resource], removedResourceIds: [selected.blobId], imageStatus: '已去除近白背景。' },
      )
    } catch (error) {
      const current = latestWorkflow.current.posterEditor
      const currentDraft = current.active ? current.drafts[current.active.draftKey ?? current.active.generationId] : null
      if (currentDraft) commitLayout(currentDraft.layout, { imageStatus: `去除白底失败：${safeOperationError(error)}` })
    } finally {
      imageAdmission.current = false
      setImageBusy(false)
    }
  }

  const statusError = editor.operations.confirmationError
    ? `保存失败：${editor.operations.confirmationError}`
    : editor.operations.exportError
      ? `导出失败：${editor.operations.exportError}`
      : previewError
        ? `保存失败：${previewError}`
        : stepFiveEntryError
          ? `保存失败：${stepFiveEntryError}`
          : ''

  return (
    <section
      aria-busy={operationBusy}
      aria-labelledby="poster-editor-heading"
      className="poster-editor-step"
      data-completion-current={completionCurrent ? 'true' : 'false'}
      data-confirmed={validConfirmation ? 'true' : 'false'}
    >
      <h1 ref={headingRef} id="poster-editor-heading" tabIndex={-1}>{v2PosterFlow ? '海报创作' : '步骤 4：文字编辑'}</h1>
      <div className="poster-editor-workspace">
        <div className="poster-editor-preview-column">
          <PosterEditorCanvas
            disabled={operationBusy}
            onCommit={commitLayout}
            onRenderError={setPreviewError}
            onRenderSuccess={handlePreviewSuccess}
            onSelect={selectObject}
            ref={canvasHandle}
            selectedImageId={editor.selectedImageId}
            selectedShapeId={editor.selectedShapeId}
            selectedTextId={editor.selectedTextId}
            snapshot={snapshot}
          />
          <div aria-live="polite" className={`poster-editor-status${statusError ? ' poster-editor-status--error' : validConfirmation ? ' poster-editor-status--confirmed' : ''}`} role={statusError ? 'alert' : 'status'}>
            {statusError || (validConfirmation ? '已确认保存定稿海报与文案，可以进入下一步。' : '编辑完成后，请点击下方按钮确认保存。')}
          </div>
        </div>
        <PosterEditorInspector
          busy={operationBusy}
          copySnapshot={active.copySnapshot}
          imageStatus={editor.operations.imageStatus}
          layout={draft.layout}
          onLayout={commitLayout}
          onPanel={(panel) => dispatch({ type: 'SET_STEP_FOUR_UI', panel })}
          onRemoveWhite={handleRemoveWhite}
          onSelectImage={(id) => selectObject('image', id)}
          onSelectShape={(id) => selectObject('shape', id)}
          onSelectText={(id) => selectObject('text', id)}
          onUpload={handleUpload}
          panel={editor.activePanel}
          selectedImageId={editor.selectedImageId}
          selectedShapeId={editor.selectedShapeId}
          selectedTextId={editor.selectedTextId}
        />
      </div>
      <div className="poster-editor-actions">
        <button aria-busy={editor.operations.exportBusy} disabled={operationBusy} onClick={() => void handleExport()} type="button">
          {editor.operations.exportBusy ? '正在导出…' : '导出 PNG'}
        </button>
        <button aria-busy={editor.operations.confirmationBusy} disabled={operationBusy} onClick={() => void handleConfirm()} type="button">
          {editor.operations.confirmationBusy ? '正在保存…' : v2PosterFlow ? '确认海报' : '确认保存海报与文案'}
        </button>
      </div>
      <div className="poster-editor-footer">
        <button className="poster-editor-footer__previous" disabled={false} onClick={() => dispatch({ type: 'GO_TO_STEP_THREE' })} type="button">{v2PosterFlow ? '返回海报方案' : '上一步'}</button>
        <button className="poster-editor-footer__next" disabled={!validConfirmation || operationBusy} onClick={handleStepFiveEntry} type="button">{stepFiveEntryRequested ? '正在进入…' : '下一步：详情页制作'}</button>
      </div>
    </section>
  )
}

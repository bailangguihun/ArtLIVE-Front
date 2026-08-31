import { sameDetailOwner } from '../detail-editor/detail-defaults'
import {
  isCurrentStep6Completion,
  selectCurrentStep5Authority,
  sha256TextSync,
} from '../marketing-strategy/marketing-strategy-model'
import { canonicalJson } from '../poster-editor/poster-signature'
import type { WorkflowState } from '../../state/workflow-types'
import type { PosterCopySnapshot } from '../../types/poster-editor'
import {
  FINAL_RESULTS_PNG_MIME,
  type FinalGalleryAsset,
  type FinalResultsViewModel,
} from '../../types/final-results'

const SHA256 = /^[a-f0-9]{64}$/i
const POSTER_WIDTH = 1024
const POSTER_HEIGHT = 1536
const DETAIL_WIDTH = 750
const DETAIL_HEIGHT = 1334
const EMPTY_COPY = '（空）'
const FINAL_RESULTS_VERSION = 'final-results-v1'

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && SHA256.test(value)
}

function isPngBlob(value: unknown): value is Blob {
  return value instanceof Blob && value.type === FINAL_RESULTS_PNG_MIME && value.size > 0
}

function sameCopySnapshot(
  left: PosterCopySnapshot | undefined,
  right: PosterCopySnapshot | undefined,
) {
  return Boolean(
    left &&
      right &&
      left.body === right.body &&
      left.title === right.title &&
      left.headline === right.headline &&
      left.subline === right.subline &&
      left.platform === right.platform &&
      left.style === right.style,
  )
}

function selectCurrentPoster(state: WorkflowState) {
  const editor = state.posterEditor
  const active = editor.active
  const confirmed = editor.confirmedPoster
  const completion = editor.completion
  if (
    !state.completedSteps.has(4) ||
    !active ||
    !confirmed ||
    !completion ||
    !editor.currentLayoutSha256 ||
    confirmed.generationId !== active.generationId ||
    confirmed.posterId !== active.posterId ||
    confirmed.slot !== active.slot ||
    confirmed.baseBlobSha256 !== active.baseBlobSha256 ||
    confirmed.upstreamSha256 !== active.upstreamSha256 ||
    confirmed.layoutSha256 !== editor.currentLayoutSha256 ||
    confirmed.confirmedRevision !== editor.compositionRevision ||
    !sameCopySnapshot(active.copySnapshot, confirmed.copySnapshot) ||
    completion.generationId !== confirmed.generationId ||
    completion.posterId !== confirmed.posterId ||
    completion.confirmedRevision !== confirmed.confirmedRevision ||
    completion.baseBlobSha256 !== confirmed.baseBlobSha256 ||
    completion.layoutSha256 !== confirmed.layoutSha256 ||
    completion.upstreamSha256 !== confirmed.upstreamSha256 ||
    completion.pngBlobSha256 !== confirmed.pngBlobSha256 ||
    !isSha256(confirmed.baseBlobSha256) ||
    !isSha256(confirmed.layoutSha256) ||
    !isSha256(confirmed.upstreamSha256) ||
    !isSha256(confirmed.inputSignatureSha256) ||
    !isSha256(confirmed.pngBlobSha256) ||
    !isPngBlob(confirmed.pngBlob)
  ) return null
  return confirmed
}

function signature(kind: string, value: unknown) {
  return sha256TextSync(`${kind}:${canonicalJson(value)}`)
}

export function selectFinalResultsViewModel(
  state: WorkflowState,
): FinalResultsViewModel | null {
  const step6Completion = state.marketingStrategyStep.completion
  if (
    !step6Completion ||
    !isCurrentStep6Completion(state, step6Completion) ||
    (step6Completion.strategyStatus !== 'present' &&
      step6Completion.strategyStatus !== 'absent')
  ) return null

  const poster = selectCurrentPoster(state)
  const step5Authority = selectCurrentStep5Authority(state)
  const detail = state.detailEditor
  const owner = detail.owner
  const confirmed = detail.confirmedDetails
  const detailCompletion = detail.completion
  const posterResource = detail.resources['poster-final']
  if (
    !poster ||
    !step5Authority ||
    !owner ||
    !confirmed ||
    !detailCompletion ||
    !sameDetailOwner(owner, confirmed.owner) ||
    !sameDetailOwner(owner, detailCompletion.owner) ||
    owner.generationId !== poster.generationId ||
    owner.posterId !== poster.posterId ||
    owner.inputSignatureSha256 !== poster.inputSignatureSha256 ||
    owner.pngBlobSha256 !== poster.pngBlobSha256 ||
    !Number.isSafeInteger(detail.resourceRevision) ||
    detail.resourceRevision < 1 ||
    confirmed.confirmedResourceRevision !== detail.resourceRevision ||
    confirmed.groupSignatureSha256 !== step5Authority.groupSignatureSha256 ||
    !isSha256(confirmed.groupSignatureSha256) ||
    confirmed.pageExports.length === 0 ||
    confirmed.pageExports.length !== detail.pages.length ||
    confirmed.pageExports.length !== confirmed.pngBlobs.length ||
    confirmed.pageExports.length !== detailCompletion.pageCount ||
    confirmed.pageExports.length !== step5Authority.pageCount ||
    confirmed.firstPngBlob !== confirmed.pageExports[0].pngBlob ||
    confirmed.firstPngBlob !== confirmed.pngBlobs[0] ||
    !posterResource ||
    posterResource.id !== 'poster-final' ||
    posterResource.kind !== 'poster-final' ||
    posterResource.name !== '定稿海报' ||
    posterResource.blob !== poster.pngBlob ||
    posterResource.sha256 !== poster.pngBlobSha256 ||
    posterResource.mimeType !== FINAL_RESULTS_PNG_MIME ||
    posterResource.width !== POSTER_WIDTH ||
    posterResource.height !== POSTER_HEIGHT
  ) return null

  const seenPageIds = new Set<string>()
  const detailAssets: FinalGalleryAsset[] = []
  for (let index = 0; index < confirmed.pageExports.length; index += 1) {
    const page = detail.pages[index]
    const pageExport = confirmed.pageExports[index]
    if (
      !page ||
      !pageExport ||
      !pageExport.pageId ||
      seenPageIds.has(pageExport.pageId) ||
      page.id !== pageExport.pageId ||
      page.currentExport !== pageExport ||
      page.compositionRevision !== pageExport.revision ||
      confirmed.pngBlobs[index] !== pageExport.pngBlob ||
      detailCompletion.pngBlobSha256[index] !== pageExport.pngBlobSha256 ||
      step5Authority.pngBlobSha256[index] !== pageExport.pngBlobSha256 ||
      !isSha256(pageExport.signatureSha256) ||
      !isSha256(pageExport.pngBlobSha256) ||
      !isPngBlob(pageExport.pngBlob) ||
      pageExport.width !== DETAIL_WIDTH ||
      pageExport.height !== DETAIL_HEIGHT
    ) return null
    seenPageIds.add(pageExport.pageId)
    detailAssets.push({
      kind: 'detail',
      ordinal: index + 2,
      title: `详情页 ${index + 1}`,
      fileName: `detail-final-${index + 1}.png`,
      mimeType: FINAL_RESULTS_PNG_MIME,
      width: DETAIL_WIDTH,
      height: DETAIL_HEIGHT,
      blob: pageExport.pngBlob,
      sha256: pageExport.pngBlobSha256,
      sourceSignatureSha256: pageExport.signatureSha256,
    })
  }

  const posterAsset: FinalGalleryAsset = {
    kind: 'poster',
    ordinal: 1,
    title: '定稿海报',
    fileName: 'poster-final.png',
    mimeType: FINAL_RESULTS_PNG_MIME,
    width: POSTER_WIDTH,
    height: POSTER_HEIGHT,
    blob: poster.pngBlob,
    sha256: poster.pngBlobSha256,
    sourceSignatureSha256: poster.inputSignatureSha256,
  }
  const finalBody = poster.copySnapshot.body.trim()
  const bodySignatureSha256 = signature('final-copy', {
    body: finalBody,
    generationId: poster.generationId,
    posterId: poster.posterId,
    inputSignatureSha256: poster.inputSignatureSha256,
    upstreamSha256: poster.upstreamSha256,
  })
  const step7SignatureSha256 = signature('step7', {
    version: FINAL_RESULTS_VERSION,
    copy: {
      bodySignatureSha256,
      platform: poster.copySnapshot.platform,
      style: poster.copySnapshot.style,
    },
    poster: {
      generationId: poster.generationId,
      posterId: poster.posterId,
      confirmedRevision: poster.confirmedRevision,
      inputSignatureSha256: poster.inputSignatureSha256,
      layoutSha256: poster.layoutSha256,
      upstreamSha256: poster.upstreamSha256,
      pngBlobSha256: poster.pngBlobSha256,
    },
    details: {
      owner,
      groupSignatureSha256: confirmed.groupSignatureSha256,
      resourceRevision: detail.resourceRevision,
      pages: confirmed.pageExports.map((item) => ({
        pageId: item.pageId,
        revision: item.revision,
        signatureSha256: item.signatureSha256,
        pngBlobSha256: item.pngBlobSha256,
        width: item.width,
        height: item.height,
      })),
    },
    step6SignatureSha256: step6Completion.step6SignatureSha256,
  })

  return {
    finalCopy: {
      body: finalBody,
      displayBody: finalBody || EMPTY_COPY,
      empty: finalBody.length === 0,
      owner: {
        generationId: poster.generationId,
        posterId: poster.posterId,
        confirmedRevision: poster.confirmedRevision,
        inputSignatureSha256: poster.inputSignatureSha256,
        upstreamSha256: poster.upstreamSha256,
        bodySignatureSha256,
        step6SourceKind: step6Completion.strategySourceKind,
        step6SourceOwnerSignatureSha256:
          step6Completion.strategySourceOwnerSignatureSha256,
      },
    },
    poster: posterAsset,
    details: detailAssets,
    gallery: [posterAsset, ...detailAssets],
    detailResourceRevision: detail.resourceRevision,
    signatures: {
      step4InputSignatureSha256: poster.inputSignatureSha256,
      step4LayoutSha256: poster.layoutSha256,
      step4PngBlobSha256: poster.pngBlobSha256,
      step5GroupSignatureSha256: confirmed.groupSignatureSha256,
      step6SignatureSha256: step6Completion.step6SignatureSha256,
      step7SignatureSha256,
    },
  }
}

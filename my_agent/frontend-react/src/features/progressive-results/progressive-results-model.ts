import { sameDetailOwner } from '../detail-editor/detail-defaults'
import {
  isConfirmedDetailInternallyConsistent,
  posterRefFromConfirmedPoster,
  samePosterRef,
} from '../../state/workflow-v2/workflow-v2-authorities'
import { selectProgressiveResults } from '../../state/workflow-v2/workflow-v2-selectors'
import type {
  ProgressiveResultsSelection,
  ProgressiveResultArtifact,
} from '../../state/workflow-v2/workflow-v2-types'
import type { WorkflowState } from '../../state/workflow-types'
import type { DetailPageExport } from '../../types/detail-editor'

const PNG_MIME = 'image/png'
const POSTER_DIMENSIONS = { width: 1024, height: 1536 } as const
const DETAIL_DIMENSIONS = { width: 750, height: 1334 } as const

export interface ProgressiveImageAsset {
  readonly kind: 'poster' | 'detail'
  readonly title: string
  readonly fileName: string
  readonly ordinal: number
  readonly blob: Blob
  readonly sha256: string
  readonly sourceSignatureSha256: string
  readonly width: number
  readonly height: number
}

export interface CurrentProgressiveResultsView {
  readonly selection: ProgressiveResultsSelection
  readonly artifactCount: number
  readonly poster: ProgressiveImageAsset | null
  readonly details: readonly ProgressiveImageAsset[]
}

function isPngBlob(value: unknown): value is Blob {
  return value instanceof Blob && value.type === PNG_MIME && value.size > 0
}

function legacyPosterMatchesV2(state: WorkflowState) {
  const v2Poster = state.workflowV2.confirmedPoster
  const legacy = state.posterEditor.confirmedPoster
  const active = state.posterEditor.active
  if (!v2Poster || !legacy || !active || !state.posterEditor.currentLayoutSha256) {
    return null
  }
  const ref = posterRefFromConfirmedPoster(v2Poster)
  if (
    legacy.generationId !== ref.generationId ||
    legacy.posterId !== ref.posterId ||
    legacy.slot !== ref.slot ||
    legacy.baseBlobSha256 !== ref.baseBlobSha256 ||
    legacy.layoutSha256 !== ref.layoutSha256 ||
    legacy.upstreamSha256 !== ref.upstreamSha256 ||
    legacy.inputSignatureSha256 !== ref.compositionInputSignatureSha256 ||
    legacy.pngBlobSha256 !== ref.pngBlobSha256 ||
    legacy.confirmedRevision !== ref.confirmedRevision ||
    legacy.layoutSha256 !== state.posterEditor.currentLayoutSha256 ||
    active.generationId !== legacy.generationId ||
    active.posterId !== legacy.posterId ||
    active.slot !== legacy.slot ||
    active.baseBlobSha256 !== legacy.baseBlobSha256 ||
    active.upstreamSha256 !== legacy.upstreamSha256 ||
    state.posterEditor.compositionRevision !== legacy.confirmedRevision ||
    !isPngBlob(legacy.pngBlob)
  ) return null
  return { legacy, ref }
}

function currentDetailExports(
  state: WorkflowState,
  poster: ReturnType<typeof legacyPosterMatchesV2>,
): readonly DetailPageExport[] | null {
  const authority = state.workflowV2.confirmedDetail
  const project = state.workflowV2.detailProject
  const detail = state.detailEditor
  const confirmed = detail.confirmedDetails
  const posterResource = detail.resources['poster-final']
  if (!authority || !project || !poster || !confirmed || !detail.owner) {
    return null
  }
  if (
    !isConfirmedDetailInternallyConsistent(authority) ||
    authority.outputSignatureSha256 !== state.workflowV2.currentDetailOutputSignatureSha256 ||
    authority.detailId !== project.detailId ||
    !samePosterRef(project.owner.posterRef, poster.ref) ||
    !samePosterRef(authority.owner.posterRef, poster.ref) ||
    authority.owner.ownerSignatureSha256 !== project.owner.ownerSignatureSha256 ||
    !sameDetailOwner(detail.owner, confirmed.owner) ||
    detail.resourceRevision !== authority.resourceRevision ||
    confirmed.confirmedResourceRevision !== authority.resourceRevision ||
    confirmed.groupSignatureSha256 !== authority.groupSignatureSha256 ||
    !posterResource ||
    posterResource.id !== 'poster-final' ||
    posterResource.kind !== 'poster-final' ||
    posterResource.blob !== poster.legacy.pngBlob ||
    posterResource.sha256 !== poster.ref.pngBlobSha256 ||
    posterResource.mimeType !== PNG_MIME ||
    posterResource.width !== POSTER_DIMENSIONS.width ||
    posterResource.height !== POSTER_DIMENSIONS.height ||
    confirmed.pageExports.length === 0 ||
    confirmed.pageExports.length !== detail.pages.length ||
    confirmed.pageExports.length !== confirmed.pngBlobs.length ||
    confirmed.pageExports.length !== authority.pageSignatureSha256.length ||
    confirmed.pageExports.length !== authority.pngBlobSha256.length
  ) return null

  const pageIds = new Set<string>()
  for (let index = 0; index < confirmed.pageExports.length; index += 1) {
    const pageExport = confirmed.pageExports[index]
    const page = detail.pages[index]
    if (
      !page ||
      !pageExport ||
      pageIds.has(pageExport.pageId) ||
      page.id !== pageExport.pageId ||
      page.currentExport !== pageExport ||
      page.compositionRevision !== pageExport.revision ||
      confirmed.pngBlobs[index] !== pageExport.pngBlob ||
      authority.pageSignatureSha256[index] !== pageExport.signatureSha256 ||
      authority.pngBlobSha256[index] !== pageExport.pngBlobSha256 ||
      pageExport.width !== DETAIL_DIMENSIONS.width ||
      pageExport.height !== DETAIL_DIMENSIONS.height ||
      !isPngBlob(pageExport.pngBlob)
    ) return null
    pageIds.add(pageExport.pageId)
  }
  return confirmed.pageExports
}

function selectedArtifacts(
  state: WorkflowState,
  hasPosterPayload: boolean,
  hasDetailPayload: boolean,
): ProgressiveResultsSelection {
  const session = state.workflowV2
  const poster = hasPosterPayload ? session.confirmedPoster : null
  const detail = hasDetailPayload ? session.confirmedDetail : null
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
  })
}

/**
 * This is a render-time adapter, not a second Results authority. It passes
 * only exact current V2 authorities to the canonical selector after proving
 * that the legacy renderer still holds their matching local payloads.
 */
export function selectCurrentProgressiveResultsView(
  state: WorkflowState,
): CurrentProgressiveResultsView {
  const posterBinding = legacyPosterMatchesV2(state)
  const detailExports = currentDetailExports(state, posterBinding)
  const selection = selectedArtifacts(state, Boolean(posterBinding), Boolean(detailExports))
  const posterArtifact = selection.posters[0]
  const poster = posterBinding && posterArtifact
    ? {
        kind: 'poster' as const,
        title: '海报设计',
        fileName: 'confirmed-poster.png',
        ordinal: 1,
        blob: posterBinding.legacy.pngBlob,
        sha256: posterBinding.ref.pngBlobSha256,
        sourceSignatureSha256: posterBinding.ref.outputSignatureSha256,
        ...POSTER_DIMENSIONS,
      }
    : null
  const details = detailExports && selection.details.length > 0
    ? detailExports.map((pageExport, index) => ({
        kind: 'detail' as const,
        title: `详情页 ${index + 1}`,
        fileName: `confirmed-detail-${index + 1}.png`,
        ordinal: index + 1,
        blob: pageExport.pngBlob,
        sha256: pageExport.pngBlobSha256,
        sourceSignatureSha256: pageExport.signatureSha256,
        ...DETAIL_DIMENSIONS,
      }))
    : []
  return {
    selection,
    artifactCount: Number(selection.promotionalCopy !== null) + Number(poster !== null) + Number(details.length > 0),
    poster,
    details,
  }
}

export function progressiveResultsEntryIsEligible(state: WorkflowState): boolean {
  return selectCurrentProgressiveResultsView(state).selection.mode !== 'none'
}

export function hasExactProgressiveArtifact(
  selection: ProgressiveResultsSelection,
  artifact: ProgressiveResultArtifact,
): boolean {
  return selection.artifacts.some(
    (candidate) => candidate.kind === artifact.kind &&
      candidate.artifactIdentitySha256 === artifact.artifactIdentitySha256,
  )
}

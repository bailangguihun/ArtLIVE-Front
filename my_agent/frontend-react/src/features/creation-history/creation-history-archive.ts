import {
  isConfirmedDetailInternallyConsistent,
  isConfirmedPosterInternallyConsistent,
  isConfirmedCopyInternallyConsistent,
  isAdviceCurrentForBasic,
  isConfirmedPosterCurrent,
  posterRefFromConfirmedPoster,
  samePosterRef,
} from '../../state/workflow-v2/workflow-v2-authorities'
import { sameDetailOwner } from '../detail-editor/detail-defaults'
import type { WorkflowState } from '../../state/workflow-types'
import type { DetailPageExport } from '../../types/detail-editor'
import {
  batchIdForEpoch,
  getCreationHistoryBatch,
  upsertCreationHistoryBatch,
} from './creation-history-store'
import type {
  CreationHistoryBatch,
  CreationHistoryCopy,
  CreationHistoryImage,
} from './creation-history-types'

const PNG_MIME = 'image/png'
const POSTER_DIMENSIONS = { width: 1024, height: 1536 } as const
const DETAIL_DIMENSIONS = { width: 750, height: 1334 } as const

function isPngBlob(value: unknown): value is Blob {
  return value instanceof Blob && value.type === PNG_MIME && value.size > 0
}

function confirmedCopyMatchesCurrentOwners(state: WorkflowState): boolean {
  const session = state.workflowV2
  const basic = session.basicAuthority
  const advice = session.adviceAuthority
  const copy = session.confirmedCopy
  if (!basic || !advice || !copy || !isAdviceCurrentForBasic(advice, basic)) return false
  if (!isConfirmedCopyInternallyConsistent(copy)) return false
  return (
    copy.input.basicOwner.textSignatureSha256 === basic.text.signatureSha256 &&
    copy.input.basicOwner.settingsSignatureSha256 === basic.settings.signatureSha256 &&
    copy.platform === basic.settings.platform &&
    copy.style === basic.settings.style
  )
}

function currentPosterBinding(state: WorkflowState) {
  const session = state.workflowV2
  const basic = session.basicAuthority
  const advice = session.adviceAuthority
  const v2Poster = session.confirmedPoster
  const legacy = state.posterEditor.confirmedPoster
  const active = state.posterEditor.active
  if (
    !basic ||
    !advice ||
    !v2Poster ||
    !legacy ||
    !active ||
    !state.posterEditor.currentLayoutSha256 ||
    !isConfirmedPosterInternallyConsistent(v2Poster) ||
    !isConfirmedPosterCurrent(
      v2Poster,
      basic,
      advice,
      v2Poster.project.copyRef ? session.confirmedCopy : null,
    )
  ) {
    return null
  }
  const ref = posterRefFromConfirmedPoster(v2Poster)
  if (
    legacy.generationId !== ref.generationId ||
    legacy.posterId !== ref.posterId ||
    legacy.slot !== ref.slot ||
    legacy.pngBlobSha256 !== ref.pngBlobSha256 ||
    legacy.layoutSha256 !== state.posterEditor.currentLayoutSha256 ||
    !isPngBlob(legacy.pngBlob)
  ) {
    return null
  }
  return { legacy, ref }
}

function currentDetailExports(
  state: WorkflowState,
  poster: NonNullable<ReturnType<typeof currentPosterBinding>>,
): readonly DetailPageExport[] | null {
  const session = state.workflowV2
  const authority = session.confirmedDetail
  const project = session.detailProject
  const detail = state.detailEditor
  const confirmed = detail.confirmedDetails
  if (!authority || !project || !confirmed || !detail.owner) return null
  if (
    !isConfirmedDetailInternallyConsistent(authority) ||
    authority.outputSignatureSha256 !== session.currentDetailOutputSignatureSha256 ||
    !samePosterRef(project.owner.posterRef, poster.ref) ||
    !samePosterRef(authority.owner.posterRef, poster.ref) ||
    !sameDetailOwner(detail.owner, confirmed.owner) ||
    confirmed.pageExports.length === 0
  ) {
    return null
  }
  for (let index = 0; index < confirmed.pageExports.length; index += 1) {
    const pageExport = confirmed.pageExports[index]
    if (!pageExport || !isPngBlob(pageExport.pngBlob)) return null
    if (authority.pngBlobSha256[index] !== pageExport.pngBlobSha256) return null
  }
  return confirmed.pageExports
}

function buildCopy(state: WorkflowState): CreationHistoryCopy | null {
  if (!confirmedCopyMatchesCurrentOwners(state)) return null
  const copy = state.workflowV2.confirmedCopy!
  return {
    body: copy.body,
    title: copy.title,
    headline: copy.headline,
    subline: copy.subline,
    platform: copy.platform,
    style: copy.style,
    outputSignatureSha256: copy.outputSignatureSha256,
  }
}

function buildPoster(state: WorkflowState): CreationHistoryImage | null {
  const binding = currentPosterBinding(state)
  if (!binding) return null
  return {
    kind: 'poster',
    title: '海报设计',
    fileName: 'confirmed-poster.png',
    ordinal: 1,
    blob: binding.legacy.pngBlob,
    sha256: binding.ref.pngBlobSha256,
    ...POSTER_DIMENSIONS,
  }
}

function buildDetails(state: WorkflowState): CreationHistoryImage[] {
  const poster = currentPosterBinding(state)
  if (!poster) return []
  const exports = currentDetailExports(state, poster)
  if (!exports) return []
  return exports.map((pageExport, index) => ({
    kind: 'detail' as const,
    title: `详情页 ${index + 1}`,
    fileName: `confirmed-detail-${index + 1}.png`,
    ordinal: index + 1,
    blob: pageExport.pngBlob,
    sha256: pageExport.pngBlobSha256,
    ...DETAIL_DIMENSIONS,
  }))
}

function batchMetadata(state: WorkflowState) {
  const basic = state.workflowV2.basicAuthority
  const advice = state.workflowV2.adviceAuthority
  const values = state.productInfo.values
  return {
    productShortName: values.productShortName.trim() || values.productInfo.trim() || '未命名商品',
    productInfo: values.productInfo.trim(),
    platform: basic?.settings.platform ?? state.platformCopy.platform,
    style: basic?.settings.style ?? state.platformCopy.style,
    strategyName: advice?.advice.strategy.name ?? null,
  }
}

function hasArchivableArtifacts(
  copy: CreationHistoryCopy | null,
  poster: CreationHistoryImage | null,
  details: readonly CreationHistoryImage[],
): boolean {
  return Boolean(copy || poster || details.length > 0)
}

export async function syncCreationHistoryFromWorkflow(
  state: WorkflowState,
): Promise<void> {
  const session = state.workflowV2
  if (session.phase !== 'active' || session.epoch <= 0) return

  const copy = buildCopy(state)
  const poster = buildPoster(state)
  const details = buildDetails(state)
  if (!hasArchivableArtifacts(copy, poster, details)) return

  const id = batchIdForEpoch(session.epoch)
  const existing = await getCreationHistoryBatch(id)
  const metadata = batchMetadata(state)
  const batch: CreationHistoryBatch = {
    id,
    epoch: session.epoch,
    updatedAt: Date.now(),
    ...metadata,
    copy: copy ?? existing?.copy ?? null,
    poster: poster ?? existing?.poster ?? null,
    details: details.length > 0 ? details : (existing?.details ?? []),
  }
  if (!hasArchivableArtifacts(batch.copy, batch.poster, batch.details)) return
  await upsertCreationHistoryBatch(batch)
}

import {
  isDetailProjectInternallyConsistent,
  samePosterRef,
} from '../../state/workflow-v2/workflow-v2-authorities'
import type {
  DetailOwner,
  DetailProject,
  PosterRef,
} from '../../state/workflow-v2/workflow-v2-types'

/**
 * Serialisable boundary between Workflow V2 authority and the legacy Detail
 * rendering engine. Blob and object-URL ownership intentionally stay in the
 * existing editor/resource layer.
 */
export function createV2DetailProject(
  owner: DetailOwner,
): DetailProject {
  return {
    version: 'workflow-v2-detail-project-v1',
    detailId: `detail-${owner.posterRef.projectIdentitySha256}-${owner.posterRef.confirmedRevision}`,
    owner,
    projectSignatureSha256: owner.ownerSignatureSha256,
  }
}

export function detailProjectMatchesPosterRef(
  project: DetailProject | null,
  posterRef: PosterRef | null,
): boolean {
  return Boolean(
    project &&
      posterRef &&
      isDetailProjectInternallyConsistent(project) &&
      samePosterRef(project.owner.posterRef, posterRef),
  )
}

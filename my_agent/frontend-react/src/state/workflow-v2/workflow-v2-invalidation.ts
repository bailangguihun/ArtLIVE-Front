import { sameCopyRef, samePosterRef } from './workflow-v2-authorities'
import type { CopyRef, PosterRef } from './workflow-v2-types'

export interface InvalidationPosterNode {
  readonly projectId: string
  readonly copyRef: CopyRef | null
  readonly confirmedPosterRef: PosterRef | null
}

export interface InvalidationDetailNode {
  readonly detailId: string
  readonly posterRef: PosterRef
}

export interface WorkflowV2AuthorityGraph {
  readonly posters: readonly InvalidationPosterNode[]
  readonly details: readonly InvalidationDetailNode[]
}

export type WorkflowV2InvalidationEvent =
  | Readonly<{
      kind: 'basic_text_changed'
      field: 'productInfo' | 'productShortName' | 'creativeNote'
    }>
  | Readonly<{ kind: 'product_image_changed' }>
  | Readonly<{ kind: 'creation_settings_changed'; field: 'platform' | 'style' }>
  | Readonly<{ kind: 'advice_replaced' }>
  | Readonly<{ kind: 'copy_draft_changed' }>
  | Readonly<{ kind: 'confirmed_copy_replaced'; replacedCopyRef: CopyRef }>
  | Readonly<{
      kind: 'poster_changed'
      projectId: string
      cause:
        | 'generation'
        | 'base_selection'
        | 'editing'
        | 'confirmation_replaced'
    }>
  | Readonly<{ kind: 'detail_changed'; detailId: string }>
  | Readonly<{ kind: 'navigation'; direction: 'back' | 'reentry' | 'module_switch' }>
  | Readonly<{ kind: 'reset' }>

export interface WorkflowV2InvalidationResult {
  readonly adviceStale: boolean
  readonly copyStale: boolean
  readonly posterProjectIds: readonly string[]
  readonly detailIds: readonly string[]
  readonly clearAuthorities: boolean
  readonly abortOperations: boolean
  readonly releaseResources: boolean
  readonly preserveRecoverableDrafts: boolean
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)]
}

function detailsReferencingPosters(
  graph: WorkflowV2AuthorityGraph,
  posters: readonly InvalidationPosterNode[],
): readonly string[] {
  return unique(
    graph.details
      .filter((detail) =>
        posters.some(
          (poster) =>
            poster.confirmedPosterRef !== null &&
            samePosterRef(poster.confirmedPosterRef, detail.posterRef),
        ),
      )
      .map((detail) => detail.detailId),
  )
}

function result(input: Partial<WorkflowV2InvalidationResult>): WorkflowV2InvalidationResult {
  return {
    adviceStale: false,
    copyStale: false,
    posterProjectIds: [],
    detailIds: [],
    clearAuthorities: false,
    abortOperations: false,
    releaseResources: false,
    preserveRecoverableDrafts: true,
    ...input,
  }
}

/**
 * Returns invalidation targets only. Existing drafts remain recoverable unless
 * the event is an atomic reset; callers do not delete stale work implicitly.
 */
export function deriveWorkflowV2Invalidation(
  event: WorkflowV2InvalidationEvent,
  graph: WorkflowV2AuthorityGraph,
): WorkflowV2InvalidationResult {
  if (event.kind === 'reset') {
    return result({
      adviceStale: true,
      copyStale: true,
      posterProjectIds: unique(graph.posters.map((poster) => poster.projectId)),
      detailIds: unique(graph.details.map((detail) => detail.detailId)),
      clearAuthorities: true,
      abortOperations: true,
      releaseResources: true,
      preserveRecoverableDrafts: false,
    })
  }

  if (event.kind === 'navigation' || event.kind === 'copy_draft_changed') {
    return result({})
  }

  if (event.kind === 'detail_changed') {
    return result({ detailIds: [event.detailId] })
  }

  if (event.kind === 'poster_changed') {
    const affected = graph.posters.filter(
      (poster) => poster.projectId === event.projectId,
    )
    return result({
      posterProjectIds: unique(affected.map((poster) => poster.projectId)),
      detailIds: detailsReferencingPosters(graph, affected),
      abortOperations: true,
    })
  }

  if (event.kind === 'confirmed_copy_replaced') {
    const affected = graph.posters.filter((poster) =>
      sameCopyRef(poster.copyRef, event.replacedCopyRef),
    )
    return result({
      posterProjectIds: unique(affected.map((poster) => poster.projectId)),
      detailIds: detailsReferencingPosters(graph, affected),
      abortOperations: affected.length > 0,
    })
  }

  if (event.kind === 'product_image_changed') {
    return result({
      posterProjectIds: unique(graph.posters.map((poster) => poster.projectId)),
      detailIds: detailsReferencingPosters(graph, graph.posters),
      abortOperations: true,
    })
  }

  const affectsAdvice = event.kind === 'basic_text_changed'
  const affectsCopy =
    affectsAdvice ||
    event.kind === 'creation_settings_changed' ||
    event.kind === 'advice_replaced'
  return result({
    adviceStale: affectsAdvice,
    copyStale: affectsCopy,
    posterProjectIds: unique(graph.posters.map((poster) => poster.projectId)),
    detailIds: detailsReferencingPosters(graph, graph.posters),
    abortOperations: true,
  })
}

import { describe, expect, it } from 'vitest'
import { deriveWorkflowV2Invalidation } from './workflow-v2-invalidation'
import {
  ADVICE_AUTHORITY_VERSION,
  CONFIRMED_COPY_VERSION,
  CONFIRMED_POSTER_VERSION,
  COPY_REF_VERSION,
  POSTER_REF_VERSION,
} from './workflow-v2-types'
import type {
  AdviceOwner,
  CopyRef,
  PosterRef,
} from './workflow-v2-types'

const hash = (character: string) => character.repeat(64)

const adviceOwner: AdviceOwner = {
  kind: 'present',
  authorityVersion: ADVICE_AUTHORITY_VERSION,
  adviceVersion: 'catalog-v1',
  inputSignatureSha256: hash('1'),
  adviceSignatureSha256: hash('2'),
  ownerSignatureSha256: hash('3'),
}

function copyRef(revision: number, outputCharacter: string): CopyRef {
  return {
    version: COPY_REF_VERSION,
    copyAuthorityVersion: CONFIRMED_COPY_VERSION,
    revision,
    basicOwner: {
      textSignatureSha256: hash('4'),
      settingsSignatureSha256: hash('5'),
    },
    adviceOwner,
    inputSignatureSha256: hash('6'),
    outputSignatureSha256: hash(outputCharacter),
  }
}

function posterRef(projectId: string, character: string): PosterRef {
  return {
    version: POSTER_REF_VERSION,
    posterAuthorityVersion: CONFIRMED_POSTER_VERSION,
    projectId,
    projectIdentitySha256: hash(character),
    posterInputSignatureSha256: hash('7'),
    generationId: `generation-${projectId}`,
    posterId: `poster-${projectId}`,
    slot: 1,
    baseBlobSha256: hash('8'),
    layoutSha256: hash('9'),
    upstreamSha256: hash('a'),
    compositionInputSignatureSha256: hash('b'),
    pngBlobSha256: hash('c'),
    confirmedRevision: 2,
    resourceRevision: 3,
    outputSignatureSha256: hash(character),
  }
}

const replacedCopyRef = copyRef(1, 'd')
const posterARef = posterRef('project-a', 'e')
const posterBRef = posterRef('project-b', 'f')
const graph = {
  posters: [
    { projectId: 'project-a', copyRef: replacedCopyRef, confirmedPosterRef: posterARef },
    { projectId: 'project-b', copyRef: null, confirmedPosterRef: posterBRef },
  ],
  details: [
    { detailId: 'detail-a', posterRef: posterARef },
    { detailId: 'detail-b', posterRef: posterBRef },
    {
      detailId: 'detail-mixed',
      posterRef: { ...posterARef, outputSignatureSha256: hash('0') },
    },
  ],
} as const

describe('Workflow V2 invalidation matrix', () => {
  it.each(['productInfo', 'productShortName', 'creativeNote'] as const)(
    'stales Advice, Copy, all Posters, and referencing Details when %s changes',
    (field) => {
      expect(deriveWorkflowV2Invalidation(
        { kind: 'basic_text_changed', field }, graph,
      )).toEqual({
        adviceStale: true,
        copyStale: true,
        posterProjectIds: ['project-a', 'project-b'],
        detailIds: ['detail-a', 'detail-b'],
        clearAuthorities: false,
        abortOperations: true,
        releaseResources: false,
        preserveRecoverableDrafts: true,
      })
    },
  )

  it('stales only Posters and their exact Details for a product-image change', () => {
    const result = deriveWorkflowV2Invalidation({ kind: 'product_image_changed' }, graph)
    expect(result).toMatchObject({
      adviceStale: false,
      copyStale: false,
      posterProjectIds: ['project-a', 'project-b'],
      detailIds: ['detail-a', 'detail-b'],
      abortOperations: true,
    })
    expect(result.detailIds).not.toContain('detail-mixed')
  })

  it.each(['platform', 'style'] as const)(
    'keeps Advice current but stales Copy, Posters, and Details when %s changes',
    (field) => {
      expect(deriveWorkflowV2Invalidation(
        { kind: 'creation_settings_changed', field }, graph,
      )).toMatchObject({
        adviceStale: false,
        copyStale: true,
        posterProjectIds: ['project-a', 'project-b'],
        detailIds: ['detail-a', 'detail-b'],
      })
    },
  )

  it('stales Copy, Posters, and Details after Advice replacement', () => {
    expect(deriveWorkflowV2Invalidation({ kind: 'advice_replaced' }, graph)).toMatchObject({
      adviceStale: false,
      copyStale: true,
      posterProjectIds: ['project-a', 'project-b'],
      detailIds: ['detail-a', 'detail-b'],
    })
  })

  it('does not stale any Poster while Copy is generated or edited before confirmation', () => {
    expect(deriveWorkflowV2Invalidation({ kind: 'copy_draft_changed' }, graph)).toEqual({
      adviceStale: false,
      copyStale: false,
      posterProjectIds: [],
      detailIds: [],
      clearAuthorities: false,
      abortOperations: false,
      releaseResources: false,
      preserveRecoverableDrafts: true,
    })
  })

  it('stales only Posters with the replaced exact CopyRef and their Details', () => {
    expect(deriveWorkflowV2Invalidation({
      kind: 'confirmed_copy_replaced', replacedCopyRef,
    }, graph)).toMatchObject({
      adviceStale: false,
      copyStale: false,
      posterProjectIds: ['project-a'],
      detailIds: ['detail-a'],
    })
  })

  it.each([
    'generation', 'base_selection', 'editing', 'confirmation_replaced',
  ] as const)(
    'stales only one Poster project and its exact Details for Poster %s',
    (cause) => {
      expect(deriveWorkflowV2Invalidation({
        kind: 'poster_changed', projectId: 'project-b', cause,
      }, graph)).toMatchObject({
        adviceStale: false,
        copyStale: false,
        posterProjectIds: ['project-b'],
        detailIds: ['detail-b'],
      })
    },
  )

  it('stales only the edited Detail result', () => {
    expect(deriveWorkflowV2Invalidation({
      kind: 'detail_changed', detailId: 'detail-a',
    }, graph)).toMatchObject({
      adviceStale: false,
      copyStale: false,
      posterProjectIds: [],
      detailIds: ['detail-a'],
    })
  })

  it.each(['back', 'reentry', 'module_switch'] as const)(
    'preserves compatible authorities and drafts on %s',
    (direction) => {
      expect(deriveWorkflowV2Invalidation({ kind: 'navigation', direction }, graph)).toMatchObject({
        adviceStale: false,
        copyStale: false,
        posterProjectIds: [],
        detailIds: [],
        abortOperations: false,
        preserveRecoverableDrafts: true,
      })
    },
  )

  it('describes atomic reset clearing, abort, and resource release without mutating current state', () => {
    expect(deriveWorkflowV2Invalidation({ kind: 'reset' }, graph)).toEqual({
      adviceStale: true,
      copyStale: true,
      posterProjectIds: ['project-a', 'project-b'],
      detailIds: ['detail-a', 'detail-b', 'detail-mixed'],
      clearAuthorities: true,
      abortOperations: true,
      releaseResources: true,
      preserveRecoverableDrafts: false,
    })
  })
})

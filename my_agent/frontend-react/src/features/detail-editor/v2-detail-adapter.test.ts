import { describe, expect, it } from 'vitest'
import { createDetailOwner } from '../../state/workflow-v2/workflow-v2-authorities'
import type { PosterRef } from '../../state/workflow-v2/workflow-v2-types'
import {
  createV2DetailProject,
  detailProjectMatchesPosterRef,
} from './v2-detail-adapter'

const hash = (character: string) => character.repeat(64)

function posterRef(): PosterRef {
  return {
    version: 'workflow-v2-poster-ref-v1',
    posterAuthorityVersion: 'workflow-v2-confirmed-poster-v1',
    projectId: 'poster-project',
    projectIdentitySha256: hash('1'),
    posterInputSignatureSha256: hash('2'),
    generationId: 'generation-1',
    posterId: 'poster-1',
    slot: 1,
    baseBlobSha256: hash('3'),
    layoutSha256: hash('4'),
    upstreamSha256: hash('5'),
    compositionInputSignatureSha256: hash('6'),
    pngBlobSha256: hash('7'),
    confirmedRevision: 1,
    resourceRevision: 1,
    outputSignatureSha256: hash('8'),
  }
}

describe('V2 Detail adapter', () => {
  it('binds a project to every field of one exact PosterRef', async () => {
    const ref = posterRef()
    const project = createV2DetailProject(await createDetailOwner(ref))

    expect(detailProjectMatchesPosterRef(project, ref)).toBe(true)
    expect(detailProjectMatchesPosterRef(project, {
      ...ref,
      confirmedRevision: 2,
    })).toBe(false)
  })

  it('fails closed for a partial or malformed owner', async () => {
    const project = createV2DetailProject(await createDetailOwner(posterRef()))
    expect(detailProjectMatchesPosterRef({
      ...project,
      owner: { ...project.owner, ownerSignatureSha256: 'invalid' },
    }, posterRef())).toBe(false)
  })
})

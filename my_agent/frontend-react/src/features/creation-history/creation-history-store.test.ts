import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import type { CreationHistoryBatch } from './creation-history-types'
import {
  batchIdForEpoch,
  deleteCreationHistoryBatch,
  getCreationHistoryBatch,
  listCreationHistoryBatches,
  toHistoryListItem,
  upsertCreationHistoryBatch,
} from './creation-history-store'

function sampleBatch(epoch: number, updatedAt: number): CreationHistoryBatch {
  return {
    id: batchIdForEpoch(epoch),
    epoch,
    updatedAt,
    productShortName: `商品 ${epoch}`,
    productInfo: '测试商品说明',
    platform: 'xiaohongshu',
    style: 'premium',
    strategyName: '策略',
    copy: {
      body: '推广文案正文',
      title: '标题',
      headline: '主标题',
      subline: '副标题',
      platform: 'xiaohongshu',
      style: 'premium',
      outputSignatureSha256: 'a'.repeat(64),
    },
    poster: null,
    details: [],
  }
}

describe('creation history store helpers', () => {
  it('maps epoch to a stable batch id and list item shape', () => {
    const batch = sampleBatch(3, 1_700_000_000_000)
    expect(batchIdForEpoch(3)).toBe('session-3')
    expect(toHistoryListItem(batch)).toMatchObject({
      id: 'session-3',
      epoch: 3,
      hasCopy: true,
      hasPoster: false,
      detailCount: 0,
      thumbnail: null,
    })
  })

  it('uses poster thumbnail before detail pages in list items', () => {
    const posterBlob = new Blob(['poster'], { type: 'image/png' })
    const detailBlob = new Blob(['detail'], { type: 'image/png' })
    const batch: CreationHistoryBatch = {
      ...sampleBatch(4, 1_700_000_000_100),
      poster: {
        kind: 'poster',
        title: '海报设计',
        fileName: 'poster.png',
        ordinal: 1,
        width: 1024,
        height: 1536,
        sha256: 'b'.repeat(64),
        blob: posterBlob,
      },
      details: [{
        kind: 'detail',
        title: '详情页 1',
        fileName: 'detail-1.png',
        ordinal: 1,
        width: 750,
        height: 1334,
        sha256: 'c'.repeat(64),
        blob: detailBlob,
      }],
    }
    expect(toHistoryListItem(batch).thumbnail?.kind).toBe('poster')
  })

  it('persists CRUD updates with stable ordering and exact Blob bytes', async () => {
    const posterBytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])
    const older: CreationHistoryBatch = {
      ...sampleBatch(1, 100),
      poster: {
        kind: 'poster',
        title: 'Poster',
        fileName: 'poster.png',
        ordinal: 1,
        width: 8,
        height: 8,
        sha256: 'd'.repeat(64),
        blob: new Blob([posterBytes], { type: 'image/png' }),
      },
    }
    const newer = sampleBatch(2, 200)

    await upsertCreationHistoryBatch(older)
    await upsertCreationHistoryBatch(newer)

    expect((await listCreationHistoryBatches()).map((item) => item.id)).toEqual([
      'session-2',
      'session-1',
    ])
    const stored = await getCreationHistoryBatch('session-1')
    if (!stored?.poster) throw new Error('stored poster fixture is missing')
    expect(stored.poster.blob.type).toBe('image/png')
    expect(stored.poster.blob.size).toBe(posterBytes.byteLength)
    expect(new Uint8Array(await stored.poster.blob.arrayBuffer())).toEqual(posterBytes)

    await upsertCreationHistoryBatch({ ...older, updatedAt: 300 })
    expect((await listCreationHistoryBatches()).map((item) => item.id)).toEqual([
      'session-1',
      'session-2',
    ])

    await deleteCreationHistoryBatch('session-1')
    expect(await getCreationHistoryBatch('session-1')).toBeNull()
    expect((await listCreationHistoryBatches()).map((item) => item.id)).toEqual([
      'session-2',
    ])
  })

  it('retains the newest 30 batches and isolates a fresh factory', async () => {
    for (let epoch = 1; epoch <= 31; epoch += 1) {
      await upsertCreationHistoryBatch(sampleBatch(epoch, epoch))
    }

    const retained = await listCreationHistoryBatches()
    expect(retained).toHaveLength(30)
    expect(retained.map((item) => item.id)).toEqual(
      Array.from({ length: 30 }, (_, index) => `session-${31 - index}`),
    )
    expect(await getCreationHistoryBatch('session-1')).toBeNull()

    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      value: new IDBFactory(),
      writable: true,
    })
    expect(await listCreationHistoryBatches()).toEqual([])
  })
})

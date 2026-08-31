import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createBasicAuthority,
  createConfirmedCopy,
  createCopyInputAuthority,
  createPresentAdviceAuthority,
} from '../../state/workflow-v2/workflow-v2-authorities'
import { createInitialWorkflowState } from '../../state/workflow-reducer'
import type { AdviceResult } from '../../state/workflow-v2/workflow-v2-types'
import { syncCreationHistoryFromWorkflow } from './creation-history-archive'

const hash = (character: string) => character.repeat(64)

const ADVICE: AdviceResult = {
  category_id: 'fmcg',
  category_name: '快消品',
  confidence: 'low',
  matched_keywords: [],
  reason: 'fixture',
  score: 0,
  strategy: {
    id: 'fmcg',
    name: '策略',
    examples: '示例',
    traits: ['清晰'],
    tactics: ['说明'],
    one_liner: '方向',
  },
  source: 'desktop_ai_different_product_marketing_strategies',
}

const { upsertCreationHistoryBatch, getCreationHistoryBatch } = vi.hoisted(() => ({
  upsertCreationHistoryBatch: vi.fn(async () => {}),
  getCreationHistoryBatch: vi.fn(async () => null),
}))

vi.mock('./creation-history-store', () => ({
  batchIdForEpoch: (epoch: number) => `session-${epoch}`,
  getCreationHistoryBatch,
  upsertCreationHistoryBatch,
}))

beforeEach(() => {
  upsertCreationHistoryBatch.mockClear()
  getCreationHistoryBatch.mockClear()
  getCreationHistoryBatch.mockResolvedValue(null)
})

describe('syncCreationHistoryFromWorkflow', () => {
  it('archives confirmed copy for the active session epoch', async () => {
    const initial = createInitialWorkflowState()
    const basic = await createBasicAuthority({
      productInfo: '测试商品',
      productShortName: '商品',
      creativeNote: '说明',
      platform: 'xiaohongshu',
      style: 'premium',
      productImage: { byteSha256: hash('1'), mimeType: 'image/png', byteSize: 64 },
    })
    const advice = await createPresentAdviceAuthority({
      api_version: 'v1',
      advice_version: 'catalog-v1',
      status: 'present',
      input_signature_sha256: basic.text.adviceInputSignatureSha256,
      advice_signature_sha256: hash('2'),
      advice: ADVICE,
    }, basic)
    const copy = await createConfirmedCopy({
      copyInput: await createCopyInputAuthority(basic, advice),
      revision: 1,
      source: { kind: 'selected', selectedIndex: 0, candidateSignatureSha256: hash('3') },
      fields: { body: '当前推广文案', title: '标题', headline: '主标题', subline: '副标题' },
    })

    await syncCreationHistoryFromWorkflow({
      ...initial,
      productInfo: {
        ...initial.productInfo,
        values: {
          ...initial.productInfo.values,
          productShortName: '商品',
          productInfo: '测试商品',
        },
      },
      platformCopy: {
        ...initial.platformCopy,
        platform: 'xiaohongshu',
        style: 'premium',
      },
      workflowV2: {
        ...initial.workflowV2,
        phase: 'active',
        epoch: 9,
        basicAuthority: basic,
        adviceAuthority: advice,
        confirmedCopy: copy,
      },
    })

    expect(upsertCreationHistoryBatch).toHaveBeenCalledTimes(1)
    expect(upsertCreationHistoryBatch).toHaveBeenCalledWith(expect.objectContaining({
      id: 'session-9',
      epoch: 9,
      productShortName: '商品',
      copy: expect.objectContaining({ body: '当前推广文案' }),
      poster: null,
      details: [],
    }))
  })

  it('skips archiving when there is no active session or confirmed artifact', async () => {
    const initial = createInitialWorkflowState()
    await syncCreationHistoryFromWorkflow(initial)
    expect(upsertCreationHistoryBatch).not.toHaveBeenCalled()

    await syncCreationHistoryFromWorkflow({
      ...initial,
      workflowV2: { ...initial.workflowV2, phase: 'active', epoch: 4 },
    })
    expect(upsertCreationHistoryBatch).not.toHaveBeenCalled()
  })
})

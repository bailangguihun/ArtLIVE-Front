import { describe, expect, it } from 'vitest'
import type { WorkflowState } from '../../state/workflow-types'
import type { MarketingStrategy } from '../../types/platform-copy'
import {
  completionFromStep6View,
  normalizeMarketingStrategy,
  selectCurrentStep5Authority,
  selectStep6ViewModel,
  sha256TextSync,
} from './marketing-strategy-model'
import { createStepSixState, TEST_STEP5_GROUP_SIGNATURE } from './marketing-strategy-test-utils'

function withCopyStrategy(
  state: WorkflowState,
  strategy: MarketingStrategy,
): WorkflowState {
  return {
    ...state,
    platformCopy: {
      ...state.platformCopy,
      marketingStrategy: strategy,
    },
  }
}

function withoutCopyPlatform(state: WorkflowState): WorkflowState {
  return {
    ...state,
    platformCopy: {
      ...state.platformCopy,
      generationPlatform: null,
      generationStyle: null,
      strategyOwner: null,
    },
  }
}

describe('marketing strategy normalization', () => {
  it('implements deterministic UTF-8 SHA-256', () => {
    const vectors = [
      ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
      ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
      ['营销策略🙂', '5a72a5eb1f0e884cc6a1e2b5d38fd1b4059e757bfca02c38369a46bce410d51f'],
    ] as const
    for (const [value, expected] of vectors) {
      expect(sha256TextSync(value)).toBe(expected)
    }
  })

  it.each([
    null,
    undefined,
    '',
    '   ',
    [],
    {},
  ])('classifies an empty source as absent: %j', (value) => {
    expect(normalizeMarketingStrategy(value)).toMatchObject({
      status: 'absent',
      blocks: [],
      malformedFields: [],
    })
  })

  it.each([42, true, 'provider text', ['non-empty']])(
    'classifies an unsupported top-level source as malformed: %j',
    (value) => {
      expect(normalizeMarketingStrategy(value)).toMatchObject({
        status: 'malformed',
        blocks: [],
        malformedFields: ['$'],
      })
    },
  )

  it('projects the classifier envelope in fixed semantic display order', () => {
    const normalized = normalizeMarketingStrategy({
      source: 'ignored-provider-metadata',
      score: 8,
      matched_keywords: ['咖啡', '精品'],
      reason: '根据关键词命中判定。',
      confidence: 'high',
      category_name: '食品饮料',
      strategy: {
        tactics: ['强调产地', '突出香气'],
        traits: ['高频消费', '感官决策'],
        one_liner: '让香气成为购买理由。',
        examples: '咖啡、茶饮',
        name: '食品饮料',
        id: 'food',
      },
    })

    expect(normalized.status).toBe('present')
    expect(normalized.blocks).toEqual([
      { kind: 'summary', categoryName: '食品饮料', confidence: 'high', reason: '根据关键词命中判定。' },
      { kind: 'keywords', items: ['咖啡', '精品'] },
      { kind: 'paragraph', label: '覆盖范围', text: '咖啡、茶饮', emphasis: false },
      { kind: 'paragraph', label: null, text: '让香气成为购买理由。', emphasis: true },
      { kind: 'list', heading: '核心特点', ordered: false, items: ['高频消费', '感官决策'] },
      { kind: 'list', heading: '建议营销策略', ordered: true, items: ['强调产地', '突出香气'] },
    ])
  })

  it('supports a direct strategy mapping and preserves every ordered item', () => {
    const keywords = Array.from({ length: 18 }, (_, index) => `关键词 ${index + 1}`)
    const normalized = normalizeMarketingStrategy({
      name: '美妆个护',
      examples: '护肤、彩妆',
      one_liner: '以真实体验建立信任。',
      traits: ['功效驱动', '口碑驱动'],
      tactics: ['展示质地', '给出使用路径'],
      matched_keywords: keywords,
    })
    expect(normalized.status).toBe('present')
    expect(normalized.blocks.find((block) => block.kind === 'keywords')).toEqual({
      kind: 'keywords',
      items: keywords,
    })
  })

  it('keeps valid blocks while recording malformed supported fields', () => {
    const normalized = normalizeMarketingStrategy({
      category_name: '家居生活',
      matched_keywords: ['收纳', 7, '  家居  ', ''],
      strategy: { traits: 'not-a-list', tactics: ['场景化展示'] },
    })
    expect(normalized.status).toBe('present')
    expect(normalized.malformedFields).toEqual(['matched_keywords', 'strategy.traits'])
    expect(normalized.blocks).toContainEqual({ kind: 'keywords', items: ['收纳', '家居'] })
  })

  it('treats a non-empty mapping with no supported content as malformed', () => {
    expect(normalizeMarketingStrategy({ payload: { opaque: true } })).toMatchObject({
      status: 'malformed',
      blocks: [],
    })
  })

  it('canonicalizes key order and whitespace but preserves meaningful list order', () => {
    const first = normalizeMarketingStrategy({
      name: '  食品饮料  ',
      examples: ' 咖啡\r\n\r\n\r\n 茶饮 ',
      tactics: [' 强调产地 ', '突出香气'],
      ignored: 'one',
    })
    const reordered = normalizeMarketingStrategy({
      ignored: 'different ignored value',
      tactics: ['强调产地', '突出香气'],
      examples: '咖啡\n\n茶饮',
      name: '食品饮料',
    })
    const reversed = normalizeMarketingStrategy({
      name: '食品饮料',
      examples: '咖啡\n\n茶饮',
      tactics: ['突出香气', '强调产地'],
    })
    expect(reordered.signatureSha256).toBe(first.signatureSha256)
    expect(reversed.signatureSha256).not.toBe(first.signatureSha256)
  })
})

describe('Step 6 source resolution and authority', () => {
  it('uses the copy strategy and copy platform before poster values', () => {
    const base = createStepSixState()
    const result = base.posterGeneration.result!
    const state = {
      ...withCopyStrategy(base, { name: '文案策略' }),
      posterGeneration: {
        ...base.posterGeneration,
        result: {
          ...result,
          marketingStrategy: { name: '海报策略' },
          targetPlatform: 'douyin' as const,
          targetPlatformResolution: 'known' as const,
        },
      },
    }
    const view = selectStep6ViewModel(state)
    expect(view.platform).toMatchObject({ id: 'xiaohongshu', label: '小红书', sourceKind: 'copy' })
    expect(view.strategy).toMatchObject({ status: 'present', sourceKind: 'copy' })
    expect(view.strategy.blocks).toContainEqual(expect.objectContaining({ categoryName: '文案策略' }))
  })

  it('falls through an empty copy mapping to a compatible poster strategy', () => {
    const base = withCopyStrategy(createStepSixState(), {})
    const state: WorkflowState = {
      ...base,
      posterGeneration: {
        ...base.posterGeneration,
        result: {
          ...base.posterGeneration.result!,
          marketingStrategy: { name: '海报策略' },
          targetPlatform: 'xiaohongshu',
          targetPlatformResolution: 'known',
        },
      },
    }
    const view = selectStep6ViewModel(state)
    expect(view.strategy).toMatchObject({ status: 'present', sourceKind: 'poster' })
  })

  it('does not fall through a malformed non-empty copy mapping', () => {
    const base = withCopyStrategy(createStepSixState(), { opaque: true })
    const state: WorkflowState = {
      ...base,
      posterGeneration: {
        ...base.posterGeneration,
        result: {
          ...base.posterGeneration.result!,
          marketingStrategy: { name: '不应显示的海报策略' },
          targetPlatform: 'xiaohongshu',
          targetPlatformResolution: 'known',
        },
      },
    }
    expect(selectStep6ViewModel(state).strategy).toMatchObject({
      status: 'malformed',
      sourceKind: 'copy',
      blocks: [],
    })
  })

  it('resolves poster platform and then the current platform when copy ownership is absent', () => {
    const base = withoutCopyPlatform(withCopyStrategy(createStepSixState(), {}))
    const poster: WorkflowState = {
      ...base,
      posterGeneration: {
        ...base.posterGeneration,
        result: {
          ...base.posterGeneration.result!,
          targetPlatform: 'taobao',
          targetPlatformResolution: 'known',
        },
      },
    }
    expect(selectStep6ViewModel(poster).platform).toMatchObject({ id: 'taobao', sourceKind: 'poster' })
    const current: WorkflowState = {
      ...poster,
      platformCopy: { ...poster.platformCopy, platform: 'pinduoduo' },
      posterGeneration: {
        ...poster.posterGeneration,
        result: {
          ...poster.posterGeneration.result!,
          targetPlatform: null,
          targetPlatformResolution: 'missing',
        },
      },
    }
    expect(selectStep6ViewModel(current).platform).toMatchObject({ id: 'pinduoduo', sourceKind: 'current' })
  })

  it('defaults an unknown poster platform safely and fails its strategy owner closed', () => {
    const base = withoutCopyPlatform(withCopyStrategy(createStepSixState(), {}))
    const state: WorkflowState = {
      ...base,
      posterGeneration: {
        ...base.posterGeneration,
        result: {
          ...base.posterGeneration.result!,
          marketingStrategy: { name: '来源不明策略' },
          targetPlatform: 'xiaohongshu',
          targetPlatformResolution: 'legacy-defaulted-unknown',
        },
      },
    }
    const view = selectStep6ViewModel(state)
    expect(view.platform).toMatchObject({ id: 'xiaohongshu', sourceKind: 'legacy-defaulted-unknown' })
    expect(view.strategy).toMatchObject({ status: 'owner-mismatch', blocks: [] })
  })

  it('fails a copy strategy closed when its platform/style owner is inconsistent', () => {
    const base = createStepSixState()
    const state: WorkflowState = {
      ...base,
      platformCopy: {
        ...base.platformCopy,
        strategyOwner: { ...base.platformCopy.strategyOwner!, style: 'vibrant' },
      },
    }
    expect(selectStep6ViewModel(state).strategy.status).toBe('owner-mismatch')
  })

  it('requires exact Step 4, Step 5, Blob alias, group and ordered hash authority', () => {
    const valid = createStepSixState()
    expect(selectCurrentStep5Authority(valid)).toMatchObject({
      groupSignatureSha256: TEST_STEP5_GROUP_SIGNATURE,
      pageCount: 1,
    })
    const aliasBroken: WorkflowState = {
      ...valid,
      detailEditor: {
        ...valid.detailEditor,
        pages: [{
          ...valid.detailEditor.pages[0],
          currentExport: { ...valid.detailEditor.pages[0].currentExport! },
        }],
      },
    }
    expect(selectCurrentStep5Authority(aliasBroken)).toBeNull()
    expect(selectStep6ViewModel(aliasBroken).validEntry).toBe(false)
  })

  it('produces a fully hashed typed completion only for a valid authority', () => {
    const view = selectStep6ViewModel(createStepSixState())
    const completion = completionFromStep6View(view)
    expect(completion).toMatchObject({
      platformId: 'xiaohongshu',
      strategySourceKind: 'copy',
      strategyStatus: 'present',
    })
    expect(completion?.step6SignatureSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(completion?.strategySourceOwnerSignatureSha256).toMatch(/^[0-9a-f]{64}$/)
  })
})

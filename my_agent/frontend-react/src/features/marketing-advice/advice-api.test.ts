import { describe, expect, it, vi } from 'vitest'
import {
  fetchMarketingAdvice,
  MARKETING_ADVICE_ENDPOINT,
  validateMarketingAdviceResponse,
} from './advice-api'
import {
  domainSeparatedSignatureSha256,
  marketingAdviceInputSignatureSha256,
} from '../../state/workflow-v2/workflow-v2-signatures'
import type { AdviceResult } from '../../state/workflow-v2/workflow-v2-types'

const request = {
  product_info: 'API 工具',
  product_short_name: '云端套件',
  creative_note: '首行\r\n  次行',
} as const

const advice: AdviceResult = {
  category_id: 'digital',
  category_name: '数字产品',
  confidence: 'medium',
  matched_keywords: ['API', '工具'],
  reason: '根据关键词识别为数字产品。',
  score: 2,
  strategy: {
    id: 'digital',
    name: '数字产品策略',
    examples: 'API 与开发工具',
    traits: ['低边际成本', '专业用户决策'],
    tactics: ['清晰展示上手价值', '提供试用路径'],
    one_liner: '用真实使用场景说明效率提升。',
  },
  source: 'desktop_ai_different_product_marketing_strategies',
}

async function validDocument(
  input = request,
  result: AdviceResult = advice,
) {
  return {
    api_version: 'v1' as const,
    advice_version: 'catalog-v1' as const,
    status: 'present' as const,
    input_signature_sha256: await marketingAdviceInputSignatureSha256({
      productInfo: input.product_info,
      productShortName: input.product_short_name,
      creativeNote: input.creative_note,
    }),
    advice_signature_sha256: await domainSeparatedSignatureSha256(
      'marketing-advice-output-v1',
      result,
    ),
    advice: result,
  }
}

async function expectProtocolFailure(value: unknown) {
  await expect(validateMarketingAdviceResponse(value, request)).rejects.toMatchObject({
    kind: 'protocol',
  })
}

describe('marketing advice API client', () => {
  it('posts exactly the three consumed fields to the fixed endpoint', async () => {
    const document = await validDocument()
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify(document), { status: 200 }))

    await expect(fetchMarketingAdvice(request, { fetchImpl })).resolves.toEqual(document)
    expect(fetchImpl).toHaveBeenCalledWith(MARKETING_ADVICE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal: undefined,
    })
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({
      product_info: request.product_info,
      product_short_name: request.product_short_name,
      creative_note: request.creative_note,
    })
  })

  it('categorizes validation, server, and network failures safely', async () => {
    for (const [status, kind] of [[422, 'validation'], [500, 'network_server']] as const) {
      await expect(fetchMarketingAdvice(request, {
        fetchImpl: vi.fn().mockResolvedValue(new Response('{}', { status })),
      })).rejects.toMatchObject({ kind })
    }
    await expect(fetchMarketingAdvice(request, {
      fetchImpl: vi.fn().mockRejectedValue(new TypeError('offline')),
    })).rejects.toMatchObject({ kind: 'network_server' })
  })

  it('rejects malformed bodies, invalid enums, versions, status, source, and signatures', async () => {
    await expectProtocolFailure(null)
    const document = await validDocument()
    const mutations = [
      { ...document, api_version: 'v2' },
      { ...document, advice_version: 'catalog-v2' },
      { ...document, status: 'failed' },
      { ...document, input_signature_sha256: 'ABC' },
      { ...document, input_signature_sha256: '0'.repeat(64) },
      { ...document, advice_signature_sha256: 'f'.repeat(64) },
      { ...document, unexpected: true },
      { ...document, advice: { ...document.advice, confidence: 'certain' } },
      { ...document, advice: { ...document.advice, source: 'unknown' } },
      { ...document, advice: { ...document.advice, matched_keywords: ['API', 3] } },
    ]
    for (const mutation of mutations) await expectProtocolFailure(mutation)
  })

  it('uses the backend-compatible Unicode, LF, and CRLF canonical vectors', async () => {
    const unicodeSignature = await marketingAdviceInputSignatureSha256({
      productInfo: '　山茶花洗衣液，守护柔软👕　',
      productShortName: ' 柔护衣 ',
      creativeNote: '  轻盈香氛 · 夏日限定  ',
    })
    expect(unicodeSignature).toBe('1f263ed9cb0d06b73bf4d1e12382406f0483682630a2ee470ca0ac4948decbc3')

    const crlfSignature = await marketingAdviceInputSignatureSha256({
      productInfo: '\t  API 工具\r\n专业版  \n',
      productShortName: '  云端套件  ',
      creativeNote: '\r\n首行\r\n  次行\t ',
    })
    const lfSignature = await marketingAdviceInputSignatureSha256({
      productInfo: 'API 工具\n专业版',
      productShortName: '云端套件',
      creativeNote: '首行\n  次行',
    })
    expect(crlfSignature).toBe('26769b8f29c3d147476cb86d7e180df4717c4cde46f60235fef0ba117f46a849')
    expect(lfSignature).toBe('bc6dbb26520803da8f98e1f70a2746caf9668e260471c3f916af0483176a1d14')
    expect(crlfSignature).not.toBe(lfSignature)
  })

  it('preserves response array order and accepts the successful low-confidence fallback', async () => {
    const lowConfidence: AdviceResult = {
      ...advice,
      category_id: 'fmcg',
      category_name: '快消品',
      confidence: 'low',
      matched_keywords: [],
      score: 0,
    }
    const parsed = await validateMarketingAdviceResponse(
      await validDocument(request, lowConfidence),
      request,
    )
    expect(parsed.advice.confidence).toBe('low')
    expect(parsed.advice.matched_keywords).toEqual([])
    expect((await validDocument(request, advice)).advice.strategy.tactics).toEqual([
      '清晰展示上手价值',
      '提供试用路径',
    ])
  })

  it('turns a malformed JSON 200 response into a protocol error', async () => {
    await expect(fetchMarketingAdvice(request, {
      fetchImpl: vi.fn().mockResolvedValue(new Response('{', { status: 200 })),
    })).rejects.toMatchObject({ kind: 'protocol' })
  })

  it('preserves AbortError for the provider lifecycle to classify as cancellation', async () => {
    const abort = new DOMException('aborted', 'AbortError')
    await expect(fetchMarketingAdvice(request, {
      fetchImpl: vi.fn().mockRejectedValue(abort),
    })).rejects.toBe(abort)
  })
})

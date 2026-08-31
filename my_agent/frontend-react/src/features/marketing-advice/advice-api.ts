import {
  domainSeparatedSignatureSha256,
  marketingAdviceInputSignatureSha256,
} from '../../state/workflow-v2/workflow-v2-signatures'
import type {
  AdviceCategoryId,
  AdviceConfidence,
  AdviceResult,
} from '../../state/workflow-v2/workflow-v2-types'

export const MARKETING_ADVICE_ENDPOINT = '/api/v1/marketing-advice'

export interface MarketingAdviceRequestPayload {
  readonly product_info: string
  readonly product_short_name: string
  readonly creative_note: string
}

export interface MarketingAdviceResponsePayload {
  readonly api_version: 'v1'
  readonly advice_version: 'catalog-v1'
  readonly status: 'present'
  readonly input_signature_sha256: string
  readonly advice_signature_sha256: string
  readonly advice: AdviceResult
}

export type MarketingAdviceErrorKind =
  | 'validation'
  | 'network_server'
  | 'protocol'

export class MarketingAdviceApiError extends Error {
  constructor(public readonly kind: MarketingAdviceErrorKind) {
    super(kind)
    this.name = 'MarketingAdviceApiError'
  }
}

interface FetchOptions {
  readonly signal?: AbortSignal
  readonly fetchImpl?: typeof fetch
}

const SHA256 = /^[a-f0-9]{64}$/
const CATEGORY_IDS = new Set<AdviceCategoryId>([
  'fmcg',
  'durable',
  'service',
  'digital',
  'luxury',
  'b2b',
  'health',
])
const CONFIDENCES = new Set<AdviceConfidence>(['low', 'medium', 'high'])
const SOURCE = 'desktop_ai_different_product_marketing_strategies' as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function stringArray(value: unknown): readonly string[] | null {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
    ? value
    : null
}

function parseAdvice(value: unknown): AdviceResult | null {
  if (!isRecord(value) || !hasExactKeys(value, [
    'category_id', 'category_name', 'confidence', 'matched_keywords', 'reason',
    'score', 'strategy', 'source',
  ])) return null
  if (
    typeof value.category_id !== 'string' || !CATEGORY_IDS.has(value.category_id as AdviceCategoryId) ||
    typeof value.category_name !== 'string' ||
    typeof value.confidence !== 'string' || !CONFIDENCES.has(value.confidence as AdviceConfidence) ||
    typeof value.reason !== 'string' ||
    typeof value.score !== 'number' || !Number.isSafeInteger(value.score) || value.score < 0 ||
    value.source !== SOURCE ||
    !isRecord(value.strategy) ||
    !hasExactKeys(value.strategy, ['id', 'name', 'examples', 'traits', 'tactics', 'one_liner']) ||
    typeof value.strategy.id !== 'string' || !CATEGORY_IDS.has(value.strategy.id as AdviceCategoryId) ||
    typeof value.strategy.name !== 'string' ||
    typeof value.strategy.examples !== 'string' ||
    typeof value.strategy.one_liner !== 'string'
  ) return null

  const matchedKeywords = stringArray(value.matched_keywords)
  const traits = stringArray(value.strategy.traits)
  const tactics = stringArray(value.strategy.tactics)
  if (!matchedKeywords || !traits || !tactics) return null

  return {
    category_id: value.category_id as AdviceCategoryId,
    category_name: value.category_name,
    confidence: value.confidence as AdviceConfidence,
    matched_keywords: matchedKeywords,
    reason: value.reason,
    score: value.score,
    strategy: {
      id: value.strategy.id as AdviceCategoryId,
      name: value.strategy.name,
      examples: value.strategy.examples,
      traits,
      tactics,
      one_liner: value.strategy.one_liner,
    },
    source: SOURCE,
  }
}

export function requestPayloadFromBasicText(input: {
  readonly productInfo: string
  readonly productShortName: string
  readonly creativeNote: string
}): MarketingAdviceRequestPayload {
  return {
    product_info: input.productInfo,
    product_short_name: input.productShortName,
    creative_note: input.creativeNote,
  }
}

export async function validateMarketingAdviceResponse(
  value: unknown,
  request: MarketingAdviceRequestPayload,
): Promise<MarketingAdviceResponsePayload> {
  if (!isRecord(value) || !hasExactKeys(value, [
    'api_version', 'advice_version', 'status', 'input_signature_sha256',
    'advice_signature_sha256', 'advice',
  ])) throw new MarketingAdviceApiError('protocol')

  const advice = parseAdvice(value.advice)
  if (
    value.api_version !== 'v1' ||
    value.advice_version !== 'catalog-v1' ||
    value.status !== 'present' ||
    typeof value.input_signature_sha256 !== 'string' || !SHA256.test(value.input_signature_sha256) ||
    typeof value.advice_signature_sha256 !== 'string' || !SHA256.test(value.advice_signature_sha256) ||
    advice === null
  ) throw new MarketingAdviceApiError('protocol')

  const expectedInput = await marketingAdviceInputSignatureSha256({
    productInfo: request.product_info,
    productShortName: request.product_short_name,
    creativeNote: request.creative_note,
  })
  const expectedAdvice = await domainSeparatedSignatureSha256(
    'marketing-advice-output-v1',
    advice,
  )
  if (
    value.input_signature_sha256 !== expectedInput ||
    value.advice_signature_sha256 !== expectedAdvice
  ) throw new MarketingAdviceApiError('protocol')

  return {
    api_version: 'v1',
    advice_version: 'catalog-v1',
    status: 'present',
    input_signature_sha256: value.input_signature_sha256,
    advice_signature_sha256: value.advice_signature_sha256,
    advice,
  }
}

export async function fetchMarketingAdvice(
  request: MarketingAdviceRequestPayload,
  options: FetchOptions = {},
): Promise<MarketingAdviceResponsePayload> {
  const runFetch = options.fetchImpl ?? globalThis.fetch
  let response: Response
  try {
    response = await runFetch(MARKETING_ADVICE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal: options.signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new MarketingAdviceApiError('network_server')
  }

  if (response.status === 422) throw new MarketingAdviceApiError('validation')
  if (response.status !== 200) throw new MarketingAdviceApiError('network_server')

  let document: unknown
  try {
    document = await response.json()
  } catch {
    throw new MarketingAdviceApiError('protocol')
  }
  return validateMarketingAdviceResponse(document, request)
}

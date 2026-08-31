import type {
  CopyVariant,
  MarketingStrategy,
  NormalizedCopyResponse,
} from '../../types/platform-copy'

export const COPY_REQUEST_TIMEOUT_MS = 120_000
export const EMPTY_COPY_RESULT_MESSAGE = '文案生成结果为空，请重试。'

const GENERIC_BACKEND_ERROR_MESSAGE = '后端未能完成请求。'
const NETWORK_ERROR_MESSAGE = '无法连接生成服务，请稍后重试。'
const TIMEOUT_ERROR_MESSAGE = '文案生成超时，未自动重试；请稍后重试。'
const INVALID_RESPONSE_MESSAGE = '文案生成响应无效，请重试。'
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const UNSAFE_MESSAGE_PATTERN =
  /(?:<\/?(?:html|script|body)|traceback|stack\s*trace|api[_-]?key|secret|token)/i

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function optionalString(
  record: Record<string, unknown>,
  key: 'title' | 'headline' | 'subline',
) {
  const value = record[key]
  return typeof value === 'string' ? value : undefined
}

export function normalizeCopyVariant(value: unknown): CopyVariant | null {
  if (!isRecord(value) || typeof value.body !== 'string') {
    return null
  }

  if (!value.body.trim()) {
    return null
  }

  return {
    ...value,
    body: value.body,
    title: optionalString(value, 'title'),
    headline: optionalString(value, 'headline'),
    subline: optionalString(value, 'subline'),
  }
}

function normalizeStrategy(value: unknown): MarketingStrategy {
  return isRecord(value) ? { ...value } : {}
}

function normalizeRequestId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const candidate = value.trim()
  return UUID_PATTERN.test(candidate) ? candidate : null
}

export function normalizeCopyResponse(value: unknown): NormalizedCopyResponse {
  if (!isRecord(value)) {
    throw new CopyApiError(INVALID_RESPONSE_MESSAGE, 'protocol')
  }

  const variants = Array.isArray(value.marketing_copy_variants)
    ? value.marketing_copy_variants
        .map(normalizeCopyVariant)
        .filter((variant): variant is CopyVariant => variant !== null)
        .slice(0, 3)
    : []

  if (variants.length === 0) {
    const fallback = normalizeCopyVariant(value.marketing_copy)
    if (fallback) {
      variants.push(fallback)
    }
  }

  return {
    variants,
    marketingStrategy: normalizeStrategy(value.marketing_strategy),
    requestId: normalizeRequestId(value.request_id),
  }
}

function safeBackendMessage(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const message = value.trim()
  if (
    message.length === 0 ||
    message.length > 300 ||
    /[\r\n]/.test(message) ||
    UNSAFE_MESSAGE_PATTERN.test(message)
  ) {
    return null
  }

  return message
}

async function parseSafeBackendError(response: Response): Promise<string> {
  try {
    const document: unknown = await response.json()
    if (!isRecord(document) || !isRecord(document.error)) {
      return GENERIC_BACKEND_ERROR_MESSAGE
    }

    const message = safeBackendMessage(document.error.message)
    if (!message) {
      return GENERIC_BACKEND_ERROR_MESSAGE
    }

    const requestId = normalizeRequestId(document.error.request_id)
    return requestId ? `${message}（请求编号：${requestId}）` : message
  } catch {
    return GENERIC_BACKEND_ERROR_MESSAGE
  }
}

export class CopyApiError extends Error {
  constructor(
    public readonly userMessage: string,
    public readonly kind: 'network_server' | 'protocol' = 'network_server',
  ) {
    super(userMessage)
    this.name = 'CopyApiError'
  }
}

interface GenerateCopyOptions {
  timeoutMs?: number
  signal?: AbortSignal
}

export async function generatePlatformCopy(
  canonicalPayload: string,
  idempotencyKey: string,
  options: GenerateCopyOptions = {},
): Promise<NormalizedCopyResponse> {
  const controller = new AbortController()
  let timedOut = false
  const abortForCaller = () => controller.abort()
  if (options.signal?.aborted) controller.abort()
  options.signal?.addEventListener('abort', abortForCaller, { once: true })
  const timeoutId = globalThis.setTimeout(() => {
    timedOut = true
    controller.abort()
  }, options.timeoutMs ?? COPY_REQUEST_TIMEOUT_MS)

  const formData = new FormData()
  formData.append('payload', canonicalPayload)

  try {
    const response = await fetch('/api/v1/generations', {
      method: 'POST',
      headers: {
        'X-Idempotency-Key': idempotencyKey,
      },
      body: formData,
      signal: controller.signal,
    })

    if (response.status !== 200) {
      throw new CopyApiError(await parseSafeBackendError(response))
    }

    let document: unknown
    try {
      document = await response.json()
    } catch {
      throw new CopyApiError(INVALID_RESPONSE_MESSAGE, 'protocol')
    }

    return normalizeCopyResponse(document)
  } catch (error) {
    if (error instanceof CopyApiError) {
      throw error
    }
    if (options.signal?.aborted && !timedOut) {
      throw error
    }
    if (timedOut) {
      throw new CopyApiError(TIMEOUT_ERROR_MESSAGE)
    }
    throw new CopyApiError(NETWORK_ERROR_MESSAGE)
  } finally {
    globalThis.clearTimeout(timeoutId)
    options.signal?.removeEventListener('abort', abortForCaller)
  }
}

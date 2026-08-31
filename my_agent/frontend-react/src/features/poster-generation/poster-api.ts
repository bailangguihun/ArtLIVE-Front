import type { NormalizedSequenceResult } from '../../types/poster-generation'
import {
  INVALID_SEQUENCE_RESPONSE_MESSAGE,
  isValidUuid,
  normalizeSequenceResult,
  safeRelativeApiUrl,
} from './poster-normalizer'

export const POSTER_ADMISSION_TIMEOUT_MS = 120_000
export const POSTER_POLL_TIMEOUT_MS = 10_000

export const BACKEND_UNAVAILABLE_MESSAGE =
  '后端服务未启动，请先启动本地 API 服务。'
export const POSTER_ADMISSION_TIMEOUT_MESSAGE =
  '海报生成任务创建超时，未自动重试；请使用相同内容再次尝试。'
export const POSTER_POLL_ERROR_MESSAGE = '无法读取海报生成状态，请稍后重试。'
export const POSTER_PREVIEW_ERROR_MESSAGE = '无法加载本张海报预览。'
export const POSTER_DOWNLOAD_ERROR_MESSAGE = '无法下载本张无字底海报。'
export const ZIP_DOWNLOAD_ERROR_MESSAGE = '无法下载无字底海报压缩包。'
const GENERIC_BACKEND_ERROR_MESSAGE = '后端未能完成请求。'
const CAPABILITIES_ERROR_MESSAGE = '无法读取海报生成功能状态。'
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const UNSAFE_MESSAGE_PATTERN =
  /(?:<\/?(?:html|script|body)|traceback|stack\s*trace|api[_-]?key|secret|token)/i

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function normalizeRequestId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const candidate = value.trim()
  return UUID_PATTERN.test(candidate) ? candidate : null
}

function safeBackendMessage(value: unknown): string | null {
  if (typeof value !== 'string') return null
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

async function parseSafeBackendError(
  response: Response,
  fallback = GENERIC_BACKEND_ERROR_MESSAGE,
): Promise<string> {
  try {
    const document: unknown = await response.json()
    if (!isRecord(document) || !isRecord(document.error)) {
      return fallback
    }
    const message = safeBackendMessage(document.error.message)
    if (!message) return fallback
    const requestId = normalizeRequestId(document.error.request_id)
    return requestId ? `${message}（请求编号：${requestId}）` : message
  } catch {
    return fallback
  }
}

interface TimedSignal {
  signal: AbortSignal
  didTimeOut: () => boolean
  cleanup: () => void
}

function timedSignal(
  timeoutMs: number,
  externalSignal?: AbortSignal,
): TimedSignal {
  const controller = new AbortController()
  let timedOut = false
  const abortFromExternal = () => controller.abort(externalSignal?.reason)
  if (externalSignal?.aborted) {
    abortFromExternal()
  } else {
    externalSignal?.addEventListener('abort', abortFromExternal, { once: true })
  }
  const timeoutId = globalThis.setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  return {
    signal: controller.signal,
    didTimeOut: () => timedOut,
    cleanup: () => {
      globalThis.clearTimeout(timeoutId)
      externalSignal?.removeEventListener('abort', abortFromExternal)
    },
  }
}

export class PosterApiError extends Error {
  constructor(
    public readonly userMessage: string,
    public readonly ambiguous = false,
  ) {
    super(userMessage)
    this.name = 'PosterApiError'
  }
}

export interface PosterCapabilities {
  sequenceEnabled: boolean
  seedreamConfigured: boolean
}

export async function getPosterCapabilities(
  externalSignal?: AbortSignal,
): Promise<PosterCapabilities> {
  const timer = timedSignal(POSTER_POLL_TIMEOUT_MS, externalSignal)
  try {
    const health = await fetch('/api/v1/health', { signal: timer.signal })
    if (!health.ok) {
      throw new PosterApiError(BACKEND_UNAVAILABLE_MESSAGE)
    }
    try {
      const healthDocument: unknown = await health.json()
      if (!isRecord(healthDocument) || healthDocument.status !== 'ok') {
        throw new PosterApiError(BACKEND_UNAVAILABLE_MESSAGE)
      }
    } catch (error) {
      if (error instanceof PosterApiError) {
        throw error
      }
      throw new PosterApiError(BACKEND_UNAVAILABLE_MESSAGE)
    }

    const response = await fetch('/api/v1/capabilities', {
      signal: timer.signal,
    })
    if (!response.ok) {
      throw new PosterApiError(
        await parseSafeBackendError(response, CAPABILITIES_ERROR_MESSAGE),
      )
    }
    let document: unknown
    try {
      document = await response.json()
    } catch {
      throw new PosterApiError(CAPABILITIES_ERROR_MESSAGE)
    }
    if (!isRecord(document) || !Array.isArray(document.generation_modes)) {
      throw new PosterApiError(CAPABILITIES_ERROR_MESSAGE)
    }
    const sequence = document.generation_modes.find(
      (item) =>
        isRecord(item) &&
        item.mode === 'seedream_product_poster_sequence',
    )
    if (
      !isRecord(sequence) ||
      typeof sequence.enabled !== 'boolean' ||
      typeof document.seedream_configured !== 'boolean'
    ) {
      throw new PosterApiError(CAPABILITIES_ERROR_MESSAGE)
    }
    return {
      sequenceEnabled: sequence.enabled,
      seedreamConfigured: document.seedream_configured,
    }
  } catch (error) {
    if (error instanceof PosterApiError) {
      throw error
    }
    throw new PosterApiError(BACKEND_UNAVAILABLE_MESSAGE)
  } finally {
    timer.cleanup()
  }
}

interface CreateSequenceOptions {
  timeoutMs?: number
}

export async function createPosterSequence(
  canonicalPayload: string,
  productImageBytes: ArrayBuffer,
  productImageMimeType: string,
  idempotencyKey: string,
  options: CreateSequenceOptions = {},
): Promise<NormalizedSequenceResult> {
  const timer = timedSignal(
    options.timeoutMs ?? POSTER_ADMISSION_TIMEOUT_MS,
  )
  const formData = new FormData()
  formData.append('payload', canonicalPayload)
  formData.append(
    'product_image',
    new File([productImageBytes], 'product-upload', {
      type: productImageMimeType,
    }),
    'product-upload',
  )

  try {
    const response = await fetch('/api/v1/generations', {
      method: 'POST',
      headers: { 'X-Idempotency-Key': idempotencyKey },
      body: formData,
      signal: timer.signal,
    })
    if (response.status !== 202) {
      throw new PosterApiError(
        await parseSafeBackendError(response),
        response.status >= 500,
      )
    }
    let document: unknown
    try {
      document = await response.json()
    } catch {
      throw new PosterApiError(INVALID_SEQUENCE_RESPONSE_MESSAGE, true)
    }
    try {
      return normalizeSequenceResult(document)
    } catch {
      throw new PosterApiError(INVALID_SEQUENCE_RESPONSE_MESSAGE, true)
    }
  } catch (error) {
    if (error instanceof PosterApiError) {
      throw error
    }
    if (timer.didTimeOut()) {
      throw new PosterApiError(POSTER_ADMISSION_TIMEOUT_MESSAGE, true)
    }
    throw new PosterApiError(BACKEND_UNAVAILABLE_MESSAGE, true)
  } finally {
    timer.cleanup()
  }
}

interface GetGenerationOptions {
  signal?: AbortSignal
  timeoutMs?: number
}

export async function getPosterGeneration(
  generationId: string,
  options: GetGenerationOptions = {},
): Promise<NormalizedSequenceResult> {
  if (!isValidUuid(generationId)) {
    throw new PosterApiError('生成任务编号无效。')
  }
  const timer = timedSignal(
    options.timeoutMs ?? POSTER_POLL_TIMEOUT_MS,
    options.signal,
  )
  try {
    const response = await fetch(`/api/v1/generations/${generationId}`, {
      signal: timer.signal,
    })
    if (!response.ok) {
      throw new PosterApiError(
        await parseSafeBackendError(response, POSTER_POLL_ERROR_MESSAGE),
      )
    }
    let document: unknown
    try {
      document = await response.json()
    } catch {
      throw new PosterApiError(POSTER_POLL_ERROR_MESSAGE)
    }
    let result: NormalizedSequenceResult
    try {
      result = normalizeSequenceResult(document)
    } catch {
      throw new PosterApiError(POSTER_POLL_ERROR_MESSAGE)
    }
    if (result.generationId !== generationId) {
      throw new PosterApiError(POSTER_POLL_ERROR_MESSAGE)
    }
    return result
  } catch (error) {
    if (error instanceof PosterApiError) {
      throw error
    }
    if (options.signal?.aborted) {
      throw error
    }
    throw new PosterApiError(POSTER_POLL_ERROR_MESSAGE)
  } finally {
    timer.cleanup()
  }
}

function hasPngSignature(bytes: Uint8Array) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10]
  return signature.every((byte, index) => bytes[index] === byte)
}

function hasZipSignature(bytes: Uint8Array) {
  return (
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    ((bytes[2] === 0x03 && bytes[3] === 0x04) ||
      (bytes[2] === 0x05 && bytes[3] === 0x06) ||
      (bytes[2] === 0x07 && bytes[3] === 0x08))
  )
}

async function fetchBinary(
  resourceUrl: string,
  kind: 'png' | 'zip',
  signal?: AbortSignal,
  errorFallback?: string,
): Promise<Blob> {
  const safeUrl = safeRelativeApiUrl(resourceUrl)
  const fallback =
    errorFallback ??
    (kind === 'png' ? POSTER_DOWNLOAD_ERROR_MESSAGE : ZIP_DOWNLOAD_ERROR_MESSAGE)
  if (!safeUrl) {
    throw new PosterApiError(fallback)
  }
  const timer = timedSignal(POSTER_ADMISSION_TIMEOUT_MS, signal)
  try {
    const response = await fetch(safeUrl, { signal: timer.signal })
    if (!response.ok) {
      throw new PosterApiError(await parseSafeBackendError(response, fallback))
    }
    const contentType = (response.headers.get('Content-Type') || '')
      .split(';', 1)[0]
      .trim()
      .toLowerCase()
    const bytes = new Uint8Array(await response.arrayBuffer())
    const valid =
      kind === 'png'
        ? contentType === 'image/png' && hasPngSignature(bytes)
        : (contentType === 'application/zip' ||
            contentType === 'application/x-zip-compressed') &&
          hasZipSignature(bytes)
    if (!valid) {
      throw new PosterApiError(fallback)
    }
    return new Blob([bytes], {
      type: kind === 'png' ? 'image/png' : 'application/zip',
    })
  } catch (error) {
    if (error instanceof PosterApiError) {
      throw error
    }
    if (signal?.aborted) {
      throw error
    }
    throw new PosterApiError(fallback)
  } finally {
    timer.cleanup()
  }
}

export function fetchPosterPng(resourceUrl: string, signal?: AbortSignal) {
  return fetchBinary(resourceUrl, 'png', signal)
}

export function fetchPosterPreviewPng(
  resourceUrl: string,
  signal?: AbortSignal,
) {
  return fetchBinary(resourceUrl, 'png', signal, POSTER_PREVIEW_ERROR_MESSAGE)
}

export function fetchPosterZip(resourceUrl: string, signal?: AbortSignal) {
  return fetchBinary(resourceUrl, 'zip', signal)
}

export function triggerBlobDownload(objectUrl: string, fileName: string) {
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = fileName
  anchor.rel = 'noopener'
  anchor.style.display = 'none'
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
}

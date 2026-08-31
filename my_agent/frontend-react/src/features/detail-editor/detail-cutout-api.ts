import { validatePngBlob } from './detail-resources'

export const DETAIL_CUTOUT_TIMEOUT_MS = 180_000

const safeMessages: Record<string, string> = {
  upload_too_large: '上传图片超过大小限制。',
  unsupported_image_type: '仅支持 PNG、JPEG 或 WebP 图片。',
  invalid_image: '上传内容不是有效图片。',
  invalid_request: '请求格式无效。',
  timeout: '去除背景超时，请稍后重试。',
  cutout_failed: '去除背景失败，请重试。',
}

function uuid(value: unknown) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) ? value : null
}

async function safeError(response: Response) {
  try {
    const envelope = await response.clone().json() as { error?: { code?: unknown; request_id?: unknown } }
    const code = typeof envelope?.error?.code === 'string' ? envelope.error.code : ''
    void uuid(envelope?.error?.request_id)
    return safeMessages[code] ?? safeMessages.cutout_failed
  } catch {
    return safeMessages.cutout_failed
  }
}

export async function requestDetailCutout(source: Blob, signal?: AbortSignal) {
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  const timer = globalThis.setTimeout(() => controller.abort(), DETAIL_CUTOUT_TIMEOUT_MS)
  try {
    const form = new FormData()
    form.append('product_image', source, 'product-image.png')
    const response = await fetch('/api/v1/tools/cutout', {
      method: 'POST',
      body: form,
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(await safeError(response))
    if ((response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase() !== 'image/png') throw new Error(safeMessages.cutout_failed)
    const blob = await response.blob()
    try {
      await validatePngBlob(blob, { requireAlpha: true })
    } catch (error) {
      throw new Error(safeMessages.cutout_failed, { cause: error })
    }
    return blob
  } catch (error) {
    if (controller.signal.aborted) throw new Error('去除背景超时，请稍后重试。', { cause: error })
    if (error instanceof Error && Object.values(safeMessages).includes(error.message)) throw error
    throw new Error('无法连接本地图片处理服务，请稍后重试。', { cause: error })
  } finally {
    globalThis.clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
  }
}

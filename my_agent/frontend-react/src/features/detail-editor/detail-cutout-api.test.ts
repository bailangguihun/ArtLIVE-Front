import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DETAIL_CUTOUT_TIMEOUT_MS, requestDetailCutout } from './detail-cutout-api'

const PNG_ALPHA = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6])

describe('relative cutout transaction', () => {
  beforeEach(() => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 10, height: 20, close: vi.fn() })))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('posts exactly one relative multipart request containing only product_image', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input
      void init
      return new Response(PNG_ALPHA, { status: 200, headers: { 'content-type': 'image/png' } })
    })
    vi.stubGlobal('fetch', fetchMock)
    const source = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })
    const result = await requestDetailCutout(source)
    expect(result.type).toBe('image/png')
    expect(fetchMock).toHaveBeenCalledOnce()
    const [path, init] = fetchMock.mock.calls[0] as [RequestInfo | URL, RequestInit]
    expect(path).toBe('/api/v1/tools/cutout')
    expect(init.method).toBe('POST')
    expect(init.body).toBeInstanceOf(FormData)
    const form = init.body as FormData
    expect([...form.keys()]).toEqual(['product_image'])
    expect(new Headers(init.headers).has('idempotency-key')).toBe(false)
  })

  it.each([
    [413, 'upload_too_large', '上传图片超过大小限制。'],
    [415, 'unsupported_image_type', '仅支持 PNG、JPEG 或 WebP 图片。'],
    [422, 'invalid_image', '上传内容不是有效图片。'],
    [504, 'timeout', '去除背景超时，请稍后重试。'],
    [500, 'cutout_failed', '去除背景失败，请重试。'],
  ])('maps HTTP %s safely without retry', async (status, code, message) => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: { code, message: '<unsafe stack>', request_id: '11111111-1111-4111-8111-111111111111' } }), {
      status,
      headers: { 'content-type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(requestDetailCutout(new Blob([PNG_ALPHA], { type: 'image/png' }))).rejects.toThrow(message)
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('maps malformed framework and malformed success bodies to a safe generic failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>trace C:\\secret</html>', { status: 500, headers: { 'content-type': 'text/html' } })))
    await expect(requestDetailCutout(new Blob([PNG_ALPHA], { type: 'image/png' }))).rejects.toThrow('去除背景失败，请重试。')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'image/png' } })))
    await expect(requestDetailCutout(new Blob([PNG_ALPHA], { type: 'image/png' }))).rejects.toThrow('去除背景失败，请重试。')
  })

  it('maps a network error safely and never performs a fallback or retry', async () => {
    const fetchMock = vi.fn(async () => { throw new TypeError('socket secret') })
    vi.stubGlobal('fetch', fetchMock)
    await expect(requestDetailCutout(new Blob([PNG_ALPHA], { type: 'image/png' }))).rejects.toThrow('无法连接本地图片处理服务，请稍后重试。')
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('uses the exact 180-second production timeout under fake timers', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn((_path: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
    }))
    vi.stubGlobal('fetch', fetchMock)
    const pending = requestDetailCutout(new Blob([PNG_ALPHA], { type: 'image/png' }))
    const rejection = expect(pending).rejects.toThrow('去除背景超时，请稍后重试。')
    await vi.advanceTimersByTimeAsync(DETAIL_CUTOUT_TIMEOUT_MS - 1)
    expect(fetchMock).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(1)
    await rejection
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})

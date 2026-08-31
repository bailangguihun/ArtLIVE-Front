import { afterEach, describe, expect, it, vi } from 'vitest'
import { generatePlatformCopy, normalizeCopyResponse } from './copy-api'

const requestId = '123e4567-e89b-42d3-a456-426614174000'

function jsonResponse(document: unknown, status = 200) {
  return new Response(JSON.stringify(document), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('copy API client', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('normalizes, filters, limits, and preserves complete variant objects', () => {
    const result = normalizeCopyResponse({
      request_id: requestId,
      marketing_copy_variants: [
        {
          body: '方案一',
          title: '标题一',
          headline: '主标一',
          subline: '副标一',
          future_field: { keep: true },
        },
        { body: '   ', title: '空白' },
        { body: '方案二' },
        { body: '方案三' },
        { body: '方案四' },
      ],
      marketing_strategy: { name: '完整策略', nested: { keep: true } },
    })

    expect(result.variants.map((variant) => variant.body)).toEqual([
      '方案一',
      '方案二',
      '方案三',
    ])
    expect(result.variants[0].future_field).toEqual({ keep: true })
    expect(result.marketingStrategy).toEqual({
      name: '完整策略',
      nested: { keep: true },
    })
    expect(result.requestId).toBe(requestId)
  })

  it('falls back to marketing_copy when the variants list is absent or unusable', () => {
    expect(
      normalizeCopyResponse({
        marketing_copy_variants: [{ body: ' ' }, { nope: true }],
        marketing_copy: {
          body: '回退正文',
          title: '回退标题',
          headline: '回退主标',
          subline: '回退副标',
        },
      }).variants,
    ).toEqual([
      {
        body: '回退正文',
        title: '回退标题',
        headline: '回退主标',
        subline: '回退副标',
      },
    ])
  })

  it('posts exactly one payload-only multipart request without a manual content type', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        request_id: requestId,
        marketing_copy_variants: [{ body: '真实结果' }],
        marketing_strategy: {},
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await generatePlatformCopy('{"canonical":true}', 'intent-key')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/v1/generations')
    expect(init?.method).toBe('POST')
    expect(new Headers(init?.headers).get('X-Idempotency-Key')).toBe(
      'intent-key',
    )
    expect(new Headers(init?.headers).has('Content-Type')).toBe(false)
    expect(init?.body).toBeInstanceOf(FormData)
    if (!(init?.body instanceof FormData)) {
      throw new Error('Expected FormData body')
    }
    expect([...init.body.entries()]).toEqual([
      ['payload', '{"canonical":true}'],
    ])
    expect(init.body.has('product_image')).toBe(false)
    expect(init.body.has('background_reference')).toBe(false)
  })

  it('renders only a documented safe backend message and valid request ID', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: 'invalid_payload',
            message: '请求字段无效。',
            request_id: requestId,
            traceback: 'must never be consumed',
          },
          raw_body: 'must never be consumed',
        },
        422,
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(generatePlatformCopy('{}', 'intent-key')).rejects.toMatchObject({
      userMessage: `请求字段无效。（请求编号：${requestId}）`,
    })
  })

  it('rejects non-200, HTML, and invalid JSON without leaking raw bodies', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response('<html>secret traceback</html>', { status: 500 }),
      )
      .mockResolvedValueOnce(jsonResponse({ marketing_copy: { body: 'x' } }, 202))
      .mockResolvedValueOnce(new Response('not-json', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(generatePlatformCopy('{}', 'intent-0')).rejects.toMatchObject({
      userMessage: '后端未能完成请求。',
    })
    await expect(generatePlatformCopy('{}', 'intent-1')).rejects.toMatchObject({
      userMessage: '后端未能完成请求。',
    })
    await expect(generatePlatformCopy('{}', 'intent-2')).rejects.toMatchObject({
      userMessage: '文案生成响应无效，请重试。',
    })
  })

  it('uses a total AbortController timeout and performs no retry', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn<typeof fetch>((_input, init) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'))
        })
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const request = generatePlatformCopy('{}', 'intent-key', { timeoutMs: 10 })
    const rejection = expect(request).rejects.toMatchObject({
      userMessage: '文案生成超时，未自动重试；请稍后重试。',
    })
    await vi.advanceTimersByTimeAsync(10)

    await rejection
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('turns a network failure into a stable user-facing error', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError('raw network detail'))
    vi.stubGlobal('fetch', fetchMock)

    await expect(generatePlatformCopy('{}', 'intent-key')).rejects.toMatchObject({
      userMessage: '无法连接生成服务，请稍后重试。',
    })
  })
})

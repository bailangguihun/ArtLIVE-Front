import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BACKEND_UNAVAILABLE_MESSAGE,
  createPosterSequence,
  fetchPosterPng,
  fetchPosterZip,
  getPosterCapabilities,
  getPosterGeneration,
  POSTER_ADMISSION_TIMEOUT_MESSAGE,
  POSTER_DOWNLOAD_ERROR_MESSAGE,
  PosterApiError,
  ZIP_DOWNLOAD_ERROR_MESSAGE,
} from './poster-api'
import {
  jsonResponse,
  PNG_BYTES,
  sequenceDocument,
  TEST_GENERATION_ID,
  TEST_REQUEST_ID,
  ZIP_BYTES,
} from './poster-test-utils'

describe('poster API transport', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('posts exactly payload + product_image with fixed filename, retained MIME, and one key', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(sequenceDocument(), 202))
    vi.stubGlobal('fetch', fetchMock)

    const result = await createPosterSequence(
      '{"style_template_id":"paper_doodle_grid"}',
      new Uint8Array([1, 2, 3]).buffer,
      'image/webp',
      'sequence-key',
    )

    expect(result.generationId).toBe(TEST_GENERATION_ID)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/v1/generations')
    expect(init?.method).toBe('POST')
    expect(new Headers(init?.headers).get('X-Idempotency-Key')).toBe(
      'sequence-key',
    )
    expect(new Headers(init?.headers).has('Content-Type')).toBe(false)
    expect(init?.body).toBeInstanceOf(FormData)
    const formData = init?.body as FormData
    expect([...formData.keys()]).toEqual(['payload', 'product_image'])
    expect(formData.get('payload')).toBe('{"style_template_id":"paper_doodle_grid"}')
    const image = formData.get('product_image')
    expect(image).toBeInstanceOf(File)
    expect((image as File).name).toBe('product-upload')
    expect((image as File).type).toBe('image/webp')
    expect(formData.has('background_reference')).toBe(false)
  })

  it.each([200, 201, 204, 400, 500])(
    'accepts only HTTP 202, not %i',
    async (status) => {
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          status === 204
            ? new Response(null, { status })
            : jsonResponse(sequenceDocument(), status),
        )
      vi.stubGlobal('fetch', fetchMock)
      await expect(
        createPosterSequence('{}', new ArrayBuffer(0), 'image/png', 'key'),
      ).rejects.toBeInstanceOf(PosterApiError)
    },
  )

  it('treats malformed 202 JSON and schema as safe ambiguous failures', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('not-json', { status: 202 }))
      .mockResolvedValueOnce(jsonResponse({ generation_id: 'bad' }, 202))
    vi.stubGlobal('fetch', fetchMock)

    for (const key of ['key-one', 'key-two']) {
      await expect(
        createPosterSequence('{}', new ArrayBuffer(0), 'image/png', key),
      ).rejects.toMatchObject({
        ambiguous: true,
        userMessage: '海报生成响应无效，请重试。',
      })
    }
  })

  it('never exposes provider envelope text or request IDs', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: 'provider_timeout',
            message: 'Seedream 请求超时，未自动重试。',
            request_id: TEST_REQUEST_ID,
            traceback: 'must stay hidden',
          },
          raw: '<html>secret</html>',
        },
        504,
      ),
    )
    vi.stubGlobal('fetch', fetchMock)
    try {
      await createPosterSequence('{}', new ArrayBuffer(0), 'image/png', 'key')
      throw new Error('Expected the provider envelope to be rejected')
    } catch (error) {
      expect(error).toBeInstanceOf(PosterApiError)
      const userMessage = (error as PosterApiError).userMessage
      expect(userMessage).toContain('请求超时')
      expect(userMessage).toContain(TEST_REQUEST_ID)
      expect(userMessage).not.toContain('traceback')
      expect(userMessage).not.toContain('<html>')
    }
  })

  it('uses a 120-second total admission AbortController and performs no retry', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn<typeof fetch>((_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'))
        })
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const request = createPosterSequence(
      '{}',
      new ArrayBuffer(0),
      'image/png',
      'key',
      { timeoutMs: 10 },
    )
    const rejection = expect(request).rejects.toMatchObject({
      ambiguous: true,
      userMessage: POSTER_ADMISSION_TIMEOUT_MESSAGE,
    })
    await vi.advanceTimersByTimeAsync(10)
    await rejection
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('uses exact health/capability routes and extracts sequence flags', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ status: 'ok', api_version: '1.0' }))
      .mockResolvedValueOnce(
        jsonResponse({
          seedream_configured: false,
          generation_modes: [
            {
              mode: 'seedream_product_poster_sequence',
              enabled: true,
            },
          ],
        }),
      )
    vi.stubGlobal('fetch', fetchMock)
    await expect(getPosterCapabilities()).resolves.toEqual({
      sequenceEnabled: true,
      seedreamConfigured: false,
    })
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/v1/health',
      '/api/v1/capabilities',
    ])
  })

  it('maps health transport failure to the exact local-backend message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockRejectedValue(new TypeError('raw network error')),
    )
    await expect(getPosterCapabilities()).rejects.toMatchObject({
      userMessage: BACKEND_UNAVAILABLE_MESSAGE,
    })
  })

  it('polls only the validated UUID endpoint and normalizes the result', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(sequenceDocument('running')))
    vi.stubGlobal('fetch', fetchMock)
    const result = await getPosterGeneration(TEST_GENERATION_ID)
    expect(result.status).toBe('running')
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/generations/${TEST_GENERATION_ID}`,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    await expect(getPosterGeneration('not-a-uuid')).rejects.toMatchObject({
      userMessage: '生成任务编号无效。',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('accepts only PNG-compatible bytes and rejects unsafe URLs before fetch', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(PNG_BYTES, {
          status: 200,
          headers: { 'Content-Type': 'image/png' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { 'Content-Type': 'image/png' },
        }),
      )
    vi.stubGlobal('fetch', fetchMock)
    await expect(fetchPosterPng('/api/v1/poster.png')).resolves.toMatchObject({
      type: 'image/png',
    })
    await expect(fetchPosterPng('/api/v1/bad.png')).rejects.toMatchObject({
      userMessage: POSTER_DOWNLOAD_ERROR_MESSAGE,
    })
    await expect(fetchPosterPng('https://evil.example/a')).rejects.toMatchObject({
      userMessage: POSTER_DOWNLOAD_ERROR_MESSAGE,
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('accepts ZIP only with completed binary-compatible response bytes', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(ZIP_BYTES, {
        status: 200,
        headers: { 'Content-Type': 'application/zip' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    await expect(fetchPosterZip('/api/v1/archive.zip')).resolves.toMatchObject({
      type: 'application/zip',
    })
    await expect(fetchPosterZip('/unsafe/archive.zip')).rejects.toMatchObject({
      userMessage: ZIP_DOWNLOAD_ERROR_MESSAGE,
    })
  })
})

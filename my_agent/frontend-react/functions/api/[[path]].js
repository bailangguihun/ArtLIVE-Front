const INTERNAL_PROXY_TOKEN_HEADER = 'X-AD-Edge-Proxy-Token'

const HOP_BY_HOP_HEADERS = [
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]

const SAFE_RESPONSE_HEADERS = [
  'accept-ranges',
  'age',
  'cache-control',
  'content-disposition',
  'content-encoding',
  'content-language',
  'content-range',
  'content-type',
  'etag',
  'expires',
  'last-modified',
  'retry-after',
  'vary',
  'x-request-id',
]

function genericError(status) {
  const message = status === 502 ? 'Bad gateway' : 'Service unavailable'
  return new Response(message, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/plain; charset=utf-8',
    },
  })
}

function parseBackendOrigin(value) {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) {
    return null
  }
  if (value.includes('?') || value.includes('#')) return null

  try {
    const url = new URL(value)
    if (
      url.protocol !== 'https:' ||
      url.username !== '' ||
      url.password !== '' ||
      url.pathname !== '/' ||
      url.search !== '' ||
      url.hash !== ''
    ) {
      return null
    }
    return url.origin
  } catch {
    return null
  }
}

function removeHopByHopHeaders(headers) {
  const connection = headers.get('connection')
  if (connection) {
    for (const header of connection.split(',')) {
      const name = header.trim()
      if (name) headers.delete(name)
    }
  }
  for (const header of HOP_BY_HOP_HEADERS) headers.delete(header)
}

function createBackendHeaders(requestHeaders, proxyToken) {
  const headers = new Headers(requestHeaders)
  removeHopByHopHeaders(headers)
  headers.delete('host')
  headers.delete('content-length')
  headers.delete(INTERNAL_PROXY_TOKEN_HEADER)
  headers.set(INTERNAL_PROXY_TOKEN_HEADER, proxyToken)
  return headers
}

function createBrowserResponse(response) {
  const headers = new Headers()
  for (const name of SAFE_RESPONSE_HEADERS) {
    const value = response.headers.get(name)
    if (value !== null) headers.set(name, value)
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

export async function onRequest({ request, env }) {
  let requestUrl
  try {
    requestUrl = new URL(request.url)
  } catch {
    return genericError(502)
  }

  if (!requestUrl.pathname.startsWith('/api/')) {
    return new Response('Not found', {
      status: 404,
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': 'text/plain; charset=utf-8',
      },
    })
  }

  const backendOrigin = parseBackendOrigin(env?.BACKEND_ORIGIN)
  const proxyToken = env?.BACKEND_PROXY_TOKEN
  if (
    backendOrigin === null ||
    backendOrigin === requestUrl.origin ||
    typeof proxyToken !== 'string' ||
    proxyToken.length === 0 ||
    proxyToken !== proxyToken.trim()
  ) {
    return genericError(503)
  }

  let headers
  try {
    headers = createBackendHeaders(request.headers, proxyToken)
  } catch {
    return genericError(503)
  }

  const init = {
    method: request.method,
    headers,
    redirect: 'manual',
    signal: request.signal,
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = request.body
    init.duplex = 'half'
  }

  try {
    const response = await fetch(
      `${backendOrigin}${requestUrl.pathname}${requestUrl.search}`,
      init,
    )
    return createBrowserResponse(response)
  } catch {
    return genericError(502)
  }
}

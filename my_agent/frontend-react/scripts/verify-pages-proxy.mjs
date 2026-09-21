import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const functionPath = process.argv[2]
const routesPath = process.argv[3]
const outputPath = process.argv[4]
if (!functionPath || !routesPath || !outputPath) throw new Error('Missing harness path argument')

const functionBytes = await readFile(functionPath)
const functionSha256 = createHash('sha256').update(functionBytes).digest('hex')
const { onRequest } = await import(`${pathToFileURL(functionPath).href}?sha256=${functionSha256}`)
const originalFetch = globalThis.fetch
const results = []
let unexpectedRealFetchCount = 0

const CONFIG = {
  BACKEND_ORIGIN: 'https://backend.example',
  BACKEND_PROXY_TOKEN: 'edge-proxy-secret',
}

async function run(title, assertion) {
  const startedAt = performance.now()
  try {
    await assertion()
    results.push({ title, status: 'PASS', durationMs: Math.round((performance.now() - startedAt) * 1000) / 1000 })
  } catch (error) {
    results.push({
      title,
      status: 'FAIL',
      durationMs: Math.round((performance.now() - startedAt) * 1000) / 1000,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

async function invoke({
  url = 'https://frontend.example/api/v1/health',
  method = 'GET',
  headers,
  body,
  env = CONFIG,
  response = new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
  fetchError,
  inspectFetch,
} = {}) {
  let fetchCalls = 0
  globalThis.fetch = async (target, init) => {
    fetchCalls += 1
    if (inspectFetch) await inspectFetch(target, init)
    if (fetchError) throw fetchError
    return response
  }
  try {
    const request = new Request(url, { method, headers, body })
    const result = await onRequest({ request, env })
    return { response: result, fetchCalls }
  } finally {
    globalThis.fetch = originalFetch
  }
}

await run('missing BACKEND_ORIGIN returns generic 503 without fetch', async () => {
  const result = await invoke({ env: { BACKEND_PROXY_TOKEN: CONFIG.BACKEND_PROXY_TOKEN } })
  assert.equal(result.fetchCalls, 0)
  assert.equal(result.response.status, 503)
  assert.equal(await result.response.text(), 'Service unavailable')
})

await run('HTTP BACKEND_ORIGIN is rejected with generic 503', async () => {
  const result = await invoke({ env: { ...CONFIG, BACKEND_ORIGIN: 'http://backend.example' } })
  assert.equal(result.fetchCalls, 0)
  assert.equal(result.response.status, 503)
})

await run('same-origin BACKEND_ORIGIN is rejected to prevent recursive proxying', async () => {
  const result = await invoke({ env: { ...CONFIG, BACKEND_ORIGIN: 'https://frontend.example' } })
  assert.equal(result.fetchCalls, 0)
  assert.equal(result.response.status, 503)
})

for (const [label, origin] of [
  ['malformed', 'not-an-origin'],
  ['credential-bearing', 'https://user:password@backend.example'],
  ['query-bearing', 'https://backend.example?destination=elsewhere'],
  ['fragment-bearing', 'https://backend.example#internal'],
  ['path-bearing', 'https://backend.example/private'],
]) {
  await run(`${label} BACKEND_ORIGIN is rejected with generic 503`, async () => {
    const result = await invoke({ env: { ...CONFIG, BACKEND_ORIGIN: origin } })
    assert.equal(result.fetchCalls, 0)
    assert.equal(result.response.status, 503)
    assert.equal(await result.response.text(), 'Service unavailable')
  })
}

await run('missing or empty BACKEND_PROXY_TOKEN fails closed with 503', async () => {
  for (const token of [undefined, '', '   ']) {
    const result = await invoke({ env: { BACKEND_ORIGIN: CONFIG.BACKEND_ORIGIN, BACKEND_PROXY_TOKEN: token } })
    assert.equal(result.fetchCalls, 0)
    assert.equal(result.response.status, 503)
  }
})

await run('client internal token is overwritten and never returned to browser headers', async () => {
  const result = await invoke({
    headers: { 'X-AD-Edge-Proxy-Token': 'client-token' },
    response: new Response('ok', {
      headers: { 'X-AD-Edge-Proxy-Token': CONFIG.BACKEND_PROXY_TOKEN },
    }),
    inspectFetch: (_target, init) => {
      assert.equal(init.headers.get('X-AD-Edge-Proxy-Token'), CONFIG.BACKEND_PROXY_TOKEN)
    },
  })
  assert.equal(result.response.headers.has('X-AD-Edge-Proxy-Token'), false)
})

await run('client cannot override configured backend destination', async () => {
  await invoke({
    url: 'https://attacker.invalid/api/v1/health?destination=https%3A%2F%2Fevil.invalid&origin=https%3A%2F%2Fevil.invalid',
    headers: { Host: 'evil.invalid', 'X-Forwarded-Host': 'evil.invalid' },
    inspectFetch: (target) => {
      assert.equal(target, 'https://backend.example/api/v1/health?destination=https%3A%2F%2Fevil.invalid&origin=https%3A%2F%2Fevil.invalid')
    },
  })
})

await run('API path and duplicate encoded query components are preserved', async () => {
  const expected = 'https://backend.example/api/v1/generations/item%2Fpart?a=1&a=2&encoded=%2Fvalue%20here'
  await invoke({
    url: 'https://frontend.example/api/v1/generations/item%2Fpart?a=1&a=2&encoded=%2Fvalue%20here',
    inspectFetch: (target) => assert.equal(target, expected),
  })
})

await run('GET method forwards without a request body', async () => {
  await invoke({
    inspectFetch: (_target, init) => {
      assert.equal(init.method, 'GET')
      assert.equal('body' in init, false)
    },
  })
})

await run('JSON POST preserves method Content-Type and exact body bytes', async () => {
  const body = JSON.stringify({ product: 'marine', quantity: 2 })
  await invoke({
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body,
    inspectFetch: async (_target, init) => {
      assert.equal(init.method, 'POST')
      assert.equal(init.headers.get('Content-Type'), 'application/json; charset=utf-8')
      assert.equal(await new Response(init.body).text(), body)
    },
  })
})

await run('multipart POST preserves generated Content-Type and payload', async () => {
  const form = new FormData()
  form.append('payload', 'canonical-payload')
  form.append('product_image', new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }), 'product.png')
  await invoke({
    method: 'POST',
    body: form,
    inspectFetch: async (_target, init) => {
      assert.match(init.headers.get('Content-Type'), /^multipart\/form-data; boundary=/)
      const forwarded = await new Response(init.body).text()
      assert.match(forwarded, /canonical-payload/)
      assert.match(forwarded, /product\.png/)
    },
  })
})

await run('X-Idempotency-Key is preserved exactly', async () => {
  await invoke({
    method: 'POST',
    headers: { 'X-Idempotency-Key': 'fixed-idempotency-key' },
    body: 'payload',
    inspectFetch: (_target, init) => {
      assert.equal(init.headers.get('X-Idempotency-Key'), 'fixed-idempotency-key')
    },
  })
})

await run('hop-by-hop Host Content-Length and connection-nominated headers are removed', async () => {
  await invoke({
    headers: {
      Connection: 'X-Transient',
      'X-Transient': 'remove-me',
      'Content-Length': '999',
      'Keep-Alive': 'timeout=5',
    },
    inspectFetch: (_target, init) => {
      for (const name of ['connection', 'x-transient', 'content-length', 'keep-alive', 'host']) {
        assert.equal(init.headers.has(name), false)
      }
    },
  })
})

await run('202 response status body Content-Type and safe cache header are preserved', async () => {
  const result = await invoke({
    response: new Response('{"status":"queued"}', {
      status: 202,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' },
    }),
  })
  assert.equal(result.response.status, 202)
  assert.equal(result.response.headers.get('Content-Type'), 'application/json')
  assert.equal(result.response.headers.get('Cache-Control'), 'private, no-store')
  assert.equal(await result.response.text(), '{"status":"queued"}')
})

await run('404 backend response is preserved', async () => {
  const result = await invoke({ response: new Response('missing', { status: 404 }) })
  assert.equal(result.response.status, 404)
  assert.equal(await result.response.text(), 'missing')
})

await run('PNG response bytes and MIME type are byte-identical', async () => {
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 1, 2, 3])
  const result = await invoke({
    response: new Response(png, { headers: { 'Content-Type': 'image/png' } }),
  })
  assert.equal(result.response.headers.get('Content-Type'), 'image/png')
  assert.deepEqual(new Uint8Array(await result.response.arrayBuffer()), png)
})

await run('ZIP bytes MIME Content-Disposition and cache metadata are preserved', async () => {
  const zip = new Uint8Array([80, 75, 3, 4, 10, 20, 30, 40])
  const result = await invoke({
    response: new Response(zip, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename="artifacts.zip"',
        ETag: '"stable-etag"',
      },
    }),
  })
  assert.equal(result.response.headers.get('Content-Type'), 'application/zip')
  assert.equal(result.response.headers.get('Content-Disposition'), 'attachment; filename="artifacts.zip"')
  assert.equal(result.response.headers.get('ETag'), '"stable-etag"')
  assert.deepEqual(new Uint8Array(await result.response.arrayBuffer()), zip)
})

await run('unsafe backend response headers are not exposed to the browser', async () => {
  const result = await invoke({
    response: new Response('redirect metadata', {
      status: 302,
      headers: {
        Location: 'https://internal-backend.example/private',
        'Set-Cookie': 'internal=true',
        Server: 'internal-server',
        'Access-Control-Allow-Origin': '*',
        'X-Request-ID': 'request-123',
      },
    }),
  })
  assert.equal(result.response.status, 302)
  assert.equal(result.response.headers.get('X-Request-ID'), 'request-123')
  for (const name of ['location', 'set-cookie', 'server', 'access-control-allow-origin']) {
    assert.equal(result.response.headers.has(name), false)
  }
})

await run('network failure returns generic 502 without internal details', async () => {
  const result = await invoke({ fetchError: new Error('connect E:/private backend.example edge-proxy-secret') })
  assert.equal(result.response.status, 502)
  const body = await result.response.text()
  assert.equal(body, 'Bad gateway')
  for (const forbidden of ['backend.example', 'edge-proxy-secret', 'E:/private', 'Error', 'stack']) {
    assert.equal(body.includes(forbidden), false)
  }
})

await run('configuration errors contain no origin token stack or local path', async () => {
  const result = await invoke({
    env: { BACKEND_ORIGIN: 'https://user:password@internal.example/private', BACKEND_PROXY_TOKEN: 'do-not-leak' },
  })
  const body = await result.response.text()
  assert.equal(result.response.status, 503)
  for (const forbidden of ['internal.example', 'do-not-leak', 'password', 'E:/', 'stack']) {
    assert.equal(body.includes(forbidden), false)
  }
})

await run('direct non-API invocation returns 404 without backend fetch', async () => {
  const result = await invoke({ url: 'https://frontend.example/basic' })
  assert.equal(result.response.status, 404)
  assert.equal(result.fetchCalls, 0)
})

await run('_routes.json invokes Functions only for /api/*', async () => {
  const routes = JSON.parse(await readFile(routesPath, 'utf8'))
  assert.deepEqual(routes, { version: 1, include: ['/api/*'], exclude: [] })
  for (const route of ['/basic', '/poster', '/history', '/detail', '/assets/app.js']) {
    assert.equal(routes.include.includes(route), false)
  }
})

globalThis.fetch = originalFetch
const failed = results.filter((result) => result.status === 'FAIL')
const report = {
  schemaVersion: 1,
  functionPath: functionPath.replaceAll('\\', '/'),
  functionSha256,
  routesPath: routesPath.replaceAll('\\', '/'),
  realNetworkRequests: unexpectedRealFetchCount,
  total: results.length,
  passed: results.length - failed.length,
  failed: failed.length,
  results,
}
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
console.log(JSON.stringify({ total: report.total, passed: report.passed, failed: report.failed, realNetworkRequests: report.realNetworkRequests }, null, 2))
if (failed.length > 0) process.exitCode = 1

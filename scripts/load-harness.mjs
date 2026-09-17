import { performance } from 'node:perf_hooks'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'

function integerEnv(name, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`)
  }
  return value
}

export function normalizeLoadBaseUrl(value) {
  if (!value) throw new Error('LOAD_BASE_URL is required')
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error('LOAD_BASE_URL must be a valid URL')
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('LOAD_BASE_URL must use HTTP or HTTPS')
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('LOAD_BASE_URL must not contain credentials, query parameters or fragments')
  }
  url.pathname = url.pathname.replace(/\/+$/, '')
  return url.toString().replace(/\/$/, '')
}

function percentile(sorted, p) {
  if (!sorted.length) return 0
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return Number(sorted[index].toFixed(2))
}

async function jsonRequest(baseUrl, path, {
  method = 'GET',
  sessionId,
  body,
  fetchImpl = fetch,
  timeoutMs = 15_000,
} = {}) {
  const headers = { Accept: 'application/json' }
  if (sessionId) headers['X-Demo-Session'] = sessionId
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  const startedAt = performance.now()
  const response = await fetchImpl(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })
  const latencyMs = performance.now() - startedAt
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    const error = new Error(`${method} ${path} failed with HTTP ${response.status}`)
    error.status = response.status
    error.latencyMs = latencyMs
    error.payload = payload
    throw error
  }
  return { payload, latencyMs }
}

export async function runLoadTest({
  baseUrl,
  concurrency = 5,
  requests = 50,
  fetchImpl = fetch,
} = {}) {
  const target = normalizeLoadBaseUrl(baseUrl)
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 50) {
    throw new Error('concurrency must be an integer between 1 and 50')
  }
  if (!Number.isInteger(requests) || requests < 1 || requests > 10_000) {
    throw new Error('requests must be an integer between 1 and 10000')
  }

  await jsonRequest(target, '/api/v1/health/live', { fetchImpl })
  const games = await jsonRequest(target, '/api/v1/games', { fetchImpl })
  const game = games.payload?.games?.find((candidate) => (
    candidate?.status === 'playable' && Array.isArray(candidate.allowedBets) && candidate.allowedBets.length
  ))
  if (!game) throw new Error('No playable demo game is available for load testing')
  const bet = game.allowedBets[0]

  let nextIndex = 0
  const latencies = []
  const errors = []

  async function worker(workerIndex) {
    const opened = await jsonRequest(target, '/api/v1/session', {
      method: 'POST',
      body: { player: `load-${workerIndex}-${randomUUID().slice(0, 8)}` },
      fetchImpl,
    })
    const sessionId = opened.payload?.session?.id
    if (!sessionId) throw new Error('Synthetic session creation did not return an id')

    try {
      while (true) {
        const index = nextIndex
        nextIndex += 1
        if (index >= requests) break

        try {
          const result = await jsonRequest(target, '/api/v1/spin', {
            method: 'POST',
            sessionId,
            body: {
              gameId: game.id,
              bet,
              idempotencyKey: `load-${workerIndex}-${index}-${randomUUID()}`,
            },
            fetchImpl,
          })
          latencies.push(result.latencyMs)
        } catch (error) {
          errors.push({
            index,
            status: error.status || null,
            message: error.message,
          })
        }
      }
    } finally {
      await jsonRequest(target, '/api/v1/session', {
        method: 'DELETE',
        sessionId,
        fetchImpl,
      }).catch(() => {})
    }
  }

  const startedAt = performance.now()
  await Promise.all(Array.from({ length: Math.min(concurrency, requests) }, (_, index) => worker(index + 1)))
  const durationMs = performance.now() - startedAt
  const sorted = [...latencies].sort((a, b) => a - b)
  const completed = latencies.length
  const failed = errors.length

  return {
    ok: failed === 0,
    target,
    mode: 'demo',
    gameId: game.id,
    bet,
    configuredRequests: requests,
    completedRequests: completed,
    failedRequests: failed,
    errorRate: Number((failed / requests).toFixed(4)),
    concurrency: Math.min(concurrency, requests),
    durationMs: Number(durationMs.toFixed(2)),
    requestsPerSecond: durationMs > 0
      ? Number(((completed + failed) / (durationMs / 1000)).toFixed(2))
      : 0,
    latencyMs: {
      p50: percentile(sorted, 50),
      p95: percentile(sorted, 95),
      p99: percentile(sorted, 99),
    },
    errors: errors.slice(0, 20),
  }
}

async function main() {
  const result = await runLoadTest({
    baseUrl: process.env.LOAD_BASE_URL,
    concurrency: integerEnv('LOAD_CONCURRENCY', 5, { min: 1, max: 50 }),
    requests: integerEnv('LOAD_REQUESTS', 50, { min: 1, max: 10_000 }),
  })
  console.log(JSON.stringify(result, null, 2))
  if (!result.ok) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(JSON.stringify({ ok: false, error: error?.message || 'Load test failed' }))
    process.exitCode = 1
  })
}

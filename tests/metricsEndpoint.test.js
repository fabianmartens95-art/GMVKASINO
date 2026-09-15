import test from 'node:test'
import assert from 'node:assert/strict'
import { SessionStore } from '../server/sessionStore.js'
import { SlidingWindowRateLimiter } from '../server/rateLimiter.js'
import { AuditLog } from '../server/auditLog.js'
import { OperationalMetrics } from '../server/operationalMetrics.js'
import { CasinoService } from '../server/casinoService.js'
import { createHttpServer } from '../server/httpServer.js'

const METRICS_TOKEN = 'metrics-test-token-0123456789abcdef'

function createTestServer({ metricsToken = METRICS_TOKEN } = {}) {
  const metrics = new OperationalMetrics()
  const service = new CasinoService({
    sessionStore: new SessionStore({ startingBalance: 1000, metrics }),
    rateLimiter: new SlidingWindowRateLimiter({ limit: 5, windowMs: 10_000 }),
    auditLog: new AuditLog({ sink: () => {} }),
    rng: () => 0,
    metrics,
  })
  const server = createHttpServer({
    service,
    metrics,
    config: { maxBodyBytes: 16_384, metricsToken },
    staticDir: '/tmp/gmvkasino-no-static',
    log: () => {},
  })
  return { server, metrics }
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  return `http://127.0.0.1:${address.port}`
}

async function close(server) {
  await new Promise((resolve) => server.close(resolve))
}

test('metrics endpoint is protected and contains no player/session/token secrets', async () => {
  const { server } = createTestServer()
  const baseUrl = await listen(server)

  try {
    const sessionResponse = await fetch(`${baseUrl}/api/v1/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ player: 'Sensitive QA Player' }),
    })
    const { session } = await sessionResponse.json()

    const spinResponse = await fetch(`${baseUrl}/api/v1/spin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Demo-Session': session.id,
      },
      body: JSON.stringify({ gameId: 'golden-vault', bet: 1 }),
    })
    assert.equal(spinResponse.status, 200)

    const unauthorized = await fetch(`${baseUrl}/api/v1/internal/metrics`)
    assert.equal(unauthorized.status, 401)

    await fetch(`${baseUrl}/api/v1/arbitrary/high-cardinality/value-12345`)

    const authorized = await fetch(`${baseUrl}/api/v1/internal/metrics`, {
      headers: { Authorization: `Bearer ${METRICS_TOKEN}` },
    })
    assert.equal(authorized.status, 200)
    const raw = await authorized.text()
    const payload = JSON.parse(raw)

    assert.equal(raw.includes(session.id), false)
    assert.equal(raw.includes('Sensitive QA Player'), false)
    assert.equal(raw.includes(METRICS_TOKEN), false)
    assert.equal(payload.metrics.events['session.created'], 1)
    assert.equal(payload.metrics.events['spin.resolved'], 1)
    assert.equal(payload.metrics.events['spin.win'], 1)
    assert.equal(
      payload.metrics.requests.some((entry) => entry.route.includes('value-12345')),
      false,
    )
    assert.equal(
      payload.metrics.requests.some((entry) => entry.route === '/api/v1/other'),
      true,
    )
  } finally {
    await close(server)
  }
})

test('metrics endpoint stays hidden when METRICS_TOKEN is not configured', async () => {
  const { server } = createTestServer({ metricsToken: '' })
  const baseUrl = await listen(server)

  try {
    const response = await fetch(`${baseUrl}/api/v1/internal/metrics`, {
      headers: { Authorization: `Bearer ${METRICS_TOKEN}` },
    })
    assert.equal(response.status, 404)
  } finally {
    await close(server)
  }
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { SlidingWindowRateLimiter } from '../server/rateLimiter.js'
import { createHttpServer } from '../server/httpServer.js'

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

function fakeService() {
  return {
    metrics: null,
    checkReadiness: async () => ({ ok: true, backend: 'memory' }),
    openSession: async ({ accountId }) => ({
      id: 'protected-game-session',
      accountId,
      balance: 1000,
      authRequired: true,
    }),
    getGames: () => [],
  }
}

test('account auth endpoints stay unavailable without the PostgreSQL auth service', async () => {
  const server = createHttpServer({
    service: fakeService(),
    config: { maxBodyBytes: 16_384, metricsToken: '' },
    staticDir: '/tmp/gmvkasino-no-static',
    log: () => {},
  })
  const baseUrl = await listen(server)

  try {
    const response = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'guest@example.com', password: 'long-enough-demo-password' }),
    })
    assert.equal(response.status, 503)
    assert.equal((await response.json()).error.code, 'AUTH_UNAVAILABLE')
  } finally {
    await close(server)
  }
})

test('authentication attempts use a separate sliding-window rate limit', async () => {
  const authService = {
    register: async () => ({
      account: { id: 'account-1', email: 'rate@example.com', displayName: '', status: 'active' },
      wallet: { balance: 1000 },
      auth: { token: 'auth-token-abcdefghijklmnopqrstuvwxyz-1234567890', expiresAt: 123 },
    }),
  }
  const server = createHttpServer({
    service: fakeService(),
    authService,
    authRateLimiter: new SlidingWindowRateLimiter({ limit: 1, windowMs: 60_000 }),
    config: { maxBodyBytes: 16_384, metricsToken: '' },
    staticDir: '/tmp/gmvkasino-no-static',
    log: () => {},
  })
  const baseUrl = await listen(server)

  try {
    const request = () => fetch(`${baseUrl}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'rate@example.com', password: 'long-enough-demo-password' }),
    })

    assert.equal((await request()).status, 201)
    const limited = await request()
    assert.equal(limited.status, 429)
    assert.equal((await limited.json()).error.code, 'AUTH_RATE_LIMITED')
    assert.ok(Number(limited.headers.get('retry-after')) >= 1)
  } finally {
    await close(server)
  }
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { SessionStore } from '../server/sessionStore.js'
import { SlidingWindowRateLimiter } from '../server/rateLimiter.js'
import { AuditLog } from '../server/auditLog.js'
import { CasinoService } from '../server/casinoService.js'
import { createHttpServer, isPathWithin } from '../server/httpServer.js'

function createTestServer({ log = () => {} } = {}) {
  const service = new CasinoService({
    sessionStore: new SessionStore({ startingBalance: 1000 }),
    rateLimiter: new SlidingWindowRateLimiter({ limit: 5, windowMs: 10_000 }),
    auditLog: new AuditLog({ sink: () => {} }),
    rng: () => 0,
  })

  const config = {
    maxBodyBytes: 16_384,
  }

  return createHttpServer({
    service,
    config,
    staticDir: '/tmp/gmvkasino-no-static',
    log,
  })
}

async function listen(server) {
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolvePromise)
  })
  const address = server.address()
  return `http://127.0.0.1:${address.port}`
}

async function close(server) {
  await new Promise((resolvePromise) => server.close(resolvePromise))
}

test('static path containment accepts children and rejects parent or sibling escapes', () => {
  const root = resolve('tmp', 'gmvkasino-static')

  assert.equal(isPathWithin(root, resolve(root, 'assets', 'app.js')), true)
  assert.equal(isPathWithin(root, root), true)
  assert.equal(isPathWithin(root, resolve(root, '..', 'secret.txt')), false)
  assert.equal(
    isPathWithin(root, resolve(root, '..', 'gmvkasino-static-escape', 'secret.txt')),
    false,
  )
})

test('API v1 creates a session and resolves a server-side spin with request IDs', async () => {
  const server = createTestServer()
  const baseUrl = await listen(server)

  try {
    const healthResponse = await fetch(`${baseUrl}/api/v1/health`)
    assert.equal(healthResponse.status, 200)
    assert.match(healthResponse.headers.get('x-request-id'), /^[A-Za-z0-9._-]{8,80}$/)
    const health = await healthResponse.json()
    assert.equal(health.mode, 'demo')
    assert.equal(health.apiVersion, 'v1')
    assert.equal(health.milestone, 'M4')

    const sessionResponse = await fetch(`${baseUrl}/api/v1/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ player: 'QA' }),
    })
    assert.equal(sessionResponse.status, 200)
    const { session } = await sessionResponse.json()
    assert.equal(session.balance, 1000)
    assert.ok(session.id.length >= 40)

    const spinResponse = await fetch(`${baseUrl}/api/v1/spin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Demo-Session': session.id,
        'X-Request-Id': 'qa-request-1234',
      },
      body: JSON.stringify({ gameId: 'golden-vault', bet: 1 }),
    })
    assert.equal(spinResponse.status, 200)
    assert.equal(spinResponse.headers.get('x-request-id'), 'qa-request-1234')
    const { result } = await spinResponse.json()
    assert.equal(result.totalWin, 50)
    assert.equal(result.balance, 1049)
  } finally {
    await close(server)
  }
})

test('API v1 requires a valid demo session for spins and traces the error', async () => {
  const server = createTestServer()
  const baseUrl = await listen(server)

  try {
    const response = await fetch(`${baseUrl}/api/v1/spin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId: 'golden-vault', bet: 1 }),
    })
    assert.equal(response.status, 401)
    const payload = await response.json()
    assert.equal(payload.error.code, 'SESSION_REQUIRED')
    assert.equal(payload.error.requestId, response.headers.get('x-request-id'))
  } finally {
    await close(server)
  }
})

test('legacy API alias remains available during v1 migration', async () => {
  const server = createTestServer()
  const baseUrl = await listen(server)

  try {
    const response = await fetch(`${baseUrl}/api/health`)
    assert.equal(response.status, 200)
    assert.equal((await response.json()).apiVersion, 'v1')
  } finally {
    await close(server)
  }
})

test('session rotation invalidates the previous bearer token and DELETE invalidates the replacement', async () => {
  const server = createTestServer()
  const baseUrl = await listen(server)

  try {
    const createResponse = await fetch(`${baseUrl}/api/v1/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ player: 'Lifecycle QA' }),
    })
    const { session: original } = await createResponse.json()

    const rotateResponse = await fetch(`${baseUrl}/api/v1/session/rotate`, {
      method: 'POST',
      headers: { 'X-Demo-Session': original.id },
    })
    assert.equal(rotateResponse.status, 200)
    const { session: rotated } = await rotateResponse.json()
    assert.notEqual(rotated.id, original.id)
    assert.equal(rotated.player, 'Lifecycle QA')

    const oldTokenResponse = await fetch(`${baseUrl}/api/v1/session`, {
      headers: { 'X-Demo-Session': original.id },
    })
    assert.equal(oldTokenResponse.status, 401)

    const rotatedTokenResponse = await fetch(`${baseUrl}/api/v1/session`, {
      headers: { 'X-Demo-Session': rotated.id },
    })
    assert.equal(rotatedTokenResponse.status, 200)

    const invalidateResponse = await fetch(`${baseUrl}/api/v1/session`, {
      method: 'DELETE',
      headers: { 'X-Demo-Session': rotated.id },
    })
    assert.equal(invalidateResponse.status, 200)
    assert.equal((await invalidateResponse.json()).invalidated, true)

    const invalidatedResponse = await fetch(`${baseUrl}/api/v1/session`, {
      headers: { 'X-Demo-Session': rotated.id },
    })
    assert.equal(invalidatedResponse.status, 401)
  } finally {
    await close(server)
  }
})

test('structured HTTP request logs never contain the bearer session token', async () => {
  const logs = []
  const server = createTestServer({ log: (entry) => logs.push(entry) })
  const baseUrl = await listen(server)

  try {
    const createResponse = await fetch(`${baseUrl}/api/v1/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ player: 'Log QA' }),
    })
    const { session } = await createResponse.json()

    const sessionResponse = await fetch(`${baseUrl}/api/v1/session`, {
      headers: { 'X-Demo-Session': session.id },
    })
    assert.equal(sessionResponse.status, 200)

    assert.ok(logs.length >= 2)
    assert.equal(logs.some((entry) => entry.includes(session.id)), false)
  } finally {
    await close(server)
  }
})

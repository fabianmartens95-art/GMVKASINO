import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { SessionStore } from '../server/sessionStore.js'
import { SlidingWindowRateLimiter } from '../server/rateLimiter.js'
import { AuditLog } from '../server/auditLog.js'
import { CasinoService } from '../server/casinoService.js'
import { createHttpServer, isPathWithin } from '../server/httpServer.js'

function createService() {
  return new CasinoService({
    sessionStore: new SessionStore({ startingBalance: 1000 }),
    rateLimiter: new SlidingWindowRateLimiter({ limit: 5, windowMs: 10_000 }),
    auditLog: new AuditLog({ sink: () => {} }),
    rng: () => 0,
  })
}

function createTestServer({ log = () => {}, service = createService() } = {}) {
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

test('liveness stays healthy while readiness reflects persistence availability', async () => {
  const unavailableService = createService()
  unavailableService.checkReadiness = async () => {
    throw new Error('persistence unavailable')
  }

  const server = createTestServer({ service: unavailableService })
  const baseUrl = await listen(server)

  try {
    const liveResponse = await fetch(`${baseUrl}/api/v1/health/live`)
    assert.equal(liveResponse.status, 200)
    const live = await liveResponse.json()
    assert.equal(live.ok, true)
    assert.equal(live.status, 'live')
    assert.equal(live.mode, 'demo')
    assert.equal(live.apiVersion, 'v1')
    assert.equal(live.milestone, 'M6')

    const readyResponse = await fetch(`${baseUrl}/api/v1/health/ready`)
    assert.equal(readyResponse.status, 503)
    const ready = await readyResponse.json()
    assert.equal(ready.ok, false)
    assert.equal(ready.status, 'not_ready')
    assert.equal(ready.persistence, undefined)
  } finally {
    await close(server)
  }
})

test('readiness reports the active storage backend and compatibility aliases remain available', async () => {
  const server = createTestServer()
  const baseUrl = await listen(server)

  try {
    for (const path of ['/api/v1/health/ready', '/api/v1/health', '/api/v1/ready', '/api/health']) {
      const response = await fetch(`${baseUrl}${path}`)
      assert.equal(response.status, 200)
      assert.match(response.headers.get('x-request-id'), /^[A-Za-z0-9._-]{8,80}$/)
      const payload = await response.json()
      assert.equal(payload.ok, true)
      assert.equal(payload.status, 'ready')
      assert.equal(payload.mode, 'demo')
      assert.equal(payload.apiVersion, 'v1')
      assert.equal(payload.milestone, 'M6')
      assert.equal(payload.persistence, 'memory')
    }
  } finally {
    await close(server)
  }
})

test('API v1 creates a session, exposes a DEMO wallet and resolves a server-side spin', async () => {
  const server = createTestServer()
  const baseUrl = await listen(server)

  try {
    const sessionResponse = await fetch(`${baseUrl}/api/v1/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ player: 'QA' }),
    })
    assert.equal(sessionResponse.status, 200)
    const { session } = await sessionResponse.json()
    assert.equal(session.balance, 1000)
    assert.ok(session.id.length >= 40)

    const walletResponse = await fetch(`${baseUrl}/api/v1/wallet`, {
      headers: { 'X-Demo-Session': session.id },
    })
    assert.equal(walletResponse.status, 200)
    const { wallet } = await walletResponse.json()
    assert.equal(wallet.asset.code, 'DEMO')
    assert.equal(wallet.asset.decimals, 2)
    assert.equal(wallet.balanceAtomic, '100000')
    assert.equal(wallet.balanceExact, '1000.00')

    const spinResponse = await fetch(`${baseUrl}/api/v1/spin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Demo-Session': session.id,
        'X-Request-Id': 'qa-request-1234',
      },
      body: JSON.stringify({ gameId: 'golden-vault', bet: 1, idempotencyKey: 'qa-spin-0001' }),
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

test('spin endpoint requires an idempotency key', async () => {
  const server = createTestServer()
  const baseUrl = await listen(server)

  try {
    const sessionResponse = await fetch(`${baseUrl}/api/v1/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ player: 'Idempotency QA' }),
    })
    const { session } = await sessionResponse.json()

    const response = await fetch(`${baseUrl}/api/v1/spin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Demo-Session': session.id,
      },
      body: JSON.stringify({ gameId: 'golden-vault', bet: 1 }),
    })

    assert.equal(response.status, 400)
    assert.equal((await response.json()).error.code, 'IDEMPOTENCY_KEY_REQUIRED')
  } finally {
    await close(server)
  }
})

test('spin endpoint replays the original result and rejects fingerprint conflicts', async () => {
  const server = createTestServer()
  const baseUrl = await listen(server)

  try {
    const sessionResponse = await fetch(`${baseUrl}/api/v1/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ player: 'Replay QA' }),
    })
    const { session } = await sessionResponse.json()
    const headers = {
      'Content-Type': 'application/json',
      'X-Demo-Session': session.id,
    }
    const idempotencyKey = 'qa-replay-0001'

    const first = await fetch(`${baseUrl}/api/v1/spin`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ gameId: 'golden-vault', bet: 1, idempotencyKey }),
    })
    const firstPayload = await first.json()
    assert.equal(first.status, 200)

    const replay = await fetch(`${baseUrl}/api/v1/spin`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ gameId: 'golden-vault', bet: 1, idempotencyKey }),
    })
    const replayPayload = await replay.json()
    assert.equal(replay.status, 200)
    assert.deepEqual(replayPayload.result, firstPayload.result)

    const sessionAfter = await fetch(`${baseUrl}/api/v1/session`, { headers: { 'X-Demo-Session': session.id } })
    const { session: storedSession } = await sessionAfter.json()
    assert.equal(storedSession.spins, 1)
    assert.equal(storedSession.balance, 1049)

    const conflict = await fetch(`${baseUrl}/api/v1/spin`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ gameId: 'golden-vault', bet: 2, idempotencyKey }),
    })
    assert.equal(conflict.status, 409)
    assert.equal((await conflict.json()).error.code, 'IDEMPOTENCY_CONFLICT')
  } finally {
    await close(server)
  }
})

test('wallet and spin endpoints require a valid demo session', async () => {
  const server = createTestServer()
  const baseUrl = await listen(server)

  try {
    const walletResponse = await fetch(`${baseUrl}/api/v1/wallet`)
    assert.equal(walletResponse.status, 401)
    assert.equal((await walletResponse.json()).error.code, 'SESSION_REQUIRED')

    const response = await fetch(`${baseUrl}/api/v1/spin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId: 'golden-vault', bet: 1, idempotencyKey: 'qa-no-session-01' }),
    })
    assert.equal(response.status, 401)
    const payload = await response.json()
    assert.equal(payload.error.code, 'SESSION_REQUIRED')
    assert.equal(payload.error.requestId, response.headers.get('x-request-id'))
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

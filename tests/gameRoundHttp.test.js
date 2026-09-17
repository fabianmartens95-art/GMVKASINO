import test from 'node:test'
import assert from 'node:assert/strict'
import { SessionStore } from '../server/sessionStore.js'
import { SlidingWindowRateLimiter } from '../server/rateLimiter.js'
import { AuditLog } from '../server/auditLog.js'
import { CasinoService } from '../server/casinoService.js'
import { createHttpServer } from '../server/httpServer.js'

function createTestServer({ rng = () => 0 } = {}) {
  const service = new CasinoService({
    sessionStore: new SessionStore({ startingBalance: 1000 }),
    rateLimiter: new SlidingWindowRateLimiter({ limit: 10, windowMs: 10_000 }),
    auditLog: new AuditLog({ sink: () => {} }),
    rng,
  })

  return createHttpServer({
    service,
    config: { maxBodyBytes: 16_384 },
    staticDir: '/tmp/gmvkasino-no-static',
    log: () => {},
  })
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

async function openSession(baseUrl) {
  const response = await fetch(`${baseUrl}/api/v1/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ player: 'Round HTTP QA' }),
  })
  assert.equal(response.status, 200)
  return (await response.json()).session
}

async function postSpin(baseUrl, sessionId, idempotencyKey, bet = 1) {
  return fetch(`${baseUrl}/api/v1/spin`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Demo-Session': sessionId,
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body: JSON.stringify({ gameId: 'golden-vault', bet }),
  })
}

test('HTTP spin requires a valid Idempotency-Key for an active session', async () => {
  const server = createTestServer()
  const baseUrl = await listen(server)

  try {
    const session = await openSession(baseUrl)
    const response = await postSpin(baseUrl, session.id, '')

    assert.equal(response.status, 400)
    assert.equal((await response.json()).error.code, 'IDEMPOTENCY_KEY_REQUIRED')
  } finally {
    await close(server)
  }
})

test('HTTP retry with the same key replays the exact round without a second RNG resolution', async () => {
  let rngCalls = 0
  const server = createTestServer({ rng: () => {
    rngCalls += 1
    return 0
  } })
  const baseUrl = await listen(server)

  try {
    const session = await openSession(baseUrl)
    const key = 'http-replay-round-0001'

    const firstResponse = await postSpin(baseUrl, session.id, key)
    assert.equal(firstResponse.status, 200)
    const first = (await firstResponse.json()).result
    const callsAfterFirst = rngCalls

    const replayResponse = await postSpin(baseUrl, session.id, key)
    assert.equal(replayResponse.status, 200)
    const replay = (await replayResponse.json()).result

    assert.deepEqual(replay, first)
    assert.equal(rngCalls, callsAfterFirst)

    const sessionResponse = await fetch(`${baseUrl}/api/v1/session`, {
      headers: { 'X-Demo-Session': session.id },
    })
    const current = (await sessionResponse.json()).session
    assert.equal(current.spins, 1)
    assert.equal(current.balance, first.balance)
  } finally {
    await close(server)
  }
})

test('HTTP reuse of an idempotency key with a different request returns a conflict', async () => {
  const server = createTestServer()
  const baseUrl = await listen(server)

  try {
    const session = await openSession(baseUrl)
    const key = 'http-conflict-round-0001'

    const first = await postSpin(baseUrl, session.id, key, 1)
    assert.equal(first.status, 200)
    const firstRound = (await first.json()).result

    const conflict = await postSpin(baseUrl, session.id, key, 2)
    assert.equal(conflict.status, 409)
    const payload = await conflict.json()
    assert.equal(payload.error.code, 'IDEMPOTENCY_CONFLICT')
    assert.equal(payload.error.details.roundId, firstRound.roundId)

    const sessionResponse = await fetch(`${baseUrl}/api/v1/session`, {
      headers: { 'X-Demo-Session': session.id },
    })
    const current = (await sessionResponse.json()).session
    assert.equal(current.spins, 1)
  } finally {
    await close(server)
  }
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionStore } from '../server/sessionStore.js'
import { SlidingWindowRateLimiter } from '../server/rateLimiter.js'
import { AuditLog } from '../server/auditLog.js'
import { CasinoService } from '../server/casinoService.js'
import { createHttpServer } from '../server/httpServer.js'

function createTestServer({
  startingBalance = 1000,
  sessionTtlMs = 86_400_000,
  sessionNow = Date.now,
  rateLimit = 5,
  rateWindowMs = 10_000,
  rateNow = Date.now,
  maxBodyBytes = 16_384,
  rng = () => 0,
  staticDir = '/tmp/gmvkasino-no-static',
} = {}) {
  const service = new CasinoService({
    sessionStore: new SessionStore({
      startingBalance,
      ttlMs: sessionTtlMs,
      now: sessionNow,
    }),
    rateLimiter: new SlidingWindowRateLimiter({
      limit: rateLimit,
      windowMs: rateWindowMs,
      now: rateNow,
    }),
    auditLog: new AuditLog({ sink: () => {} }),
    rng,
  })

  return createHttpServer({
    service,
    config: { maxBodyBytes },
    staticDir,
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

async function openSession(baseUrl, player = 'QA') {
  const response = await fetch(`${baseUrl}/api/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ player }),
  })
  assert.equal(response.status, 200)
  return (await response.json()).session
}

async function spin(baseUrl, sessionId, body) {
  return fetch(`${baseUrl}/api/spin`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Demo-Session': sessionId,
    },
    body: JSON.stringify(body),
  })
}

test('HTTP API rejects malformed JSON', async () => {
  const server = createTestServer()
  const baseUrl = await listen(server)

  try {
    const response = await fetch(`${baseUrl}/api/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{',
    })

    assert.equal(response.status, 400)
    const payload = await response.json()
    assert.equal(payload.error.code, 'INVALID_JSON')
  } finally {
    await close(server)
  }
})

test('HTTP API rejects request bodies above the configured limit', async () => {
  const server = createTestServer({ maxBodyBytes: 12 })
  const baseUrl = await listen(server)

  try {
    const response = await fetch(`${baseUrl}/api/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ player: 'body-is-too-large' }),
    })

    assert.equal(response.status, 413)
    const payload = await response.json()
    assert.equal(payload.error.code, 'BODY_TOO_LARGE')
  } finally {
    await close(server)
  }
})

test('HTTP API rejects unavailable games and disallowed bets', async () => {
  const server = createTestServer()
  const baseUrl = await listen(server)

  try {
    const session = await openSession(baseUrl)

    const unavailable = await spin(baseUrl, session.id, {
      gameId: 'neon-fruits',
      bet: 1,
    })
    assert.equal(unavailable.status, 404)
    assert.equal((await unavailable.json()).error.code, 'GAME_UNAVAILABLE')

    const invalidBet = await spin(baseUrl, session.id, {
      gameId: 'golden-vault',
      bet: 3,
    })
    assert.equal(invalidBet.status, 400)
    assert.equal((await invalidBet.json()).error.code, 'INVALID_BET')
  } finally {
    await close(server)
  }
})

test('HTTP API blocks spins when demo credits are insufficient', async () => {
  const server = createTestServer({ startingBalance: 1 })
  const baseUrl = await listen(server)

  try {
    const session = await openSession(baseUrl)
    const response = await spin(baseUrl, session.id, {
      gameId: 'golden-vault',
      bet: 2,
    })

    assert.equal(response.status, 409)
    assert.equal((await response.json()).error.code, 'INSUFFICIENT_DEMO_CREDITS')
  } finally {
    await close(server)
  }
})

test('HTTP API enforces the spin rate limit and returns Retry-After', async () => {
  let now = 1_000
  const server = createTestServer({
    rateLimit: 1,
    rateWindowMs: 10_000,
    rateNow: () => now,
  })
  const baseUrl = await listen(server)

  try {
    const session = await openSession(baseUrl)

    const first = await spin(baseUrl, session.id, {
      gameId: 'golden-vault',
      bet: 1,
    })
    assert.equal(first.status, 200)

    now = 2_000
    const second = await spin(baseUrl, session.id, {
      gameId: 'golden-vault',
      bet: 1,
    })

    assert.equal(second.status, 429)
    assert.equal(second.headers.get('retry-after'), '9')
    const payload = await second.json()
    assert.equal(payload.error.code, 'RATE_LIMITED')
    assert.equal(payload.error.details.retryAfterMs, 9_000)
  } finally {
    await close(server)
  }
})

test('expired sessions are rejected and opening again creates a new session', async () => {
  let now = 1_000
  const server = createTestServer({
    sessionTtlMs: 100,
    sessionNow: () => now,
  })
  const baseUrl = await listen(server)

  try {
    const session = await openSession(baseUrl)
    now = 1_101

    const expired = await fetch(`${baseUrl}/api/session`, {
      headers: { 'X-Demo-Session': session.id },
    })
    assert.equal(expired.status, 401)
    assert.equal((await expired.json()).error.code, 'SESSION_REQUIRED')

    const replacement = await fetch(`${baseUrl}/api/session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Demo-Session': session.id,
      },
      body: JSON.stringify({ player: 'QA' }),
    })
    assert.equal(replacement.status, 200)
    const payload = await replacement.json()
    assert.notEqual(payload.session.id, session.id)
  } finally {
    await close(server)
  }
})

test('static server serves assets and uses index.html as SPA fallback', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gmvkasino-static-'))
  const assets = join(root, 'assets')
  await mkdir(assets)
  await writeFile(join(root, 'index.html'), '<main>GMVKASINO</main>')
  await writeFile(join(assets, 'app.js'), 'console.log("gmvkasino")')

  const server = createTestServer({ staticDir: root })
  const baseUrl = await listen(server)

  try {
    const asset = await fetch(`${baseUrl}/assets/app.js`)
    assert.equal(asset.status, 200)
    assert.match(asset.headers.get('content-type'), /text\/javascript/)
    assert.equal(await asset.text(), 'console.log("gmvkasino")')

    const fallback = await fetch(`${baseUrl}/lobby/golden-vault`)
    assert.equal(fallback.status, 200)
    assert.match(fallback.headers.get('content-type'), /text\/html/)
    assert.equal(await fallback.text(), '<main>GMVKASINO</main>')
  } finally {
    await close(server)
    await rm(root, { recursive: true, force: true })
  }
})

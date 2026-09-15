import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { SessionStore } from '../server/sessionStore.js'
import { SlidingWindowRateLimiter } from '../server/rateLimiter.js'
import { AuditLog } from '../server/auditLog.js'
import { CasinoService } from '../server/casinoService.js'
import { createHttpServer, isPathWithin } from '../server/httpServer.js'

function createTestServer() {
  const service = new CasinoService({
    sessionStore: new SessionStore({ startingBalance: 1000 }),
    rateLimiter: new SlidingWindowRateLimiter({ limit: 5, windowMs: 10_000 }),
    auditLog: new AuditLog({ sink: () => {} }),
    rng: () => 0,
  })

  const config = {
    maxBodyBytes: 16_384,
  }

  return createHttpServer({ service, config, staticDir: '/tmp/gmvkasino-no-static' })
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

test('HTTP API creates a session and resolves a server-side spin', async () => {
  const server = createTestServer()
  const baseUrl = await listen(server)

  try {
    const healthResponse = await fetch(`${baseUrl}/api/health`)
    assert.equal(healthResponse.status, 200)
    assert.equal((await healthResponse.json()).mode, 'demo')

    const sessionResponse = await fetch(`${baseUrl}/api/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ player: 'QA' }),
    })
    assert.equal(sessionResponse.status, 200)
    const { session } = await sessionResponse.json()
    assert.equal(session.balance, 1000)

    const spinResponse = await fetch(`${baseUrl}/api/spin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Demo-Session': session.id,
      },
      body: JSON.stringify({ gameId: 'golden-vault', bet: 1 }),
    })
    assert.equal(spinResponse.status, 200)
    const { result } = await spinResponse.json()
    assert.equal(result.totalWin, 50)
    assert.equal(result.balance, 1049)
  } finally {
    await close(server)
  }
})

test('HTTP API requires a valid demo session for spins', async () => {
  const server = createTestServer()
  const baseUrl = await listen(server)

  try {
    const response = await fetch(`${baseUrl}/api/spin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId: 'golden-vault', bet: 1 }),
    })
    assert.equal(response.status, 401)
    const payload = await response.json()
    assert.equal(payload.error.code, 'SESSION_REQUIRED')
  } finally {
    await close(server)
  }
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { SessionStore } from '../server/sessionStore.js'
import { SlidingWindowRateLimiter } from '../server/rateLimiter.js'
import { AuditLog } from '../server/auditLog.js'
import { CasinoService } from '../server/casinoService.js'
import { createHttpServer } from '../server/httpServer.js'
import { requireAccountCapability } from '../server/authorization.js'

function fakeAuthService() {
  const accounts = new Map([
    ['player-token', { id: 'player-1', roles: ['player'], status: 'active' }],
    ['support-token', { id: 'support-1', roles: ['support'], status: 'active' }],
    ['finance-token', { id: 'finance-1', roles: ['finance'], status: 'active' }],
    ['admin-token', { id: 'admin-1', roles: ['admin'], status: 'active' }],
  ])

  return {
    async authenticate(token) {
      const account = accounts.get(token)
      return account ? { account, expiresAt: Date.now() + 60_000 } : null
    },
    async profile(token) {
      const authenticated = await this.authenticate(token)
      return authenticated ? { ...authenticated, wallet: { balance: 1000 } } : null
    },
    async logout() {
      return true
    },
  }
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

test('central capability guard is deny-by-default and admin wildcard remains explicit', () => {
  assert.equal(
    requireAccountCapability({ id: 'player-1', roles: ['player'] }, 'casino.play').id,
    'player-1',
  )
  assert.equal(
    requireAccountCapability({ id: 'admin-1', roles: ['admin'] }, 'future.sensitive.write').id,
    'admin-1',
  )
  assert.throws(
    () => requireAccountCapability({ id: 'finance-1', roles: ['finance'] }, 'casino.play'),
    (error) => error.status === 403 && error.code === 'CAPABILITY_REQUIRED',
  )
  assert.throws(
    () => requireAccountCapability({ id: 'unknown-1', roles: ['unknown'] }, 'wallet.read'),
    (error) => error.status === 403 && error.code === 'CAPABILITY_REQUIRED',
  )
})

test('authenticated routes enforce capabilities and audit denied attempts with request correlation', async () => {
  const auditLog = new AuditLog({ sink: () => {} })
  const service = new CasinoService({
    sessionStore: new SessionStore({ startingBalance: 1000 }),
    rateLimiter: new SlidingWindowRateLimiter({ limit: 20, windowMs: 10_000 }),
    auditLog,
    rng: () => 0,
    authService: fakeAuthService(),
  })
  const server = createHttpServer({
    service,
    authService: service.authService,
    auditLog,
    config: { maxBodyBytes: 16_384, metricsToken: '' },
    staticDir: '/tmp/gmvkasino-no-static',
    log: () => {},
  })
  const baseUrl = await listen(server)

  try {
    const sessionResponse = await fetch(`${baseUrl}/api/v1/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ player: 'Capability QA' }),
    })
    const { session } = await sessionResponse.json()

    const deniedRequestId = 'cap-denied-request-001'
    const deniedSpin = await fetch(`${baseUrl}/api/v1/spin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer finance-token',
        'X-Demo-Session': session.id,
        'X-Request-Id': deniedRequestId,
      },
      body: JSON.stringify({
        gameId: 'golden-vault',
        bet: 1,
        idempotencyKey: 'cap-finance-spin-01',
      }),
    })
    assert.equal(deniedSpin.status, 403)
    const deniedPayload = await deniedSpin.json()
    assert.equal(deniedPayload.error.code, 'CAPABILITY_REQUIRED')
    assert.equal(deniedPayload.error.details.capability, 'casino.play')

    const denialEvent = auditLog.recent().find((event) => event.type === 'authorization.denied')
    assert.ok(denialEvent)
    assert.equal(denialEvent.requestId, deniedRequestId)
    assert.equal(denialEvent.accountId, 'finance-1')
    assert.equal(denialEvent.capability, 'casino.play')
    assert.deepEqual(denialEvent.roles, ['finance'])

    const playerSpin = await fetch(`${baseUrl}/api/v1/spin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer player-token',
        'X-Demo-Session': session.id,
      },
      body: JSON.stringify({
        gameId: 'golden-vault',
        bet: 1,
        idempotencyKey: 'cap-player-spin-01',
      }),
    })
    assert.equal(playerSpin.status, 200)

    const supportProfile = await fetch(`${baseUrl}/api/v1/auth/me`, {
      headers: { Authorization: 'Bearer support-token' },
    })
    assert.equal(supportProfile.status, 200)

    const financeProfile = await fetch(`${baseUrl}/api/v1/auth/me`, {
      headers: { Authorization: 'Bearer finance-token' },
    })
    assert.equal(financeProfile.status, 403)
    assert.equal((await financeProfile.json()).error.details.capability, 'profile.read')

    const adminWallet = await fetch(`${baseUrl}/api/v1/wallet`, {
      headers: {
        Authorization: 'Bearer admin-token',
        'X-Demo-Session': session.id,
      },
    })
    assert.equal(adminWallet.status, 200)
  } finally {
    await close(server)
  }
})

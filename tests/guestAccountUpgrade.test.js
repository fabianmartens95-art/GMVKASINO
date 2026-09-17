import { randomUUID } from 'node:crypto'
import test from 'node:test'
import assert from 'node:assert/strict'
import pg from 'pg'
import { runMigrations } from '../server/migrations.js'
import { PostgresSessionStore } from '../server/postgresSessionStore.js'
import { AccountAuthService } from '../server/accountAuthService.js'
import { SlidingWindowRateLimiter } from '../server/rateLimiter.js'
import { AuditLog } from '../server/auditLog.js'
import { OperationalMetrics } from '../server/operationalMetrics.js'
import { CasinoService } from '../server/casinoService.js'
import { createHttpServer } from '../server/httpServer.js'

const { Pool } = pg
const databaseUrl = process.env.TEST_DATABASE_URL || ''

function integrationTest(name, fn) {
  test(name, { skip: !databaseUrl }, fn)
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

integrationTest('guest registration upgrades the existing account without re-crediting the wallet', async () => {
  const pool = new Pool({ connectionString: databaseUrl })
  let server

  try {
    await runMigrations({ pool })
    const metrics = new OperationalMetrics()
    const sessionStore = new PostgresSessionStore({ pool, startingBalance: 1000, metrics })
    await sessionStore.init()
    const authService = new AccountAuthService({
      pool,
      ledger: sessionStore.ledger,
      startingBalance: 1000,
    })
    const authRateLimiter = new SlidingWindowRateLimiter({ limit: 10, windowMs: 60_000 })
    const service = new CasinoService({
      sessionStore,
      rateLimiter: new SlidingWindowRateLimiter({ limit: 10, windowMs: 10_000 }),
      auditLog: new AuditLog({ sink: () => {} }),
      metrics,
      rng: () => 0,
      authService,
      authRateLimiter,
    })

    server = createHttpServer({
      service,
      authService,
      authRateLimiter,
      metrics,
      config: { maxBodyBytes: 16_384, metricsToken: '' },
      staticDir: '/tmp/gmvkasino-no-static',
      log: () => {},
    })
    const baseUrl = await listen(server)

    const guestResponse = await fetch(`${baseUrl}/api/v1/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ player: 'Guest Upgrade QA' }),
    })
    assert.equal(guestResponse.status, 200)
    const { session: guest } = await guestResponse.json()
    assert.equal(guest.authRequired, false)

    const guestSpinResponse = await fetch(`${baseUrl}/api/v1/spin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Demo-Session': guest.id,
      },
      body: JSON.stringify({ gameId: 'golden-vault', bet: 1, idempotencyKey: 'guest-upgrade-spin-01' }),
    })
    assert.equal(guestSpinResponse.status, 200)
    assert.equal((await guestSpinResponse.json()).result.balance, 1049)

    const walletBefore = await sessionStore.getWallet(guest.id)
    const initialCreditsBefore = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM ledger_transactions
       WHERE type = 'INITIAL_CREDIT'
         AND reference_type = 'account'
         AND reference_id = $1`,
      [guest.accountId],
    )
    assert.equal(initialCreditsBefore.rows[0].count, 1)

    const registerResponse = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Demo-Session': guest.id,
      },
      body: JSON.stringify({
        email: `guest-upgrade-${randomUUID()}@example.com`,
        password: 'correct-horse-demo-42',
        displayName: 'Registered Guest',
      }),
    })
    assert.equal(registerResponse.status, 201)
    const upgraded = await registerResponse.json()

    assert.equal(upgraded.upgraded, true)
    assert.equal(upgraded.account.id, guest.accountId)
    assert.equal(upgraded.session.id, guest.id)
    assert.equal(upgraded.session.accountId, guest.accountId)
    assert.equal(upgraded.session.authRequired, true)
    assert.equal(upgraded.wallet.id, walletBefore.id)
    assert.equal(upgraded.wallet.balance, 1049)

    const initialCreditsAfter = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM ledger_transactions
       WHERE type = 'INITIAL_CREDIT'
         AND reference_type = 'account'
         AND reference_id = $1`,
      [guest.accountId],
    )
    assert.equal(initialCreditsAfter.rows[0].count, 1)

    const withoutAuth = await fetch(`${baseUrl}/api/v1/session`, {
      headers: { 'X-Demo-Session': guest.id },
    })
    assert.equal(withoutAuth.status, 401)

    const withAuth = await fetch(`${baseUrl}/api/v1/session`, {
      headers: {
        Authorization: `Bearer ${upgraded.auth.token}`,
        'X-Demo-Session': guest.id,
      },
    })
    assert.equal(withAuth.status, 200)
    const protectedSession = (await withAuth.json()).session
    assert.equal(protectedSession.id, guest.id)
    assert.equal(protectedSession.balance, 1049)
    assert.equal(protectedSession.player, 'Registered Guest')

    const continuedSpin = await fetch(`${baseUrl}/api/v1/spin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${upgraded.auth.token}`,
        'X-Demo-Session': guest.id,
      },
      body: JSON.stringify({ gameId: 'golden-vault', bet: 1, idempotencyKey: 'guest-upgrade-spin-02' }),
    })
    assert.equal(continuedSpin.status, 200)
    assert.equal((await continuedSpin.json()).result.balance, 1098)
  } finally {
    if (server?.listening) await close(server)
    await pool.end()
  }
})

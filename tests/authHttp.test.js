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

async function resetAuthData(pool) {
  await pool.query('DELETE FROM auth_sessions')
  await pool.query('DELETE FROM demo_sessions')
  await pool.query('DELETE FROM ledger_entries')
  await pool.query('DELETE FROM ledger_transactions')
  await pool.query('DELETE FROM ledger_accounts WHERE account_id IS NOT NULL')
  await pool.query('DELETE FROM accounts')
  await pool.query('UPDATE ledger_accounts SET balance_atomic = 0 WHERE system_key IS NOT NULL')
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

integrationTest('auth HTTP flow binds gameplay to the registered account and rejects missing or mismatched auth', async () => {
  const pool = new Pool({ connectionString: databaseUrl })
  let server

  try {
    await runMigrations({ pool })
    await resetAuthData(pool)

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

    const registerResponse = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'auth-http@example.com',
        password: 'correct-horse-demo-42',
        displayName: 'Auth HTTP',
      }),
    })
    assert.equal(registerResponse.status, 201)
    const registered = await registerResponse.json()
    assert.equal(registered.account.email, 'auth-http@example.com')
    assert.equal(registered.wallet.balance, 1000)
    assert.equal(registered.session.accountId, registered.account.id)
    assert.equal(registered.session.authRequired, true)

    const unauthenticatedSpin = await fetch(`${baseUrl}/api/v1/spin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Demo-Session': registered.session.id,
      },
      body: JSON.stringify({ gameId: 'golden-vault', bet: 1 }),
    })
    assert.equal(unauthenticatedSpin.status, 401)
    assert.equal((await unauthenticatedSpin.json()).error.code, 'SESSION_REQUIRED')

    const secondRegisterResponse = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'other-account@example.com',
        password: 'another-correct-demo-password',
        displayName: 'Other Account',
      }),
    })
    assert.equal(secondRegisterResponse.status, 201)
    const secondAccount = await secondRegisterResponse.json()

    const mismatchedSpin = await fetch(`${baseUrl}/api/v1/spin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${secondAccount.auth.token}`,
        'X-Demo-Session': registered.session.id,
      },
      body: JSON.stringify({ gameId: 'golden-vault', bet: 1 }),
    })
    assert.equal(mismatchedSpin.status, 401)
    assert.equal((await mismatchedSpin.json()).error.code, 'SESSION_REQUIRED')

    const authenticatedSpin = await fetch(`${baseUrl}/api/v1/spin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${registered.auth.token}`,
        'X-Demo-Session': registered.session.id,
      },
      body: JSON.stringify({ gameId: 'golden-vault', bet: 1 }),
    })
    assert.equal(authenticatedSpin.status, 200)
    const spin = await authenticatedSpin.json()
    assert.equal(spin.result.balance, 1049)

    const meResponse = await fetch(`${baseUrl}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${registered.auth.token}` },
    })
    assert.equal(meResponse.status, 200)
    const me = await meResponse.json()
    assert.equal(me.profile.account.id, registered.account.id)
    assert.equal(me.profile.wallet.balance, 1049)

    const logoutResponse = await fetch(`${baseUrl}/api/v1/auth/logout`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${registered.auth.token}`,
        'X-Demo-Session': registered.session.id,
      },
    })
    assert.equal(logoutResponse.status, 200)

    const expiredAuthResponse = await fetch(`${baseUrl}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${registered.auth.token}` },
    })
    assert.equal(expiredAuthResponse.status, 401)

    const loginResponse = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'AUTH-HTTP@example.com',
        password: 'correct-horse-demo-42',
      }),
    })
    assert.equal(loginResponse.status, 200)
    const loggedIn = await loginResponse.json()
    assert.equal(loggedIn.account.id, registered.account.id)
    assert.equal(loggedIn.wallet.balance, 1049)
    assert.notEqual(loggedIn.auth.token, registered.auth.token)
    assert.notEqual(loggedIn.session.id, registered.session.id)
    assert.equal(loggedIn.session.accountId, registered.account.id)
  } finally {
    if (server?.listening) await close(server)
    await resetAuthData(pool).catch(() => {})
    await pool.end()
  }
})

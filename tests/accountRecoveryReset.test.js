import test from 'node:test'
import assert from 'node:assert/strict'
import pg from 'pg'
import { runMigrations } from '../server/migrations.js'
import { AccountAuthService } from '../server/accountAuthService.js'
import { AccountRecoveryService } from '../server/accountRecoveryService.js'

const { Pool } = pg
const databaseUrl = process.env.TEST_DATABASE_URL || ''

function integrationTest(name, fn) {
  test(name, { skip: !databaseUrl }, fn)
}

async function cleanup(pool) {
  await pool.query('DELETE FROM account_recovery_tokens').catch(() => {})
  await pool.query('DELETE FROM auth_sessions').catch(() => {})
  await pool.query('DELETE FROM demo_sessions').catch(() => {})
  await pool.query('DELETE FROM ledger_entries').catch(() => {})
  await pool.query('DELETE FROM ledger_transactions').catch(() => {})
  await pool.query('DELETE FROM ledger_accounts WHERE account_id IS NOT NULL').catch(() => {})
  await pool.query('DELETE FROM accounts').catch(() => {})
  await pool.query('UPDATE ledger_accounts SET balance_atomic = 0 WHERE system_key IS NOT NULL').catch(() => {})
}

integrationTest('recovery reset atomically changes password, consumes token and revokes existing auth sessions', async () => {
  const pool = new Pool({ connectionString: databaseUrl })
  let now = 100_000

  try {
    await runMigrations({ pool })
    await cleanup(pool)

    const auth = new AccountAuthService({ pool, startingBalance: 1000, now: () => now })
    const recovery = new AccountRecoveryService({ pool, now: () => now, ttlMs: 60_000 })

    const registered = await auth.register({
      email: 'reset@example.com',
      password: 'old-password-demo-123',
      displayName: 'Reset QA',
    })
    const secondLogin = await auth.login({
      email: 'reset@example.com',
      password: 'old-password-demo-123',
    })
    assert.ok(await auth.profile(registered.auth.token))
    assert.ok(await auth.profile(secondLogin.auth.token))

    const issued = await recovery.issueForAccount({ accountId: registered.account.id })
    now += 1000

    const result = await auth.resetPasswordWithRecovery({
      recoveryService: recovery,
      token: issued.token,
      password: 'new-password-demo-456',
    })

    assert.equal(result.account.id, registered.account.id)
    assert.ok(result.sessionsRevoked >= 2)
    assert.equal(await auth.profile(registered.auth.token), null)
    assert.equal(await auth.profile(secondLogin.auth.token), null)

    await assert.rejects(
      auth.login({ email: 'reset@example.com', password: 'old-password-demo-123' }),
      (error) => error.code === 'INVALID_CREDENTIALS',
    )

    const newLogin = await auth.login({
      email: 'reset@example.com',
      password: 'new-password-demo-456',
    })
    assert.equal(newLogin.account.id, registered.account.id)

    await assert.rejects(
      auth.resetPasswordWithRecovery({
        recoveryService: recovery,
        token: issued.token,
        password: 'another-password-demo-789',
      }),
      (error) => error.code === 'RECOVERY_TOKEN_UNAVAILABLE',
    )
  } finally {
    await cleanup(pool)
    await pool.end()
  }
})

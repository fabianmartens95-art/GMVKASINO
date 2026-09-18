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

integrationTest('recovery tokens are hashed, single-use and invalidate older active tokens', async () => {
  const pool = new Pool({ connectionString: databaseUrl })
  let now = 10_000

  try {
    await runMigrations({ pool })
    await cleanup(pool)

    const auth = new AccountAuthService({ pool, startingBalance: 1000, now: () => now })
    const registered = await auth.register({
      email: 'recovery@example.com',
      password: 'recovery-demo-password-123',
    })
    const recovery = new AccountRecoveryService({
      pool,
      now: () => now,
      ttlMs: 60_000,
    })

    const first = await recovery.issueForAccount({
      accountId: registered.account.id,
      requestId: 'recovery-request-001',
    })
    assert.ok(first.token.length >= 40)

    const storedFirst = await pool.query(
      `SELECT token_hash, invalidated_at
       FROM account_recovery_tokens
       WHERE id = $1`,
      [first.id],
    )
    assert.equal(storedFirst.rows[0].token_hash.length, 64)
    assert.notEqual(storedFirst.rows[0].token_hash, first.token)
    assert.equal(storedFirst.rows[0].invalidated_at, null)

    now += 1_000
    const second = await recovery.issueForAccount({ accountId: registered.account.id })

    const invalidated = await pool.query(
      'SELECT invalidated_at FROM account_recovery_tokens WHERE id = $1',
      [first.id],
    )
    assert.equal(Number(invalidated.rows[0].invalidated_at), now)

    await assert.rejects(
      recovery.consume({ token: first.token }),
      (error) => error.code === 'RECOVERY_TOKEN_UNAVAILABLE' && error.status === 410,
    )

    const consumed = await recovery.consume({ token: second.token })
    assert.equal(consumed.accountId, registered.account.id)
    assert.equal(consumed.consumedAt, now)

    await assert.rejects(
      recovery.consume({ token: second.token }),
      (error) => error.code === 'RECOVERY_TOKEN_UNAVAILABLE',
    )
  } finally {
    await cleanup(pool)
    await pool.end()
  }
})

integrationTest('expired or disabled-account recovery tokens fail closed', async () => {
  const pool = new Pool({ connectionString: databaseUrl })
  let now = 20_000

  try {
    await runMigrations({ pool })
    await cleanup(pool)

    const auth = new AccountAuthService({ pool, startingBalance: 1000, now: () => now })
    const registered = await auth.register({
      email: 'expiry@example.com',
      password: 'expiry-demo-password-123',
    })
    const recovery = new AccountRecoveryService({
      pool,
      now: () => now,
      ttlMs: 60_000,
    })

    const issued = await recovery.issueForAccount({ accountId: registered.account.id })
    now += 60_001

    await assert.rejects(
      recovery.consume({ token: issued.token }),
      (error) => error.code === 'RECOVERY_TOKEN_UNAVAILABLE',
    )

    now += 1
    const replacement = await recovery.issueForAccount({ accountId: registered.account.id })
    await pool.query("UPDATE accounts SET status = 'disabled' WHERE id = $1", [registered.account.id])

    await assert.rejects(
      recovery.consume({ token: replacement.token }),
      (error) => error.code === 'RECOVERY_TOKEN_UNAVAILABLE',
    )
  } finally {
    await cleanup(pool)
    await pool.end()
  }
})

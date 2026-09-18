import test from 'node:test'
import assert from 'node:assert/strict'
import pg from 'pg'
import { runMigrations } from '../server/migrations.js'
import { AccountAuthService } from '../server/accountAuthService.js'

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

integrationTest('account registration hashes credentials and auth tokens while preserving a persistent DEMO wallet', async () => {
  const pool = new Pool({ connectionString: databaseUrl })

  try {
    await runMigrations({ pool })
    await resetAuthData(pool)
    const auth = new AccountAuthService({ pool, startingBalance: 1000 })

    const registered = await auth.register({
      email: 'Player.One@Example.COM',
      password: 'correct-horse-demo-42',
      displayName: 'Player One',
    })

    assert.equal(registered.account.email, 'player.one@example.com')
    assert.equal(registered.account.displayName, 'Player One')
    assert.deepEqual(registered.account.roles, ['player'])
    assert.equal(registered.account.emailVerified, false)
    assert.equal(registered.account.mfaEnrolled, false)
    assert.equal(registered.wallet.balance, 1000)
    assert.equal(registered.wallet.accountId, registered.account.id)
    assert.ok(registered.auth.token.length >= 40)
    assert.deepEqual(registered.auth.assurance, { level: 'base', verifiedAt: null })

    const storedAccount = await pool.query(
      `SELECT password_scheme, password_salt, password_hash
       FROM accounts WHERE id = $1`,
      [registered.account.id],
    )
    assert.equal(storedAccount.rows[0].password_scheme, 'scrypt-v1')
    assert.ok(Buffer.isBuffer(storedAccount.rows[0].password_salt))
    assert.ok(Buffer.isBuffer(storedAccount.rows[0].password_hash))
    assert.equal(storedAccount.rows[0].password_hash.toString('utf8').includes('correct-horse-demo-42'), false)

    const storedSession = await pool.query(
      'SELECT token_hash FROM auth_sessions WHERE account_id = $1',
      [registered.account.id],
    )
    assert.equal(storedSession.rows[0].token_hash.length, 64)
    assert.notEqual(storedSession.rows[0].token_hash, registered.auth.token)

    const profile = await auth.profile(registered.auth.token)
    assert.equal(profile.account.id, registered.account.id)
    assert.deepEqual(profile.account.roles, ['player'])
    assert.equal(profile.wallet.balance, 1000)
    assert.deepEqual(profile.assurance, { level: 'base', verifiedAt: null })

    await assert.rejects(
      auth.login({ email: 'player.one@example.com', password: 'definitely-wrong-password' }),
      (error) => error.code === 'INVALID_CREDENTIALS' && error.status === 401,
    )

    const loggedIn = await auth.login({
      email: 'PLAYER.ONE@example.com',
      password: 'correct-horse-demo-42',
    })
    assert.equal(loggedIn.account.id, registered.account.id)
    assert.deepEqual(loggedIn.account.roles, ['player'])
    assert.equal(loggedIn.wallet.id, registered.wallet.id)
    assert.notEqual(loggedIn.auth.token, registered.auth.token)
    assert.deepEqual(loggedIn.auth.assurance, { level: 'base', verifiedAt: null })

    await assert.rejects(
      auth.register({
        email: 'player.one@example.com',
        password: 'another-secure-demo-password',
      }),
      (error) => error.code === 'EMAIL_ALREADY_REGISTERED' && error.status === 409,
    )

    assert.equal(await auth.logout(loggedIn.auth.token), true)
    assert.equal(await auth.profile(loggedIn.auth.token), null)
  } finally {
    await resetAuthData(pool).catch(() => {})
    await pool.end()
  }
})

integrationTest('auth session activity extends idle expiry but never extends absolute expiry', async () => {
  const pool = new Pool({ connectionString: databaseUrl })
  let now = 1_000

  try {
    await runMigrations({ pool })
    await resetAuthData(pool)
    const auth = new AccountAuthService({
      pool,
      startingBalance: 1000,
      idleTtlMs: 100,
      absoluteTtlMs: 150,
      now: () => now,
    })

    const registered = await auth.register({
      email: 'ttl@example.com',
      password: 'long-enough-demo-password',
    })

    now = 1_050
    assert.equal((await auth.authenticate(registered.auth.token))?.account.id, registered.account.id)

    now = 1_120
    assert.equal((await auth.authenticate(registered.auth.token))?.account.id, registered.account.id)

    now = 1_151
    assert.equal(await auth.authenticate(registered.auth.token), null)
    assert.equal(await auth.pruneExpired(), 1)
  } finally {
    await resetAuthData(pool).catch(() => {})
    await pool.end()
  }
})

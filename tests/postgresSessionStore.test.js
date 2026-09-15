import test from 'node:test'
import assert from 'node:assert/strict'
import pg from 'pg'
import { PostgresSessionStore } from '../server/postgresSessionStore.js'

const { Pool } = pg
const databaseUrl = process.env.TEST_DATABASE_URL || ''

function integrationTest(name, fn) {
  test(name, { skip: !databaseUrl }, fn)
}

integrationTest('PostgreSQL sessions create accounts and settle through a balanced DEMO ledger', async () => {
  const pool = new Pool({ connectionString: databaseUrl })
  const store = new PostgresSessionStore({ pool, startingBalance: 1000 })

  try {
    await store.init()
    await pool.query('TRUNCATE TABLE demo_sessions')

    const session = await store.create({ player: 'DB QA' })
    assert.ok(session.accountId)
    assert.equal(session.wallet.asset.code, 'DEMO')
    assert.equal(session.wallet.balanceAtomic, '100000')

    const settled = await store.applySpin(session.id, {
      bet: 25,
      payout: 7,
      spinId: 'qa-ledger-spin-1',
      gameId: 'golden-vault',
    })
    const restored = await store.get(session.id)
    const wallet = await store.getWallet(session.id)

    assert.equal(settled.balance, 982)
    assert.equal(settled.spins, 1)
    assert.equal(restored.player, 'DB QA')
    assert.equal(restored.balance, 982)
    assert.equal(wallet.balanceAtomic, '98200')
    assert.equal(wallet.balanceExact, '982.00')

    const transaction = await pool.query(
      `SELECT id FROM ledger_transactions
       WHERE reference_type = 'spin' AND reference_id = $1`,
      ['qa-ledger-spin-1'],
    )
    assert.equal(transaction.rows.length, 1)

    const entries = await pool.query(
      `SELECT amount_atomic
       FROM ledger_entries
       WHERE transaction_id = $1`,
      [transaction.rows[0].id],
    )
    assert.equal(entries.rows.length, 4)
    const sum = entries.rows.reduce((total, row) => total + BigInt(row.amount_atomic), 0n)
    assert.equal(sum, 0n)
  } finally {
    await pool.query('TRUNCATE TABLE demo_sessions').catch(() => {})
    await pool.end()
  }
})

integrationTest('PostgreSQL conditional ledger settlement prevents concurrent overspend', async () => {
  const pool = new Pool({ connectionString: databaseUrl })
  const store = new PostgresSessionStore({ pool, startingBalance: 1 })

  try {
    await store.init()
    await pool.query('TRUNCATE TABLE demo_sessions')
    const session = await store.create()

    const settlements = await Promise.all([
      store.applySpin(session.id, {
        bet: 1,
        payout: 0,
        spinId: 'qa-concurrent-spin-a',
        gameId: 'golden-vault',
      }),
      store.applySpin(session.id, {
        bet: 1,
        payout: 0,
        spinId: 'qa-concurrent-spin-b',
        gameId: 'golden-vault',
      }),
    ])

    assert.equal(settlements.filter(Boolean).length, 1)
    const final = await store.get(session.id)
    assert.equal(final.balance, 0)
    assert.equal(final.wallet.balanceAtomic, '0')
    assert.equal(final.spins, 1)

    const ledgerSpins = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM ledger_transactions
       WHERE reference_id IN ('qa-concurrent-spin-a', 'qa-concurrent-spin-b')`,
    )
    assert.equal(ledgerSpins.rows[0].count, 1)
  } finally {
    await pool.query('TRUNCATE TABLE demo_sessions').catch(() => {})
    await pool.end()
  }
})

integrationTest('PostgreSQL rotation keeps account identity and invalidation preserves ledger history', async () => {
  const pool = new Pool({ connectionString: databaseUrl })
  const store = new PostgresSessionStore({ pool, startingBalance: 1000 })

  try {
    await store.init()
    await pool.query('TRUNCATE TABLE demo_sessions')
    const session = await store.create({ player: 'Rotate DB QA' })
    await store.applySpin(session.id, {
      bet: 10,
      payout: 4,
      spinId: 'qa-rotate-spin',
      gameId: 'golden-vault',
    })

    const rotated = await store.rotate(session.id)
    assert.notEqual(rotated.id, session.id)
    assert.equal(rotated.accountId, session.accountId)
    assert.equal(rotated.balance, 994)
    assert.equal(rotated.createdAt, session.createdAt)
    assert.equal(await store.get(session.id), null)
    assert.equal((await store.get(rotated.id)).balance, 994)

    assert.equal(await store.invalidate(rotated.id), true)
    assert.equal(await store.invalidate(rotated.id), false)
    assert.equal(await store.get(rotated.id), null)

    const account = await pool.query('SELECT id, status FROM accounts WHERE id = $1', [session.accountId])
    assert.equal(account.rows[0].id, session.accountId)
    assert.equal(account.rows[0].status, 'active')

    const wallet = await pool.query(
      `SELECT balance_atomic
       FROM ledger_accounts
       WHERE account_id = $1 AND asset_code = 'DEMO' AND purpose = 'available'`,
      [session.accountId],
    )
    assert.equal(wallet.rows[0].balance_atomic, '99400')
  } finally {
    await pool.query('TRUNCATE TABLE demo_sessions').catch(() => {})
    await pool.end()
  }
})

integrationTest('PostgreSQL ledger rejects unbalanced transactions at commit', async () => {
  const pool = new Pool({ connectionString: databaseUrl })
  const store = new PostgresSessionStore({ pool, startingBalance: 1000 })
  const client = await pool.connect()

  try {
    await store.init()
    await pool.query('TRUNCATE TABLE demo_sessions')
    const session = await store.create({ player: 'Balance Guard QA' })
    const wallet = await store.getWallet(session.id)

    await client.query('BEGIN')
    await client.query(
      `INSERT INTO ledger_transactions (
         id, asset_code, type, reference_type, reference_id, idempotency_key, created_at
       ) VALUES ('qa-unbalanced-tx', 'DEMO', 'QA_INVALID', 'qa', 'unbalanced', 'qa-unbalanced', 1)`,
    )
    await client.query(
      `INSERT INTO ledger_entries (transaction_id, ledger_account_id, amount_atomic, created_at)
       VALUES ('qa-unbalanced-tx', $1, 100, 1)`,
      [wallet.id],
    )

    await assert.rejects(
      () => client.query('COMMIT'),
      /not balanced/,
    )
    await client.query('ROLLBACK').catch(() => {})
  } finally {
    client.release()
    await pool.query('TRUNCATE TABLE demo_sessions').catch(() => {})
    await pool.end()
  }
})

integrationTest('PostgreSQL activity extends idle expiry but not absolute expiry', async () => {
  const pool = new Pool({ connectionString: databaseUrl })
  let now = 1_000
  const store = new PostgresSessionStore({
    pool,
    idleTtlMs: 100,
    absoluteTtlMs: 150,
    now: () => now,
  })

  try {
    await store.init()
    await pool.query('TRUNCATE TABLE demo_sessions')
    const session = await store.create()

    now = 1_050
    assert.equal((await store.get(session.id))?.id, session.id)

    now = 1_120
    assert.equal((await store.get(session.id))?.id, session.id)

    now = 1_151
    assert.equal(await store.get(session.id), null)
  } finally {
    await pool.query('TRUNCATE TABLE demo_sessions').catch(() => {})
    await pool.end()
  }
})

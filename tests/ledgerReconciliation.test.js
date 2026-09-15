import test from 'node:test'
import assert from 'node:assert/strict'
import pg from 'pg'
import { runMigrations } from '../server/migrations.js'
import { PostgresSessionStore } from '../server/postgresSessionStore.js'
import { LedgerReconciler } from '../server/ledgerReconciliation.js'

const { Pool } = pg
const databaseUrl = process.env.TEST_DATABASE_URL || ''

function integrationTest(name, fn) {
  test(name, { skip: !databaseUrl }, fn)
}

integrationTest('ledger reconciliation reports a healthy balanced DEMO ledger without mutating it', async () => {
  const pool = new Pool({ connectionString: databaseUrl })

  try {
    await runMigrations({ pool })
    const store = new PostgresSessionStore({ pool, startingBalance: 1000 })
    await store.init()
    const session = await store.create({ player: 'Reconcile QA' })
    await store.applySpin(session.id, {
      bet: 5,
      payout: 12,
      spinId: `reconcile-${session.id}`,
      gameId: 'golden-vault',
    })

    const before = await pool.query(
      `SELECT id, balance_atomic::text AS balance_atomic
       FROM ledger_accounts
       ORDER BY id`,
    )

    const report = await new LedgerReconciler({ pool, now: () => 1_700_000_000_000 })
      .reconcile({ assetCode: 'demo' })

    const after = await pool.query(
      `SELECT id, balance_atomic::text AS balance_atomic
       FROM ledger_accounts
       ORDER BY id`,
    )

    assert.equal(report.ok, true)
    assert.equal(report.assetCode, 'DEMO')
    assert.equal(report.accountMismatches.length, 0)
    assert.equal(report.transactionMismatches.length, 0)
    assert.equal(report.assetMismatches.length, 0)
    assert.ok(report.accountsChecked >= 3)
    assert.ok(report.transactionsChecked >= 2)
    assert.deepEqual(after.rows, before.rows)
  } finally {
    await pool.end()
  }
})

integrationTest('ledger reconciliation detects cached wallet drift and reports the exact atomic delta', async () => {
  const pool = new Pool({ connectionString: databaseUrl })
  let walletId

  try {
    await runMigrations({ pool })
    const store = new PostgresSessionStore({ pool, startingBalance: 1000 })
    await store.init()
    const session = await store.create({ player: 'Drift QA' })
    walletId = session.wallet.id

    await pool.query(
      'UPDATE ledger_accounts SET balance_atomic = balance_atomic + 1 WHERE id = $1',
      [walletId],
    )

    const report = await new LedgerReconciler({ pool }).reconcile({ assetCode: 'DEMO' })
    const mismatch = report.accountMismatches.find((entry) => entry.ledgerAccountId === walletId)

    assert.equal(report.ok, false)
    assert.ok(mismatch)
    assert.equal(mismatch.deltaAtomic, '1')
    assert.equal(report.assetMismatches.some((entry) => entry.assetCode === 'DEMO'), true)
  } finally {
    if (walletId) {
      await pool.query(
        'UPDATE ledger_accounts SET balance_atomic = balance_atomic - 1 WHERE id = $1',
        [walletId],
      ).catch(() => {})
    }
    await pool.end()
  }
})

import test from 'node:test'
import assert from 'node:assert/strict'
import pg from 'pg'
import { AuditLog } from '../server/auditLog.js'
import { PaymentReconciler } from '../server/paymentReconciliation.js'
import { PostgresSessionStore } from '../server/postgresSessionStore.js'
import { SandboxPaymentService } from '../server/sandboxPaymentService.js'

const { Pool } = pg
const databaseUrl = process.env.TEST_DATABASE_URL || ''

function integrationTest(name, fn) {
  test(name, { skip: !databaseUrl }, fn)
}

async function fixture() {
  const pool = new Pool({ connectionString: databaseUrl })
  const store = new PostgresSessionStore({ pool, startingBalance: 1000 })
  await store.init()
  const session = await store.create({ player: `Reconcile QA ${Date.now()}` })
  const service = new SandboxPaymentService({
    pool,
    auditLog: new AuditLog({ sink: () => {} }),
  })
  const reconciler = new PaymentReconciler({ pool })
  return { pool, store, session, service, reconciler }
}

integrationTest('payment reconciliation validates healthy deposit and withdrawal state against ledger postings', async () => {
  const { pool, session, service, reconciler } = await fixture()
  try {
    const deposit = await service.createOperation({
      accountId: session.accountId,
      kind: 'deposit',
      amount: '20.00',
      idempotencyKey: `reconcile-deposit-${session.accountId}`,
    })
    await service.transition({
      operationId: deposit.id,
      action: 'complete',
      eventId: `reconcile-deposit-complete-${deposit.id}`,
      actorAccountId: session.accountId,
    })

    const withdrawal = await service.createOperation({
      accountId: session.accountId,
      kind: 'withdrawal',
      amount: '30.00',
      idempotencyKey: `reconcile-withdrawal-${session.accountId}`,
    })
    await service.transition({
      operationId: withdrawal.id,
      action: 'approve',
      eventId: `reconcile-withdrawal-approve-${withdrawal.id}`,
      actorAccountId: session.accountId,
    })

    const report = await reconciler.reconcile()
    assert.equal(report.ok, true)
    assert.equal(report.summary.mismatchCount, 0)
    assert.ok(report.operationsChecked >= 2)
    assert.ok(report.paymentTransactionsChecked >= 2)
    assert.equal(report.reserveMismatches.length, 0)

    const summary = await reconciler.sanitizedSummary()
    assert.equal(summary.ok, true)
    assert.equal(summary.mismatchCount, 0)
    assert.equal('accountId' in summary, false)
    assert.equal(JSON.stringify(summary).includes(session.accountId), false)
  } finally {
    await pool.end()
  }
})

integrationTest('payment reconciliation detects a corrupted settlement pointer without repairing data', async () => {
  const { pool, session, service, reconciler } = await fixture()
  try {
    const deposit = await service.createOperation({
      accountId: session.accountId,
      kind: 'deposit',
      amount: '15.00',
      idempotencyKey: `corrupt-pointer-${session.accountId}`,
    })
    const completed = await service.transition({
      operationId: deposit.id,
      action: 'complete',
      eventId: `corrupt-pointer-complete-${deposit.id}`,
      actorAccountId: session.accountId,
    })
    const correctTransactionId = completed.settlementTransactionId

    await pool.query(
      `UPDATE payment_operations
       SET settlement_transaction_id = NULL
       WHERE id = $1`,
      [deposit.id],
    )

    const broken = await reconciler.reconcile()
    assert.equal(broken.ok, false)
    assert.ok(broken.operationMismatches.some((item) => (
      item.paymentOperationId === deposit.id && item.code === 'settlement_transaction_id_missing'
    )))

    await pool.query(
      `UPDATE payment_operations
       SET settlement_transaction_id = $2
       WHERE id = $1`,
      [deposit.id, correctTransactionId],
    )
    const repaired = await reconciler.reconcile()
    assert.equal(repaired.ok, true)
  } finally {
    await pool.end()
  }
})

integrationTest('payment reconciliation detects reserved-balance drift and exposes only sanitized counts', async () => {
  const { pool, session, service, reconciler } = await fixture()
  try {
    await service.createOperation({
      accountId: session.accountId,
      kind: 'withdrawal',
      amount: '40.00',
      idempotencyKey: `reserve-drift-${session.accountId}`,
    })

    const reserve = await pool.query(
      `SELECT id, balance_atomic::text AS balance_atomic
       FROM ledger_accounts
       WHERE account_id = $1
         AND asset_code = 'DEMO'
         AND purpose = 'withdrawal_reserved'`,
      [session.accountId],
    )
    const reserveId = reserve.rows[0].id
    const correctBalance = reserve.rows[0].balance_atomic

    await pool.query(
      `UPDATE ledger_accounts
       SET balance_atomic = balance_atomic + 100
       WHERE id = $1`,
      [reserveId],
    )

    const broken = await reconciler.reconcile()
    assert.equal(broken.ok, false)
    const mismatch = broken.reserveMismatches.find((item) => item.accountId === session.accountId)
    assert.ok(mismatch)
    assert.equal(mismatch.deltaAtomic, '100')

    const summary = await reconciler.sanitizedSummary()
    assert.equal(summary.ok, false)
    assert.ok(summary.mismatchCount >= 1)
    assert.ok(summary.mismatchCategories.reserves >= 1)
    assert.equal(JSON.stringify(summary).includes(session.accountId), false)

    await pool.query(
      `UPDATE ledger_accounts
       SET balance_atomic = $2::numeric
       WHERE id = $1`,
      [reserveId, correctBalance],
    )
    const repaired = await reconciler.reconcile()
    assert.equal(repaired.ok, true)
  } finally {
    await pool.end()
  }
})

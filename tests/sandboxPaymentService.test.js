import test from 'node:test'
import assert from 'node:assert/strict'
import pg from 'pg'
import { AuditLog } from '../server/auditLog.js'
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
  const session = await store.create({ player: `Payment QA ${Date.now()}` })
  const auditLog = new AuditLog({ sink: () => {} })
  const service = new SandboxPaymentService({ pool, auditLog })
  return { pool, store, session, service, auditLog }
}

integrationTest('sandbox deposit is idempotent and credits the DEMO ledger exactly once', async () => {
  const { pool, store, session, service } = await fixture()
  try {
    const key = `deposit-${session.accountId}`
    const created = await service.createOperation({
      accountId: session.accountId,
      kind: 'deposit',
      amount: '25.50',
      idempotencyKey: key,
      requestId: 'deposit-create-0001',
    })
    assert.equal(created.status, 'pending')
    assert.equal(created.amountExact, '25.50')
    assert.equal(created.sandbox, true)

    const replay = await service.createOperation({
      accountId: session.accountId,
      kind: 'deposit',
      amount: '25.50',
      idempotencyKey: key,
      requestId: 'deposit-create-0002',
    })
    assert.equal(replay.id, created.id)
    assert.equal(replay.replayed, true)

    await assert.rejects(
      service.createOperation({
        accountId: session.accountId,
        kind: 'deposit',
        amount: '30.00',
        idempotencyKey: key,
      }),
      (error) => error.code === 'IDEMPOTENCY_CONFLICT' && error.status === 409,
    )

    const completed = await service.transition({
      operationId: created.id,
      action: 'complete',
      eventId: `deposit-complete-${created.id}`,
      actorAccountId: session.accountId,
      requestId: 'deposit-event-0001',
    })
    assert.equal(completed.status, 'completed')
    assert.ok(completed.settlementTransactionId)

    const eventReplay = await service.transition({
      operationId: created.id,
      action: 'complete',
      eventId: `deposit-complete-${created.id}`,
      actorAccountId: session.accountId,
      requestId: 'deposit-event-0002',
    })
    assert.equal(eventReplay.replayed, true)

    const wallet = await store.ledger.getWallet(pool, session.accountId)
    assert.equal(wallet.balanceExact, '1025.50')

    const postings = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM ledger_transactions
       WHERE type = 'SANDBOX_DEPOSIT' AND reference_id = $1`,
      [created.id],
    )
    assert.equal(postings.rows[0].count, 1)

    const events = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM payment_events
       WHERE payment_operation_id = $1 AND event_type = 'complete'`,
      [created.id],
    )
    assert.equal(events.rows[0].count, 1)
  } finally {
    await pool.end()
  }
})

integrationTest('withdrawal request reserves DEMO credits and rejection releases them exactly once', async () => {
  const { pool, store, session, service } = await fixture()
  try {
    const withdrawal = await service.createOperation({
      accountId: session.accountId,
      kind: 'withdrawal',
      amount: '100.00',
      idempotencyKey: `withdrawal-${session.accountId}`,
      requestId: 'withdrawal-create-0001',
    })
    assert.equal(withdrawal.status, 'reserved')
    assert.ok(withdrawal.reservationTransactionId)

    let wallet = await store.ledger.getWallet(pool, session.accountId)
    assert.equal(wallet.balanceExact, '900.00')

    const reserved = await pool.query(
      `SELECT balance_atomic::text AS balance_atomic
       FROM ledger_accounts
       WHERE account_id = $1 AND asset_code = 'DEMO' AND purpose = 'withdrawal_reserved'`,
      [session.accountId],
    )
    assert.equal(reserved.rows[0].balance_atomic, '10000')

    await assert.rejects(
      service.createOperation({
        accountId: session.accountId,
        kind: 'withdrawal',
        amount: '950.00',
        idempotencyKey: `withdrawal-too-large-${session.accountId}`,
      }),
      (error) => error.code === 'INSUFFICIENT_DEMO_CREDITS' && error.status === 409,
    )

    const rejected = await service.transition({
      operationId: withdrawal.id,
      action: 'reject',
      eventId: `withdrawal-reject-${withdrawal.id}`,
      actorAccountId: session.accountId,
      requestId: 'withdrawal-reject-0001',
    })
    assert.equal(rejected.status, 'rejected')
    assert.ok(rejected.reversalTransactionId)

    const replay = await service.transition({
      operationId: withdrawal.id,
      action: 'reject',
      eventId: `withdrawal-reject-${withdrawal.id}`,
      actorAccountId: session.accountId,
      requestId: 'withdrawal-reject-0002',
    })
    assert.equal(replay.replayed, true)

    wallet = await store.ledger.getWallet(pool, session.accountId)
    assert.equal(wallet.balanceExact, '1000.00')

    const released = await pool.query(
      `SELECT balance_atomic::text AS balance_atomic
       FROM ledger_accounts
       WHERE account_id = $1 AND asset_code = 'DEMO' AND purpose = 'withdrawal_reserved'`,
      [session.accountId],
    )
    assert.equal(released.rows[0].balance_atomic, '0')
  } finally {
    await pool.end()
  }
})

integrationTest('concurrent duplicate withdrawal completion settles reserved value once', async () => {
  const { pool, store, session, service } = await fixture()
  try {
    const withdrawal = await service.createOperation({
      accountId: session.accountId,
      kind: 'withdrawal',
      amount: '75.00',
      idempotencyKey: `withdrawal-concurrent-${session.accountId}`,
    })

    const approved = await service.transition({
      operationId: withdrawal.id,
      action: 'approve',
      eventId: `withdrawal-approve-${withdrawal.id}`,
      actorAccountId: session.accountId,
    })
    assert.equal(approved.status, 'approved')

    const completeEventId = `withdrawal-complete-${withdrawal.id}`
    const [first, second] = await Promise.all([
      service.transition({
        operationId: withdrawal.id,
        action: 'complete',
        eventId: completeEventId,
        actorAccountId: session.accountId,
        requestId: 'withdrawal-complete-a',
      }),
      service.transition({
        operationId: withdrawal.id,
        action: 'complete',
        eventId: completeEventId,
        actorAccountId: session.accountId,
        requestId: 'withdrawal-complete-b',
      }),
    ])

    assert.equal(first.status, 'completed')
    assert.equal(second.status, 'completed')
    assert.equal([first, second].filter((item) => item.replayed).length, 1)

    const wallet = await store.ledger.getWallet(pool, session.accountId)
    assert.equal(wallet.balanceExact, '925.00')

    const reserve = await pool.query(
      `SELECT balance_atomic::text AS balance_atomic
       FROM ledger_accounts
       WHERE account_id = $1 AND asset_code = 'DEMO' AND purpose = 'withdrawal_reserved'`,
      [session.accountId],
    )
    assert.equal(reserve.rows[0].balance_atomic, '0')

    const settlements = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM ledger_transactions
       WHERE type = 'SANDBOX_WITHDRAWAL' AND reference_id = $1`,
      [withdrawal.id],
    )
    assert.equal(settlements.rows[0].count, 1)

    const completeEvents = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM payment_events
       WHERE payment_operation_id = $1 AND event_type = 'complete'`,
      [withdrawal.id],
    )
    assert.equal(completeEvents.rows[0].count, 1)
  } finally {
    await pool.end()
  }
})

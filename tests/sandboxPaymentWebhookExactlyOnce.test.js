import test from 'node:test'
import assert from 'node:assert/strict'
import pg from 'pg'
import { PostgresSessionStore } from '../server/postgresSessionStore.js'
import { SandboxPaymentService } from '../server/sandboxPaymentService.js'
import { PaymentReconciler } from '../server/paymentReconciliation.js'
import { SandboxPaymentProviderAdapter } from '../server/paymentProviderAdapter.js'
import {
  signPaymentWebhookEnvelope,
  verifyPaymentWebhookEnvelope,
} from '../server/paymentWebhookVerifier.js'

const { Pool } = pg
const databaseUrl = process.env.TEST_DATABASE_URL || ''

function integrationTest(name, fn) {
  test(name, { skip: !databaseUrl }, fn)
}

async function availableBalance(pool, accountId) {
  const result = await pool.query(
    `SELECT balance_atomic::text AS balance_atomic
     FROM ledger_accounts
     WHERE account_id = $1
       AND asset_code = 'DEMO'
       AND purpose = 'available'`,
    [accountId],
  )
  return result.rows[0]?.balance_atomic || null
}

function signedDelivery({ secret, timestamp, payload, now }) {
  const rawBody = JSON.stringify(payload)
  const signature = signPaymentWebhookEnvelope({ secret, timestamp, rawBody })
  verifyPaymentWebhookEnvelope({
    secret,
    timestamp,
    rawBody,
    signature,
    now: () => now,
  })
  return JSON.parse(rawBody)
}

integrationTest('replayed signed provider event has exactly one payment and ledger effect', async () => {
  const pool = new Pool({ connectionString: databaseUrl })
  const store = new PostgresSessionStore({ pool, startingBalance: 1000 })
  const secret = 'sandbox-webhook-secret-that-is-at-least-32-bytes'
  const timestamp = '1789689600'
  const now = 1_789_689_600_000

  try {
    await store.init()
    const session = await store.create({ player: `Webhook Replay QA ${Date.now()}` })
    const service = new SandboxPaymentService({ pool, now: () => now })
    const reconciler = new PaymentReconciler({ pool, now: () => now })
    const adapter = new SandboxPaymentProviderAdapter({ provider: 'sandbox' })

    const deposit = await service.createOperation({
      accountId: session.accountId,
      kind: 'deposit',
      amount: '25.00',
      idempotencyKey: `webhook-replay-${session.accountId}`,
      requestId: 'webhook-create-0001',
    })

    const payload = {
      provider: 'sandbox',
      eventId: `complete-${deposit.id}`,
      operationId: deposit.id,
      action: 'complete',
      reference: 'sandbox-provider-reference',
    }

    const before = await availableBalance(pool, session.accountId)

    const firstProviderEvent = signedDelivery({ secret, timestamp, payload, now })
    const first = await service.transition(adapter.toTransition(firstProviderEvent, {
      requestId: 'webhook-delivery-0001',
    }))
    const afterFirst = await availableBalance(pool, session.accountId)

    const replayedProviderEvent = signedDelivery({ secret, timestamp, payload, now })
    const second = await service.transition(adapter.toTransition(replayedProviderEvent, {
      requestId: 'webhook-delivery-0002',
    }))
    const afterReplay = await availableBalance(pool, session.accountId)

    assert.equal(first.status, 'completed')
    assert.equal(first.replayed, false)
    assert.equal(second.status, 'completed')
    assert.equal(second.replayed, true)
    assert.equal(BigInt(afterFirst) - BigInt(before), 2500n)
    assert.equal(afterReplay, afterFirst)

    const eventCount = await pool.query(
      'SELECT COUNT(*)::int AS count FROM payment_events WHERE event_id = $1',
      [`sandbox:${payload.eventId}`],
    )
    assert.equal(Number(eventCount.rows[0].count), 1)

    const settlementCount = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM ledger_transactions
       WHERE reference_type = 'payment_operation'
         AND reference_id = $1
         AND type = 'SANDBOX_DEPOSIT'`,
      [deposit.id],
    )
    assert.equal(Number(settlementCount.rows[0].count), 1)

    const report = await reconciler.reconcile()
    assert.equal(report.ok, true)
    assert.equal(report.summary.mismatchCount, 0)

    const conflictingPayload = {
      ...payload,
      action: 'fail',
    }
    const conflictingEvent = signedDelivery({
      secret,
      timestamp,
      payload: conflictingPayload,
      now,
    })

    await assert.rejects(
      service.transition(adapter.toTransition(conflictingEvent, {
        requestId: 'webhook-delivery-conflict',
      })),
      (error) => error.code === 'PAYMENT_EVENT_CONFLICT' && error.status === 409,
    )

    assert.equal(await availableBalance(pool, session.accountId), afterFirst)
    assert.equal((await reconciler.reconcile()).ok, true)
  } finally {
    await pool.end()
  }
})

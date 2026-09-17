import { createHash, randomUUID } from 'node:crypto'
import { atomicToDecimalString, atomicToNumber, decimalToAtomic } from './amounts.js'
import { SandboxPaymentLedger } from './sandboxPaymentLedger.js'

const DEMO_DECIMALS = 2
const MAX_DEMO_AMOUNT_ATOMIC = 100_000_000n
export const SANDBOX_PAYMENT_ACTIONS = Object.freeze({
  deposit: Object.freeze({
    pending: Object.freeze({ complete: 'completed', fail: 'failed' }),
  }),
  withdrawal: Object.freeze({
    reserved: Object.freeze({ approve: 'approved', reject: 'rejected', fail: 'failed' }),
    approved: Object.freeze({ complete: 'completed', fail: 'failed' }),
  }),
})

export class SandboxPaymentError extends Error {
  constructor(status, code, message, details = undefined) {
    super(message)
    this.name = 'SandboxPaymentError'
    this.status = status
    this.code = code
    this.details = details
  }
}

function normalizeIdempotencyKey(value) {
  if (typeof value !== 'string') {
    throw new SandboxPaymentError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Sandbox payment requests require an idempotency key')
  }
  const key = value.trim()
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(key)) {
    throw new SandboxPaymentError(
      400,
      'INVALID_IDEMPOTENCY_KEY',
      'Idempotency key must be 8-128 characters using letters, numbers, dot, underscore, colon, or hyphen',
    )
  }
  return key
}

function normalizeEventId(value) {
  if (typeof value !== 'string') {
    throw new SandboxPaymentError(400, 'EVENT_ID_REQUIRED', 'Sandbox payment transitions require an event ID')
  }
  const eventId = value.trim()
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(eventId)) {
    throw new SandboxPaymentError(
      400,
      'INVALID_EVENT_ID',
      'Event ID must be 8-128 characters using letters, numbers, dot, underscore, colon, or hyphen',
    )
  }
  return eventId
}

function amountToAtomic(value) {
  let amountAtomic
  try {
    amountAtomic = decimalToAtomic(value, DEMO_DECIMALS)
  } catch {
    throw new SandboxPaymentError(400, 'INVALID_PAYMENT_AMOUNT', 'Amount must use at most two decimal places')
  }
  const units = BigInt(amountAtomic)
  if (units <= 0n || units > MAX_DEMO_AMOUNT_ATOMIC) {
    throw new SandboxPaymentError(400, 'INVALID_PAYMENT_AMOUNT', 'Amount must be between 0.01 and 1,000,000 DEMO')
  }
  return amountAtomic
}

function fingerprint({ accountId, kind, amountAtomic }) {
  return createHash('sha256')
    .update(JSON.stringify({ accountId, kind, asset: 'DEMO', amountAtomic: String(amountAtomic) }))
    .digest('hex')
}

function operationSnapshot(row, { replayed = false } = {}) {
  if (!row) return null
  const amountAtomic = String(row.amount_atomic)
  return {
    id: row.id,
    accountId: row.account_id,
    kind: row.kind,
    asset: { code: row.asset_code, decimals: DEMO_DECIMALS, kind: 'demo' },
    amountAtomic,
    amount: atomicToNumber(amountAtomic, DEMO_DECIMALS),
    amountExact: atomicToDecimalString(amountAtomic, DEMO_DECIMALS),
    status: row.status,
    idempotencyKey: row.idempotency_key,
    firstRequestId: row.first_request_id || null,
    reservationTransactionId: row.reservation_transaction_id || null,
    settlementTransactionId: row.settlement_transaction_id || null,
    reversalTransactionId: row.reversal_transaction_id || null,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    sandbox: true,
    mode: 'demo',
    replayed,
  }
}

function validateKind(kind) {
  if (kind !== 'deposit' && kind !== 'withdrawal') {
    throw new SandboxPaymentError(400, 'INVALID_PAYMENT_KIND', 'Payment kind must be deposit or withdrawal')
  }
  return kind
}

export class SandboxPaymentService {
  constructor({ pool, auditLog = null, ledger = null, now = Date.now } = {}) {
    if (!pool) throw new Error('SandboxPaymentService requires a pool')
    this.pool = pool
    this.auditLog = auditLog
    this.now = now
    this.ledger = ledger || new SandboxPaymentLedger({ now })
  }

  async createOperation({ accountId, kind, amount, idempotencyKey, requestId = null } = {}) {
    if (!accountId) throw new SandboxPaymentError(401, 'AUTH_SESSION_REQUIRED', 'Authenticated account is required')
    const normalizedKind = validateKind(kind)
    const normalizedKey = normalizeIdempotencyKey(idempotencyKey)
    const amountAtomic = amountToAtomic(amount)
    const requestFingerprint = fingerprint({ accountId, kind: normalizedKind, amountAtomic })
    const timestamp = this.now()
    const operationId = randomUUID()
    const initialStatus = normalizedKind === 'deposit' ? 'pending' : 'reserved'
    const client = await this.pool.connect()

    try {
      await client.query('BEGIN')
      const inserted = await client.query(
        `INSERT INTO payment_operations (
           id, account_id, kind, asset_code, amount_atomic, status,
           idempotency_key, request_fingerprint, first_request_id,
           created_at, updated_at, metadata
         ) VALUES ($1, $2, $3, 'DEMO', $4::numeric, $5, $6, $7, $8, $9, $9, $10::jsonb)
         ON CONFLICT (account_id, kind, idempotency_key) DO NOTHING
         RETURNING *`,
        [
          operationId,
          accountId,
          normalizedKind,
          amountAtomic,
          initialStatus,
          normalizedKey,
          requestFingerprint,
          requestId,
          timestamp,
          JSON.stringify({ sandbox: true, mode: 'demo' }),
        ],
      )

      if (!inserted.rows[0]) {
        const existing = await client.query(
          `SELECT *
           FROM payment_operations
           WHERE account_id = $1 AND kind = $2 AND idempotency_key = $3`,
          [accountId, normalizedKind, normalizedKey],
        )
        const row = existing.rows[0]
        if (!row || row.request_fingerprint !== requestFingerprint) {
          throw new SandboxPaymentError(
            409,
            'IDEMPOTENCY_CONFLICT',
            'Idempotency key was already used with different payment parameters',
          )
        }
        await client.query('COMMIT')
        return operationSnapshot(row, { replayed: true })
      }

      let row = inserted.rows[0]
      if (normalizedKind === 'withdrawal') {
        const reservation = await this.ledger.reserveWithdrawal(client, {
          accountId,
          amountAtomic,
          paymentOperationId: operationId,
        })
        if (!reservation) {
          throw new SandboxPaymentError(409, 'INSUFFICIENT_DEMO_CREDITS', 'Not enough available DEMO credits to reserve withdrawal')
        }
        const updated = await client.query(
          `UPDATE payment_operations
           SET reservation_transaction_id = $2,
               updated_at = $3
           WHERE id = $1
           RETURNING *`,
          [operationId, reservation.transactionId, timestamp],
        )
        row = updated.rows[0]
      }

      await client.query('COMMIT')
      this.auditLog?.record?.('sandbox_payment.created', {
        requestId,
        accountId,
        paymentOperationId: row.id,
        kind: row.kind,
        amountAtomic: String(row.amount_atomic),
        status: row.status,
      })
      return operationSnapshot(row)
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      throw error
    } finally {
      client.release()
    }
  }

  async listOperations({ accountId, limit = 50 } = {}) {
    if (!accountId) throw new SandboxPaymentError(401, 'AUTH_SESSION_REQUIRED', 'Authenticated account is required')
    const safeLimit = Math.max(1, Math.min(100, Number.isInteger(limit) ? limit : 50))
    const result = await this.pool.query(
      `SELECT *
       FROM payment_operations
       WHERE account_id = $1
       ORDER BY created_at DESC, id DESC
       LIMIT $2`,
      [accountId, safeLimit],
    )
    return result.rows.map((row) => operationSnapshot(row))
  }

  async transition({ operationId, action, eventId, actorAccountId, requestId = null } = {}) {
    if (typeof operationId !== 'string' || !operationId.trim()) {
      throw new SandboxPaymentError(400, 'PAYMENT_OPERATION_REQUIRED', 'Payment operation ID is required')
    }
    const normalizedEventId = normalizeEventId(eventId)
    if (typeof action !== 'string' || !action.trim()) {
      throw new SandboxPaymentError(400, 'PAYMENT_ACTION_REQUIRED', 'Payment action is required')
    }
    const normalizedAction = action.trim()
    const client = await this.pool.connect()

    try {
      await client.query('BEGIN')
      const locked = await client.query(
        `SELECT *
         FROM payment_operations
         WHERE id = $1
         FOR UPDATE`,
        [operationId],
      )
      let row = locked.rows[0]
      if (!row) throw new SandboxPaymentError(404, 'PAYMENT_OPERATION_NOT_FOUND', 'Sandbox payment operation was not found')

      const existingEvent = await client.query(
        `SELECT event_id, payment_operation_id, event_type
         FROM payment_events
         WHERE event_id = $1`,
        [normalizedEventId],
      )
      if (existingEvent.rows[0]) {
        const event = existingEvent.rows[0]
        if (event.payment_operation_id !== row.id || event.event_type !== normalizedAction) {
          throw new SandboxPaymentError(409, 'PAYMENT_EVENT_CONFLICT', 'Event ID was already used for a different payment transition')
        }
        await client.query('COMMIT')
        return operationSnapshot(row, { replayed: true })
      }

      const nextStatus = SANDBOX_PAYMENT_ACTIONS[row.kind]?.[row.status]?.[normalizedAction]
      if (!nextStatus) {
        throw new SandboxPaymentError(409, 'INVALID_PAYMENT_TRANSITION', 'Payment transition is not allowed from the current state', {
          kind: row.kind,
          status: row.status,
          action: normalizedAction,
        })
      }

      let settlementTransactionId = row.settlement_transaction_id
      let reversalTransactionId = row.reversal_transaction_id
      if (row.kind === 'deposit' && normalizedAction === 'complete') {
        const posting = await this.ledger.creditDeposit(client, {
          accountId: row.account_id,
          amountAtomic: String(row.amount_atomic),
          paymentOperationId: row.id,
        })
        settlementTransactionId = posting.transactionId
      }

      if (row.kind === 'withdrawal' && normalizedAction === 'complete') {
        const posting = await this.ledger.settleWithdrawal(client, {
          accountId: row.account_id,
          amountAtomic: String(row.amount_atomic),
          paymentOperationId: row.id,
        })
        settlementTransactionId = posting.transactionId
      }

      if (row.kind === 'withdrawal' && (normalizedAction === 'reject' || normalizedAction === 'fail')) {
        const posting = await this.ledger.releaseWithdrawal(client, {
          accountId: row.account_id,
          amountAtomic: String(row.amount_atomic),
          paymentOperationId: row.id,
          reason: normalizedAction,
        })
        reversalTransactionId = posting.transactionId
      }

      const timestamp = this.now()
      const updated = await client.query(
        `UPDATE payment_operations
         SET status = $2,
             settlement_transaction_id = $3,
             reversal_transaction_id = $4,
             updated_at = $5
         WHERE id = $1
         RETURNING *`,
        [row.id, nextStatus, settlementTransactionId, reversalTransactionId, timestamp],
      )
      row = updated.rows[0]

      await client.query(
        `INSERT INTO payment_events (
           event_id, payment_operation_id, event_type, request_id, actor_account_id, created_at, metadata
         ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
        [
          normalizedEventId,
          row.id,
          normalizedAction,
          requestId,
          actorAccountId || null,
          timestamp,
          JSON.stringify({ sandbox: true, from: locked.rows[0].status, to: nextStatus }),
        ],
      )

      await client.query('COMMIT')
      this.auditLog?.record?.('sandbox_payment.transitioned', {
        requestId,
        accountId: row.account_id,
        actorAccountId: actorAccountId || null,
        paymentOperationId: row.id,
        kind: row.kind,
        action: normalizedAction,
        status: row.status,
        eventId: normalizedEventId,
      })
      return operationSnapshot(row)
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      throw error
    } finally {
      client.release()
    }
  }
}

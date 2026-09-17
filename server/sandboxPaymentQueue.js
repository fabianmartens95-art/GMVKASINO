import { createHash } from 'node:crypto'
import { atomicToDecimalString, atomicToNumber } from './amounts.js'

const DEMO_DECIMALS = 2

function accountRef(accountId) {
  return createHash('sha256').update(String(accountId || '')).digest('hex').slice(0, 12)
}

function queueSnapshot(row) {
  const amountAtomic = String(row.amount_atomic)
  return {
    id: row.id,
    accountRef: accountRef(row.account_id),
    kind: row.kind,
    asset: { code: row.asset_code, decimals: DEMO_DECIMALS, kind: 'demo' },
    amountAtomic,
    amount: atomicToNumber(amountAtomic, DEMO_DECIMALS),
    amountExact: atomicToDecimalString(amountAtomic, DEMO_DECIMALS),
    status: row.status,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    sandbox: true,
    mode: 'demo',
  }
}

export class SandboxPaymentQueue {
  constructor({ pool } = {}) {
    if (!pool) throw new Error('SandboxPaymentQueue requires a pool')
    this.pool = pool
  }

  async list({ limit = 100 } = {}) {
    const safeLimit = Math.max(1, Math.min(200, Number.isInteger(limit) ? limit : 100))
    const result = await this.pool.query(
      `SELECT id, account_id, kind, asset_code, amount_atomic, status, created_at, updated_at
       FROM payment_operations
       ORDER BY
         CASE status
           WHEN 'pending' THEN 0
           WHEN 'reserved' THEN 0
           WHEN 'approved' THEN 1
           ELSE 2
         END,
         created_at ASC,
         id ASC
       LIMIT $1`,
      [safeLimit],
    )
    return result.rows.map(queueSnapshot)
  }
}

import { randomUUID } from 'node:crypto'
import { atomicToDecimalString, atomicToNumber } from './amounts.js'

const DEMO_ASSET = Object.freeze({ code: 'DEMO', decimals: 2, kind: 'demo' })
const CLEARING_ACCOUNT_ID = 'sys_demo_payment_clearing'

function executorQuery(executor, text, params) {
  return executor.query(text, params)
}

function walletSnapshot(row) {
  if (!row) return null
  const balanceAtomic = String(row.balance_atomic)
  return {
    id: row.id,
    accountId: row.account_id,
    purpose: row.purpose,
    asset: DEMO_ASSET,
    balanceAtomic,
    balance: atomicToNumber(balanceAtomic, DEMO_ASSET.decimals),
    balanceExact: atomicToDecimalString(balanceAtomic, DEMO_ASSET.decimals),
  }
}

async function transactionByIdempotency(executor, idempotencyKey) {
  const result = await executorQuery(executor,
    `SELECT id
     FROM ledger_transactions
     WHERE idempotency_key = $1`,
    [idempotencyKey],
  )
  return result.rows[0]?.id || null
}

async function createLedgerTransaction(executor, {
  type,
  referenceType,
  referenceId,
  idempotencyKey,
  metadata,
  timestamp,
}) {
  const transactionId = randomUUID()
  const result = await executorQuery(executor,
    `INSERT INTO ledger_transactions (
       id, asset_code, type, reference_type, reference_id, idempotency_key, metadata, created_at
     ) VALUES ($1, 'DEMO', $2, $3, $4, $5, $6::jsonb, $7)
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING id`,
    [
      transactionId,
      type,
      referenceType,
      referenceId,
      idempotencyKey,
      JSON.stringify(metadata || {}),
      timestamp,
    ],
  )

  if (result.rows[0]?.id) {
    return { transactionId: result.rows[0].id, replayed: false }
  }

  const existingId = await transactionByIdempotency(executor, idempotencyKey)
  if (!existingId) throw new Error('Ledger idempotency conflict could not be resolved')
  return { transactionId: existingId, replayed: true }
}

async function insertEntries(executor, transactionId, entries, timestamp) {
  const values = []
  const rows = entries.map(([ledgerAccountId, amountAtomic], index) => {
    const base = index * 2
    values.push(ledgerAccountId, String(amountAtomic))
    return `($1, $${base + 2}, $${base + 3}::numeric, $${entries.length * 2 + 2})`
  })
  values.push(timestamp)
  await executorQuery(executor,
    `INSERT INTO ledger_entries (transaction_id, ledger_account_id, amount_atomic, created_at)
     VALUES ${rows.join(', ')}`,
    [transactionId, ...values],
  )
}

async function availableWallet(executor, accountId) {
  const result = await executorQuery(executor,
    `SELECT id, account_id, purpose, balance_atomic
     FROM ledger_accounts
     WHERE account_id = $1
       AND asset_code = 'DEMO'
       AND purpose = 'available'`,
    [accountId],
  )
  return walletSnapshot(result.rows[0])
}

async function reserveWallet(executor, accountId) {
  await executorQuery(executor,
    `INSERT INTO ledger_accounts (
       id, account_id, asset_code, purpose, allow_negative, balance_atomic, created_at
     ) VALUES ($1, $2, 'DEMO', 'withdrawal_reserved', FALSE, 0, $3)
     ON CONFLICT DO NOTHING`,
    [randomUUID(), accountId, Date.now()],
  )

  const result = await executorQuery(executor,
    `SELECT id, account_id, purpose, balance_atomic
     FROM ledger_accounts
     WHERE account_id = $1
       AND asset_code = 'DEMO'
       AND purpose = 'withdrawal_reserved'`,
    [accountId],
  )
  return walletSnapshot(result.rows[0])
}

export class SandboxPaymentLedger {
  constructor({ now = Date.now } = {}) {
    this.now = now
  }

  async creditDeposit(executor, { accountId, amountAtomic, paymentOperationId }) {
    const timestamp = this.now()
    const idempotencyKey = `sandbox-deposit:${paymentOperationId}:complete`
    const tx = await createLedgerTransaction(executor, {
      type: 'SANDBOX_DEPOSIT',
      referenceType: 'payment_operation',
      referenceId: paymentOperationId,
      idempotencyKey,
      metadata: { sandbox: true, direction: 'deposit' },
      timestamp,
    })
    if (tx.replayed) {
      return { transactionId: tx.transactionId, replayed: true, wallet: await availableWallet(executor, accountId) }
    }

    const walletResult = await executorQuery(executor,
      `UPDATE ledger_accounts
       SET balance_atomic = balance_atomic + $2::numeric
       WHERE account_id = $1
         AND asset_code = 'DEMO'
         AND purpose = 'available'
       RETURNING id, account_id, purpose, balance_atomic`,
      [accountId, String(amountAtomic)],
    )
    const wallet = walletSnapshot(walletResult.rows[0])
    if (!wallet) throw new Error('DEMO available wallet is missing')

    await executorQuery(executor,
      `UPDATE ledger_accounts
       SET balance_atomic = balance_atomic - $2::numeric
       WHERE id = $1`,
      [CLEARING_ACCOUNT_ID, String(amountAtomic)],
    )

    await insertEntries(executor, tx.transactionId, [
      [wallet.id, String(amountAtomic)],
      [CLEARING_ACCOUNT_ID, (-BigInt(amountAtomic)).toString()],
    ], timestamp)

    return { transactionId: tx.transactionId, replayed: false, wallet }
  }

  async reserveWithdrawal(executor, { accountId, amountAtomic, paymentOperationId }) {
    const timestamp = this.now()
    const idempotencyKey = `sandbox-withdrawal:${paymentOperationId}:reserve`
    const tx = await createLedgerTransaction(executor, {
      type: 'SANDBOX_WITHDRAWAL_RESERVE',
      referenceType: 'payment_operation',
      referenceId: paymentOperationId,
      idempotencyKey,
      metadata: { sandbox: true, direction: 'withdrawal', stage: 'reserve' },
      timestamp,
    })
    if (tx.replayed) {
      return {
        transactionId: tx.transactionId,
        replayed: true,
        wallet: await availableWallet(executor, accountId),
        reserved: await reserveWallet(executor, accountId),
      }
    }

    const reserved = await reserveWallet(executor, accountId)
    if (!reserved) throw new Error('DEMO withdrawal reserve wallet is missing')

    const walletResult = await executorQuery(executor,
      `UPDATE ledger_accounts
       SET balance_atomic = balance_atomic - $2::numeric
       WHERE account_id = $1
         AND asset_code = 'DEMO'
         AND purpose = 'available'
         AND balance_atomic >= $2::numeric
       RETURNING id, account_id, purpose, balance_atomic`,
      [accountId, String(amountAtomic)],
    )
    const wallet = walletSnapshot(walletResult.rows[0])
    if (!wallet) return null

    await executorQuery(executor,
      `UPDATE ledger_accounts
       SET balance_atomic = balance_atomic + $2::numeric
       WHERE id = $1`,
      [reserved.id, String(amountAtomic)],
    )

    await insertEntries(executor, tx.transactionId, [
      [wallet.id, (-BigInt(amountAtomic)).toString()],
      [reserved.id, String(amountAtomic)],
    ], timestamp)

    return { transactionId: tx.transactionId, replayed: false, wallet }
  }

  async releaseWithdrawal(executor, { accountId, amountAtomic, paymentOperationId, reason }) {
    const timestamp = this.now()
    const idempotencyKey = `sandbox-withdrawal:${paymentOperationId}:release`
    const tx = await createLedgerTransaction(executor, {
      type: 'SANDBOX_WITHDRAWAL_RELEASE',
      referenceType: 'payment_operation',
      referenceId: paymentOperationId,
      idempotencyKey,
      metadata: { sandbox: true, direction: 'withdrawal', stage: 'release', reason },
      timestamp,
    })
    if (tx.replayed) {
      return { transactionId: tx.transactionId, replayed: true, wallet: await availableWallet(executor, accountId) }
    }

    const reserved = await reserveWallet(executor, accountId)
    const reserveResult = await executorQuery(executor,
      `UPDATE ledger_accounts
       SET balance_atomic = balance_atomic - $2::numeric
       WHERE id = $1
         AND balance_atomic >= $2::numeric
       RETURNING id`,
      [reserved.id, String(amountAtomic)],
    )
    if (!reserveResult.rows[0]) throw new Error('Reserved withdrawal balance is insufficient')

    const walletResult = await executorQuery(executor,
      `UPDATE ledger_accounts
       SET balance_atomic = balance_atomic + $2::numeric
       WHERE account_id = $1
         AND asset_code = 'DEMO'
         AND purpose = 'available'
       RETURNING id, account_id, purpose, balance_atomic`,
      [accountId, String(amountAtomic)],
    )
    const wallet = walletSnapshot(walletResult.rows[0])
    if (!wallet) throw new Error('DEMO available wallet is missing')

    await insertEntries(executor, tx.transactionId, [
      [reserved.id, (-BigInt(amountAtomic)).toString()],
      [wallet.id, String(amountAtomic)],
    ], timestamp)

    return { transactionId: tx.transactionId, replayed: false, wallet }
  }

  async settleWithdrawal(executor, { accountId, amountAtomic, paymentOperationId }) {
    const timestamp = this.now()
    const idempotencyKey = `sandbox-withdrawal:${paymentOperationId}:complete`
    const tx = await createLedgerTransaction(executor, {
      type: 'SANDBOX_WITHDRAWAL',
      referenceType: 'payment_operation',
      referenceId: paymentOperationId,
      idempotencyKey,
      metadata: { sandbox: true, direction: 'withdrawal', stage: 'complete' },
      timestamp,
    })
    if (tx.replayed) {
      return { transactionId: tx.transactionId, replayed: true, wallet: await availableWallet(executor, accountId) }
    }

    const reserved = await reserveWallet(executor, accountId)
    const reserveResult = await executorQuery(executor,
      `UPDATE ledger_accounts
       SET balance_atomic = balance_atomic - $2::numeric
       WHERE id = $1
         AND balance_atomic >= $2::numeric
       RETURNING id`,
      [reserved.id, String(amountAtomic)],
    )
    if (!reserveResult.rows[0]) throw new Error('Reserved withdrawal balance is insufficient')

    await executorQuery(executor,
      `UPDATE ledger_accounts
       SET balance_atomic = balance_atomic + $2::numeric
       WHERE id = $1`,
      [CLEARING_ACCOUNT_ID, String(amountAtomic)],
    )

    await insertEntries(executor, tx.transactionId, [
      [reserved.id, (-BigInt(amountAtomic)).toString()],
      [CLEARING_ACCOUNT_ID, String(amountAtomic)],
    ], timestamp)

    return { transactionId: tx.transactionId, replayed: false, wallet: await availableWallet(executor, accountId) }
  }
}

export const SANDBOX_PAYMENT_CLEARING_ACCOUNT_ID = CLEARING_ACCOUNT_ID

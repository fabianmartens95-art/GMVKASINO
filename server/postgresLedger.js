import { randomUUID } from 'node:crypto'
import { atomicToDecimalString, atomicToNumber, decimalToAtomic } from './amounts.js'

const DEMO_ASSET = Object.freeze({ code: 'DEMO', decimals: 2, kind: 'demo' })
const DEMO_ISSUANCE_ACCOUNT_ID = 'sys_demo_issuance'
const DEMO_HOUSE_ACCOUNT_ID = 'sys_demo_house'

function cleanDisplayName(value) {
  return typeof value === 'string' ? value.trim().slice(0, 40) : ''
}

function executorQuery(executor, text, params) {
  return executor.query(text, params)
}

function walletSnapshot(row) {
  if (!row) return null
  const balanceAtomic = String(row.balance_atomic)
  return {
    id: row.id,
    accountId: row.account_id,
    asset: {
      code: row.asset_code,
      decimals: Number(row.decimals),
      kind: row.kind,
    },
    balanceAtomic,
    balance: atomicToNumber(balanceAtomic, Number(row.decimals)),
    balanceExact: atomicToDecimalString(balanceAtomic, Number(row.decimals)),
  }
}

export class PostgresLedger {
  constructor({ pool, now = Date.now } = {}) {
    if (!pool) throw new Error('PostgresLedger requires a pool')
    this.pool = pool
    this.now = now
  }

  async createDemoAccount(executor, { displayName = '', startingBalance = 1000 } = {}) {
    const timestamp = this.now()
    const accountId = randomUUID()
    const walletId = randomUUID()
    const transactionId = randomUUID()
    const amountAtomic = decimalToAtomic(startingBalance, DEMO_ASSET.decimals)

    await executorQuery(executor,
      `INSERT INTO accounts (id, display_name, status, created_at)
       VALUES ($1, $2, 'active', $3)`,
      [accountId, cleanDisplayName(displayName), timestamp],
    )

    await executorQuery(executor,
      `INSERT INTO ledger_accounts (
         id, account_id, asset_code, purpose, allow_negative, balance_atomic, created_at
       ) VALUES ($1, $2, 'DEMO', 'available', FALSE, $3::numeric, $4)`,
      [walletId, accountId, amountAtomic, timestamp],
    )

    if (BigInt(amountAtomic) !== 0n) {
      await executorQuery(executor,
        `INSERT INTO ledger_transactions (
           id, asset_code, type, reference_type, reference_id, idempotency_key, metadata, created_at
         ) VALUES ($1, 'DEMO', 'INITIAL_CREDIT', 'account', $2, $3, $4::jsonb, $5)`,
        [
          transactionId,
          accountId,
          `initial-credit:${accountId}`,
          JSON.stringify({ source: 'demo_bootstrap' }),
          timestamp,
        ],
      )

      await executorQuery(executor,
        `INSERT INTO ledger_entries (transaction_id, ledger_account_id, amount_atomic, created_at)
         VALUES
           ($1, $2, $3::numeric, $4),
           ($1, $5, -$3::numeric, $4)`,
        [transactionId, walletId, amountAtomic, timestamp, DEMO_ISSUANCE_ACCOUNT_ID],
      )

      await executorQuery(executor,
        `UPDATE ledger_accounts
         SET balance_atomic = balance_atomic - $2::numeric
         WHERE id = $1`,
        [DEMO_ISSUANCE_ACCOUNT_ID, amountAtomic],
      )
    }

    return {
      account: {
        id: accountId,
        displayName: cleanDisplayName(displayName),
        status: 'active',
        createdAt: timestamp,
      },
      wallet: {
        id: walletId,
        accountId,
        asset: DEMO_ASSET,
        balanceAtomic: amountAtomic,
        balance: atomicToNumber(amountAtomic, DEMO_ASSET.decimals),
        balanceExact: atomicToDecimalString(amountAtomic, DEMO_ASSET.decimals),
      },
    }
  }

  async getWallet(executor, accountId, assetCode = DEMO_ASSET.code) {
    const result = await executorQuery(executor,
      `SELECT
         la.id,
         la.account_id,
         la.asset_code,
         la.balance_atomic,
         a.decimals,
         a.kind
       FROM ledger_accounts la
       JOIN assets a ON a.code = la.asset_code
       WHERE la.account_id = $1
         AND la.asset_code = $2
         AND la.purpose = 'available'`,
      [accountId, assetCode],
    )
    return walletSnapshot(result.rows[0])
  }

  async settleDemoGame(executor, { accountId, bet, payout, spinId, gameId }) {
    if (!spinId) throw new Error('spinId is required for ledger settlement')
    const timestamp = this.now()
    const betAtomic = decimalToAtomic(bet, DEMO_ASSET.decimals)
    const payoutAtomic = decimalToAtomic(payout, DEMO_ASSET.decimals)
    const betUnits = BigInt(betAtomic)
    const payoutUnits = BigInt(payoutAtomic)

    if (betUnits <= 0n || payoutUnits < 0n) {
      throw new Error('invalid demo settlement amounts')
    }

    const walletResult = await executorQuery(executor,
      `UPDATE ledger_accounts la
       SET balance_atomic = balance_atomic - $2::numeric + $3::numeric
       FROM assets a
       WHERE la.account_id = $1
         AND la.asset_code = 'DEMO'
         AND la.purpose = 'available'
         AND a.code = la.asset_code
         AND la.balance_atomic >= $2::numeric
       RETURNING
         la.id,
         la.account_id,
         la.asset_code,
         la.balance_atomic,
         a.decimals,
         a.kind`,
      [accountId, betAtomic, payoutAtomic],
    )

    const wallet = walletSnapshot(walletResult.rows[0])
    if (!wallet) return null

    await executorQuery(executor,
      `UPDATE ledger_accounts
       SET balance_atomic = balance_atomic + $2::numeric - $3::numeric
       WHERE id = $1`,
      [DEMO_HOUSE_ACCOUNT_ID, betAtomic, payoutAtomic],
    )

    const transactionId = randomUUID()
    await executorQuery(executor,
      `INSERT INTO ledger_transactions (
         id, asset_code, type, reference_type, reference_id, idempotency_key, metadata, created_at
       ) VALUES ($1, 'DEMO', 'GAME_SETTLEMENT', 'spin', $2, $3, $4::jsonb, $5)`,
      [
        transactionId,
        spinId,
        `spin:${spinId}`,
        JSON.stringify({ gameId }),
        timestamp,
      ],
    )

    const entries = [
      [wallet.id, (-betUnits).toString()],
      [DEMO_HOUSE_ACCOUNT_ID, betUnits.toString()],
    ]
    if (payoutUnits > 0n) {
      entries.push(
        [DEMO_HOUSE_ACCOUNT_ID, (-payoutUnits).toString()],
        [wallet.id, payoutUnits.toString()],
      )
    }

    const values = []
    const placeholders = entries.map(([ledgerAccountId, amountAtomicValue], index) => {
      const base = index * 2
      values.push(ledgerAccountId, amountAtomicValue)
      return `($1, $${base + 2}, $${base + 3}::numeric, $${entries.length * 2 + 2})`
    })
    values.push(timestamp)

    await executorQuery(executor,
      `INSERT INTO ledger_entries (transaction_id, ledger_account_id, amount_atomic, created_at)
       VALUES ${placeholders.join(', ')}`,
      [transactionId, ...values],
    )

    return wallet
  }
}

export const DEMO_LEDGER_ASSET = DEMO_ASSET

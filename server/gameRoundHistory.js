import { atomicToDecimalString, atomicToNumber } from './amounts.js'

export class GameRoundHistoryError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'GameRoundHistoryError'
    this.code = code
    this.status = 400
  }
}

function normalizeLimit(value) {
  if (value === undefined || value === null || value === '') return 50
  const limit = Number(value)
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new GameRoundHistoryError('INVALID_HISTORY_LIMIT', 'History limit must be an integer between 1 and 100')
  }
  return limit
}

export class GameRoundHistory {
  constructor({ pool } = {}) {
    if (!pool) throw new Error('GameRoundHistory requires a pool')
    this.pool = pool
  }

  async list({ accountId, limit } = {}) {
    if (typeof accountId !== 'string' || !accountId.trim()) {
      throw new GameRoundHistoryError('ACCOUNT_REQUIRED', 'Authenticated account is required')
    }
    const safeLimit = normalizeLimit(limit)
    const result = await this.pool.query(
      `SELECT
         id,
         game_id,
         asset_code,
         bet_atomic::text AS bet_atomic,
         payout_atomic::text AS payout_atomic,
         status,
         created_at
       FROM game_rounds
       WHERE account_id = $1
       ORDER BY created_at DESC, id DESC
       LIMIT $2`,
      [accountId.trim(), safeLimit],
    )

    return result.rows.map((row) => ({
      roundId: row.id,
      gameId: row.game_id,
      asset: { code: row.asset_code, decimals: 2, kind: 'demo' },
      betAtomic: String(row.bet_atomic),
      bet: atomicToNumber(row.bet_atomic, 2),
      betExact: atomicToDecimalString(row.bet_atomic, 2),
      payoutAtomic: String(row.payout_atomic),
      payout: atomicToNumber(row.payout_atomic, 2),
      payoutExact: atomicToDecimalString(row.payout_atomic, 2),
      status: row.status,
      createdAt: Number(row.created_at),
    }))
  }
}

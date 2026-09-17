import { randomUUID } from 'node:crypto'
import { decimalToAtomic } from './amounts.js'

function mapRound(row) {
  if (!row) return null
  return {
    roundId: row.id,
    requestFingerprint: row.request_fingerprint,
    response: row.response_json,
  }
}

export class PostgresGameRoundExecutor {
  constructor({ sessionStore } = {}) {
    if (!sessionStore?.pool || !sessionStore?.ledger) {
      throw new Error('PostgresGameRoundExecutor requires a PostgreSQL session store')
    }
    this.sessionStore = sessionStore
    this.pool = sessionStore.pool
    this.ledger = sessionStore.ledger
  }

  async execute({
    sessionId,
    bet,
    gameId,
    accountId = null,
    ownerId,
    idempotencyKey,
    requestFingerprint,
    requestId = null,
    resolveResult,
  } = {}) {
    if (!sessionId) return null
    if (!ownerId || !idempotencyKey || !requestFingerprint) {
      throw new Error('ownerId, idempotencyKey and requestFingerprint are required')
    }
    if (typeof resolveResult !== 'function') throw new Error('resolveResult is required')

    const client = await this.pool.connect()
    const { timestamp, idleCutoff, absoluteCutoff } = this.sessionStore.cutoffs()

    try {
      await client.query('BEGIN')

      const sessionResult = await client.query(
        `SELECT id, account_id, spins, auth_required
         FROM demo_sessions
         WHERE id = $1
           AND last_seen_at > $2
           AND created_at > $3
           AND (auth_required = FALSE OR ($4::text IS NOT NULL AND account_id = $4))
         FOR UPDATE`,
        [sessionId, idleCutoff, absoluteCutoff, accountId],
      )
      const session = sessionResult.rows[0]
      if (!session) {
        await client.query('ROLLBACK')
        await this.sessionStore.deleteExpiredSession(sessionId, idleCutoff, absoluteCutoff)
        return null
      }

      const authoritativeOwnerId = session.account_id
      if (authoritativeOwnerId !== ownerId) {
        await client.query('ROLLBACK')
        return null
      }

      // Account-scoped idempotency must serialize before RNG, including retries
      // arriving through different sessions or different application instances.
      await client.query(
        `SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))`,
        [`game-round:${authoritativeOwnerId}:${idempotencyKey}`],
      )

      const existingResult = await client.query(
        `SELECT id, request_fingerprint, response_json
         FROM game_rounds
         WHERE account_id = $1
           AND idempotency_key = $2`,
        [authoritativeOwnerId, idempotencyKey],
      )
      const existing = mapRound(existingResult.rows[0])
      if (existing) {
        await client.query(
          `UPDATE demo_sessions SET last_seen_at = $2 WHERE id = $1`,
          [sessionId, timestamp],
        )
        await client.query('COMMIT')
        if (existing.requestFingerprint !== requestFingerprint) {
          return {
            accountId: authoritativeOwnerId,
            idempotencyConflict: true,
            roundId: existing.roundId,
          }
        }
        return {
          accountId: authoritativeOwnerId,
          replayed: true,
          idempotencyConflict: false,
          roundId: existing.roundId,
          roundResponse: existing.response,
        }
      }

      const walletResult = await client.query(
        `SELECT balance_atomic
         FROM ledger_accounts
         WHERE account_id = $1
           AND asset_code = 'DEMO'
           AND purpose = 'available'
         FOR UPDATE`,
        [authoritativeOwnerId],
      )
      const walletBefore = walletResult.rows[0]
      if (!walletBefore) throw new Error('Demo wallet is missing for game round')
      if (BigInt(walletBefore.balance_atomic) < BigInt(decimalToAtomic(bet, 2))) {
        await client.query('ROLLBACK')
        return null
      }

      // RNG is deliberately invoked only after the idempotency winner and wallet
      // lock are established. A concurrent retry can therefore never rerun RNG.
      const result = await resolveResult()
      const spinId = randomUUID()
      const roundResponse = {
        spinId,
        gameId,
        bet,
        ...result,
      }

      const wallet = await this.ledger.settleDemoGame(client, {
        accountId: authoritativeOwnerId,
        bet,
        payout: result.totalWin,
        spinId,
        gameId,
      })
      if (!wallet) {
        await client.query('ROLLBACK')
        return null
      }

      const updatedResult = await client.query(
        `UPDATE demo_sessions
         SET spins = spins + 1,
             last_seen_at = $2
         WHERE id = $1
         RETURNING spins`,
        [sessionId, timestamp],
      )
      const spins = Number(updatedResult.rows[0].spins)
      const finalRoundResponse = {
        ...roundResponse,
        balance: wallet.balance,
        spins,
      }

      await client.query(
        `INSERT INTO game_rounds (
           id, account_id, game_id, asset_code, bet_atomic, payout_atomic,
           idempotency_key, request_fingerprint, response_json, status,
           settlement_reference_id, first_request_id, created_at
         ) VALUES (
           $1, $2, $3, 'DEMO', $4::numeric, $5::numeric,
           $6, $7, $8::jsonb, 'settled', $9, $10, $11
         )`,
        [
          spinId,
          authoritativeOwnerId,
          gameId,
          decimalToAtomic(bet, 2),
          decimalToAtomic(result.totalWin, 2),
          idempotencyKey,
          requestFingerprint,
          JSON.stringify(finalRoundResponse),
          spinId,
          requestId,
          timestamp,
        ],
      )

      await client.query('COMMIT')
      return {
        accountId: authoritativeOwnerId,
        balance: wallet.balance,
        wallet,
        spins,
        replayed: false,
        idempotencyConflict: false,
        roundId: spinId,
        roundResponse: finalRoundResponse,
      }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      throw error
    } finally {
      client.release()
    }
  }
}

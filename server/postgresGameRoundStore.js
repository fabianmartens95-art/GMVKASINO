import { randomUUID } from 'node:crypto'

export class PostgresGameRoundStore {
  constructor({ sessionStore } = {}) {
    if (!sessionStore?.pool) throw new Error('PostgresGameRoundStore requires a PostgreSQL session store')
    if (!sessionStore?.ledger) throw new Error('PostgresGameRoundStore requires a ledger')
    this.sessionStore = sessionStore
    this.pool = sessionStore.pool
    this.ledger = sessionStore.ledger
  }

  async executeGameRound(sessionId, {
    bet,
    betAtomic,
    gameId,
    accountId = null,
    assetCode = 'DEMO',
    idempotencyKey,
    fingerprint,
    sessionRef,
    requestId = null,
  } = {}, resolveResult) {
    if (!sessionId) return null
    if (typeof resolveResult !== 'function') throw new Error('resolveResult is required')

    const client = await this.pool.connect()
    const { timestamp, idleCutoff, absoluteCutoff } = this.sessionStore.cutoffs()

    try {
      await client.query('BEGIN')
      const sessionResult = await client.query(
        `SELECT id, account_id, player, spins, created_at, last_seen_at, auth_required
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

      const roundId = randomUUID()
      const reservation = await client.query(
        `INSERT INTO game_rounds (
           id,
           account_id,
           session_ref,
           game_id,
           asset_code,
           bet_atomic,
           idempotency_key,
           request_fingerprint,
           request_id,
           status,
           created_at
         ) VALUES ($1, $2, $3, $4, $5, $6::numeric, $7, $8, $9, 'REQUESTED', $10)
         ON CONFLICT (account_id, idempotency_key) DO NOTHING
         RETURNING id`,
        [
          roundId,
          session.account_id,
          sessionRef,
          gameId,
          assetCode,
          betAtomic,
          idempotencyKey,
          fingerprint,
          requestId,
          timestamp,
        ],
      )

      if (reservation.rowCount === 0) {
        const existingResult = await client.query(
          `SELECT id, request_fingerprint, status, response
           FROM game_rounds
           WHERE account_id = $1
             AND idempotency_key = $2
           FOR UPDATE`,
          [session.account_id, idempotencyKey],
        )
        const existing = existingResult.rows[0]
        if (!existing) throw new Error('Idempotent game round disappeared during replay lookup')

        if (existing.request_fingerprint !== fingerprint) {
          await client.query('ROLLBACK')
          return { conflict: true, roundId: existing.id }
        }

        if (!['SETTLED', 'AUDITED'].includes(existing.status) || !existing.response) {
          throw new Error(`Existing game round ${existing.id} is not replayable`)
        }

        await client.query(
          `UPDATE demo_sessions
           SET last_seen_at = $2
           WHERE id = $1`,
          [sessionId, timestamp],
        )
        await client.query('COMMIT')
        return {
          replayed: true,
          response: existing.response,
        }
      }

      const walletBefore = await this.ledger.getWallet(client, session.account_id, assetCode)
      if (!walletBefore) throw new Error('Game round account is missing its wallet')
      if (BigInt(walletBefore.balanceAtomic) < BigInt(betAtomic)) {
        await client.query('ROLLBACK')
        return { insufficient: true }
      }

      await client.query(
        `UPDATE game_rounds
         SET status = 'AUTHORIZED'
         WHERE id = $1`,
        [roundId],
      )

      const result = await resolveResult({ roundId })

      await client.query(
        `UPDATE game_rounds
         SET status = 'RESULT_CREATED'
         WHERE id = $1`,
        [roundId],
      )

      const wallet = await this.ledger.settleDemoGame(client, {
        accountId: session.account_id,
        bet,
        payout: result.totalWin,
        spinId: roundId,
        gameId,
      })
      if (!wallet) {
        await client.query('ROLLBACK')
        return { insufficient: true }
      }

      const updatedResult = await client.query(
        `UPDATE demo_sessions
         SET spins = spins + 1,
             last_seen_at = $2
         WHERE id = $1
         RETURNING spins`,
        [sessionId, timestamp],
      )

      const response = {
        roundId,
        spinId: roundId,
        gameId,
        bet,
        ...result,
        balance: wallet.balance,
        spins: Number(updatedResult.rows[0].spins),
      }

      await client.query(
        `UPDATE game_rounds
         SET status = 'SETTLED',
             response = $2::jsonb,
             settled_at = $3
         WHERE id = $1`,
        [roundId, JSON.stringify(response), timestamp],
      )

      await client.query('COMMIT')
      return { replayed: false, response }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      throw error
    } finally {
      client.release()
    }
  }
}

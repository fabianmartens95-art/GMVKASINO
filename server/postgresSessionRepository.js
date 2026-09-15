import pg from 'pg'
import { randomBytes } from 'node:crypto'

const { Pool } = pg

function cleanPlayer(player) {
  return typeof player === 'string' ? player.trim().slice(0, 40) : ''
}

function createSessionToken() {
  return randomBytes(32).toString('base64url')
}

function mapSession(row) {
  if (!row) return null
  return {
    id: row.id,
    player: row.player || '',
    balance: Number(row.balance),
    spins: Number(row.spins),
    createdAt: Number(row.created_at_ms),
    lastSeenAt: Number(row.last_seen_at_ms),
    ...(row.rotated_at_ms === null || row.rotated_at_ms === undefined
      ? {}
      : { rotatedAt: Number(row.rotated_at_ms) }),
  }
}

export function createPostgresPool({ connectionString, max = 10 } = {}) {
  if (!connectionString) throw new Error('DATABASE_URL is required for PostgreSQL persistence')
  return new Pool({ connectionString, max })
}

export class PostgresSessionRepository {
  constructor({
    pool,
    startingBalance = 1000,
    idleTtlMs = 86_400_000,
    absoluteTtlMs = 604_800_000,
    now = Date.now,
  } = {}) {
    if (!pool) throw new Error('pool is required')
    this.pool = pool
    this.startingBalance = startingBalance
    this.idleTtlMs = idleTtlMs
    this.absoluteTtlMs = absoluteTtlMs
    this.now = now
  }

  thresholds(timestamp = this.now()) {
    return {
      timestamp,
      idleCutoff: timestamp - this.idleTtlMs,
      absoluteCutoff: timestamp - this.absoluteTtlMs,
    }
  }

  async create({ player = '' } = {}) {
    const timestamp = this.now()

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const id = createSessionToken()
      try {
        const result = await this.pool.query(
          `INSERT INTO demo_sessions
            (id, player, balance, spins, created_at_ms, last_seen_at_ms)
           VALUES ($1, $2, $3, 0, $4, $4)
           RETURNING *`,
          [id, cleanPlayer(player), Number(this.startingBalance.toFixed(2)), timestamp],
        )
        return mapSession(result.rows[0])
      } catch (error) {
        if (error?.code !== '23505' || attempt === 2) throw error
      }
    }

    throw new Error('Unable to allocate demo session token')
  }

  async get(sessionId) {
    if (!sessionId) return null
    const { timestamp, idleCutoff, absoluteCutoff } = this.thresholds()
    const result = await this.pool.query(
      `UPDATE demo_sessions
       SET last_seen_at_ms = $2
       WHERE id = $1
         AND last_seen_at_ms >= $3
         AND created_at_ms >= $4
       RETURNING *`,
      [sessionId, timestamp, idleCutoff, absoluteCutoff],
    )

    if (result.rows[0]) return mapSession(result.rows[0])

    await this.pool.query(
      `DELETE FROM demo_sessions
       WHERE id = $1
         AND (last_seen_at_ms < $2 OR created_at_ms < $3)`,
      [sessionId, idleCutoff, absoluteCutoff],
    )
    return null
  }

  async resumeOrCreate({ sessionId, player } = {}) {
    if (sessionId) {
      const { timestamp, idleCutoff, absoluteCutoff } = this.thresholds()
      const hasPlayer = typeof player === 'string'
      const result = await this.pool.query(
        `UPDATE demo_sessions
         SET player = CASE WHEN $2::boolean THEN $3 ELSE player END,
             last_seen_at_ms = $4
         WHERE id = $1
           AND last_seen_at_ms >= $5
           AND created_at_ms >= $6
         RETURNING *`,
        [sessionId, hasPlayer, cleanPlayer(player), timestamp, idleCutoff, absoluteCutoff],
      )

      if (result.rows[0]) {
        return { session: mapSession(result.rows[0]), created: false }
      }

      await this.pool.query(
        `DELETE FROM demo_sessions
         WHERE id = $1
           AND (last_seen_at_ms < $2 OR created_at_ms < $3)`,
        [sessionId, idleCutoff, absoluteCutoff],
      )
    }

    return { session: await this.create({ player }), created: true }
  }

  async rotate(sessionId) {
    if (!sessionId) return null
    const { timestamp, idleCutoff, absoluteCutoff } = this.thresholds()

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const replacementId = createSessionToken()
      try {
        const result = await this.pool.query(
          `UPDATE demo_sessions
           SET id = $2,
               last_seen_at_ms = $3,
               rotated_at_ms = $3
           WHERE id = $1
             AND last_seen_at_ms >= $4
             AND created_at_ms >= $5
           RETURNING *`,
          [sessionId, replacementId, timestamp, idleCutoff, absoluteCutoff],
        )
        if (result.rows[0]) return mapSession(result.rows[0])
        return null
      } catch (error) {
        if (error?.code !== '23505' || attempt === 2) throw error
      }
    }

    return null
  }

  async invalidate(sessionId) {
    if (!sessionId) return false
    const result = await this.pool.query('DELETE FROM demo_sessions WHERE id = $1', [sessionId])
    return result.rowCount > 0
  }

  async settleSpin(sessionId, { bet, payout }) {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const sessionResult = await client.query(
        'SELECT * FROM demo_sessions WHERE id = $1 FOR UPDATE',
        [sessionId],
      )
      const row = sessionResult.rows[0]
      if (!row) {
        await client.query('COMMIT')
        return { status: 'missing', session: null }
      }

      const session = mapSession(row)
      const { timestamp, idleCutoff, absoluteCutoff } = this.thresholds()
      if (session.lastSeenAt < idleCutoff || session.createdAt < absoluteCutoff) {
        await client.query('DELETE FROM demo_sessions WHERE id = $1', [sessionId])
        await client.query('COMMIT')
        return { status: 'missing', session: null }
      }

      if (session.balance < bet) {
        await client.query('COMMIT')
        return { status: 'insufficient', session }
      }

      const balance = Number((session.balance - bet + payout).toFixed(2))
      const updated = await client.query(
        `UPDATE demo_sessions
         SET balance = $2,
             spins = spins + 1,
             last_seen_at_ms = $3
         WHERE id = $1
         RETURNING *`,
        [sessionId, balance, timestamp],
      )
      await client.query('COMMIT')
      return { status: 'ok', session: mapSession(updated.rows[0]) }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      throw error
    } finally {
      client.release()
    }
  }

  async checkReadiness() {
    await this.pool.query('SELECT 1')
    return { ok: true, backend: 'postgres' }
  }

  async close() {
    await this.pool.end()
  }
}

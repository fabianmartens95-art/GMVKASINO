import { randomBytes } from 'node:crypto'
import { runMigrations } from './migrations.js'

function cleanPlayer(player) {
  return typeof player === 'string' ? player.trim().slice(0, 40) : ''
}

function token() {
  return randomBytes(32).toString('base64url')
}

function mapRow(row) {
  if (!row) return null
  return {
    id: row.id,
    player: row.player || '',
    balance: Number(row.balance),
    spins: Number(row.spins),
    createdAt: Number(row.created_at),
    lastSeenAt: Number(row.last_seen_at),
  }
}

export class PostgresSessionStore {
  constructor({
    pool,
    startingBalance = 1000,
    ttlMs,
    idleTtlMs = ttlMs ?? 86_400_000,
    absoluteTtlMs = 604_800_000,
    now = Date.now,
  } = {}) {
    if (!pool) throw new Error('PostgresSessionStore requires a pool')
    this.pool = pool
    this.startingBalance = startingBalance
    this.idleTtlMs = idleTtlMs
    this.absoluteTtlMs = absoluteTtlMs
    this.now = now
  }

  async init() {
    await runMigrations({ pool: this.pool })
    await this.pruneExpired()
    return this
  }

  cutoffs(timestamp = this.now()) {
    return {
      timestamp,
      idleCutoff: timestamp - this.idleTtlMs,
      absoluteCutoff: timestamp - this.absoluteTtlMs,
    }
  }

  async create({ player = '' } = {}) {
    const timestamp = this.now()
    const session = {
      id: token(),
      player: cleanPlayer(player),
      balance: Number(this.startingBalance.toFixed(2)),
      spins: 0,
      createdAt: timestamp,
      lastSeenAt: timestamp,
    }

    const result = await this.pool.query(
      `INSERT INTO demo_sessions (id, player, balance, spins, created_at, last_seen_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, player, balance, spins, created_at, last_seen_at`,
      [session.id, session.player, session.balance, session.spins, session.createdAt, session.lastSeenAt],
    )

    return mapRow(result.rows[0])
  }

  async get(sessionId) {
    if (!sessionId) return null
    const { timestamp, idleCutoff, absoluteCutoff } = this.cutoffs()
    const result = await this.pool.query(
      `UPDATE demo_sessions
       SET last_seen_at = $2
       WHERE id = $1
         AND last_seen_at > $3
         AND created_at > $4
       RETURNING id, player, balance, spins, created_at, last_seen_at`,
      [sessionId, timestamp, idleCutoff, absoluteCutoff],
    )
    return mapRow(result.rows[0])
  }

  async resumeOrCreate({ sessionId, player } = {}) {
    if (sessionId) {
      const { timestamp, idleCutoff, absoluteCutoff } = this.cutoffs()
      const hasPlayer = typeof player === 'string'
      const result = await this.pool.query(
        `UPDATE demo_sessions
         SET player = CASE WHEN $2::boolean THEN $3 ELSE player END,
             last_seen_at = $4
         WHERE id = $1
           AND last_seen_at > $5
           AND created_at > $6
         RETURNING id, player, balance, spins, created_at, last_seen_at`,
        [sessionId, hasPlayer, cleanPlayer(player), timestamp, idleCutoff, absoluteCutoff],
      )

      if (result.rows[0]) {
        return { session: mapRow(result.rows[0]), created: false }
      }
    }

    return { session: await this.create({ player }), created: true }
  }

  async rotate(sessionId) {
    if (!sessionId) return null
    const nextId = token()
    const { timestamp, idleCutoff, absoluteCutoff } = this.cutoffs()
    const result = await this.pool.query(
      `UPDATE demo_sessions
       SET id = $2,
           last_seen_at = $3
       WHERE id = $1
         AND last_seen_at > $4
         AND created_at > $5
       RETURNING id, player, balance, spins, created_at, last_seen_at`,
      [sessionId, nextId, timestamp, idleCutoff, absoluteCutoff],
    )
    return mapRow(result.rows[0])
  }

  async invalidate(sessionId) {
    if (!sessionId) return false
    const result = await this.pool.query(
      'DELETE FROM demo_sessions WHERE id = $1 RETURNING id',
      [sessionId],
    )
    return Boolean(result.rows[0])
  }

  async applySpin(sessionId, { bet, payout }) {
    const { timestamp, idleCutoff, absoluteCutoff } = this.cutoffs()
    const result = await this.pool.query(
      `UPDATE demo_sessions
       SET balance = balance - $2::numeric + $3::numeric,
           spins = spins + 1,
           last_seen_at = $4
       WHERE id = $1
         AND last_seen_at > $5
         AND created_at > $6
         AND balance >= $2::numeric
       RETURNING id, player, balance, spins, created_at, last_seen_at`,
      [sessionId, bet, payout, timestamp, idleCutoff, absoluteCutoff],
    )
    return mapRow(result.rows[0])
  }

  async pruneExpired() {
    const { idleCutoff, absoluteCutoff } = this.cutoffs()
    await this.pool.query(
      'DELETE FROM demo_sessions WHERE last_seen_at <= $1 OR created_at <= $2',
      [idleCutoff, absoluteCutoff],
    )
  }

  async checkReadiness() {
    await this.pool.query('SELECT 1')
    return { ok: true, backend: 'postgres' }
  }

  async ready() {
    await this.checkReadiness()
    return true
  }

  async close() {
    await this.pool.end()
  }
}

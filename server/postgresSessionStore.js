import { randomBytes, randomUUID } from 'node:crypto'
import { runMigrations } from './migrations.js'
import { PostgresLedger } from './postgresLedger.js'

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
    accountId: row.account_id,
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
    metrics = null,
    ledger,
  } = {}) {
    if (!pool) throw new Error('PostgresSessionStore requires a pool')
    this.pool = pool
    this.startingBalance = startingBalance
    this.idleTtlMs = idleTtlMs
    this.absoluteTtlMs = absoluteTtlMs
    this.now = now
    this.metrics = metrics
    this.ledger = ledger || new PostgresLedger({ pool, now })
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

  async deleteExpiredSession(sessionId, idleCutoff, absoluteCutoff) {
    if (!sessionId) return false
    const result = await this.pool.query(
      `DELETE FROM demo_sessions
       WHERE id = $1
         AND (last_seen_at <= $2 OR created_at <= $3)
       RETURNING id`,
      [sessionId, idleCutoff, absoluteCutoff],
    )
    if (result.rowCount > 0) {
      this.metrics?.incrementEvent?.('session.expired', result.rowCount)
      return true
    }
    return false
  }

  async hydrate(row, executor = this.pool) {
    const session = mapRow(row)
    if (!session) return null
    const wallet = await this.ledger.getWallet(executor, session.accountId)
    if (!wallet) throw new Error('Demo session account is missing its DEMO wallet')
    return {
      ...session,
      balance: wallet.balance,
      wallet,
    }
  }

  async create({ player = '' } = {}) {
    const client = await this.pool.connect()
    const timestamp = this.now()

    try {
      await client.query('BEGIN')
      const identity = await this.ledger.createDemoAccount(client, {
        displayName: player,
        startingBalance: this.startingBalance,
      })

      const result = await client.query(
        `INSERT INTO demo_sessions (
           id, account_id, player, balance, spins, created_at, last_seen_at
         ) VALUES ($1, $2, $3, $4, 0, $5, $5)
         RETURNING id, account_id, player, balance, spins, created_at, last_seen_at`,
        [
          token(),
          identity.account.id,
          cleanPlayer(player),
          identity.wallet.balanceExact,
          timestamp,
        ],
      )

      await client.query('COMMIT')
      return {
        ...mapRow(result.rows[0]),
        balance: identity.wallet.balance,
        wallet: identity.wallet,
      }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      throw error
    } finally {
      client.release()
    }
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
       RETURNING id, account_id, player, balance, spins, created_at, last_seen_at`,
      [sessionId, timestamp, idleCutoff, absoluteCutoff],
    )
    if (result.rows[0]) return this.hydrate(result.rows[0])
    await this.deleteExpiredSession(sessionId, idleCutoff, absoluteCutoff)
    return null
  }

  async resumeOrCreate({ sessionId, player } = {}) {
    if (sessionId) {
      const { timestamp, idleCutoff, absoluteCutoff } = this.cutoffs()
      const hasPlayer = typeof player === 'string'
      const cleanedPlayer = cleanPlayer(player)
      const result = await this.pool.query(
        `WITH touched AS (
           UPDATE demo_sessions
           SET player = CASE WHEN $2::boolean THEN $3 ELSE player END,
               last_seen_at = $4
           WHERE id = $1
             AND last_seen_at > $5
             AND created_at > $6
           RETURNING id, account_id, player, balance, spins, created_at, last_seen_at
         ), updated_account AS (
           UPDATE accounts
           SET display_name = $3
           WHERE id = (SELECT account_id FROM touched LIMIT 1)
             AND $2::boolean
           RETURNING id
         )
         SELECT * FROM touched`,
        [sessionId, hasPlayer, cleanedPlayer, timestamp, idleCutoff, absoluteCutoff],
      )

      if (result.rows[0]) {
        return { session: await this.hydrate(result.rows[0]), created: false }
      }
      await this.deleteExpiredSession(sessionId, idleCutoff, absoluteCutoff)
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
       RETURNING id, account_id, player, balance, spins, created_at, last_seen_at`,
      [sessionId, nextId, timestamp, idleCutoff, absoluteCutoff],
    )
    if (result.rows[0]) return this.hydrate(result.rows[0])
    await this.deleteExpiredSession(sessionId, idleCutoff, absoluteCutoff)
    return null
  }

  async invalidate(sessionId) {
    if (!sessionId) return false
    const result = await this.pool.query(
      'DELETE FROM demo_sessions WHERE id = $1 RETURNING id',
      [sessionId],
    )
    return Boolean(result.rows[0])
  }

  async applySpin(sessionId, { bet, payout, spinId = randomUUID(), gameId = 'unknown' }) {
    const client = await this.pool.connect()
    const { timestamp, idleCutoff, absoluteCutoff } = this.cutoffs()

    try {
      await client.query('BEGIN')
      const sessionResult = await client.query(
        `SELECT id, account_id, player, balance, spins, created_at, last_seen_at
         FROM demo_sessions
         WHERE id = $1
           AND last_seen_at > $2
           AND created_at > $3
         FOR UPDATE`,
        [sessionId, idleCutoff, absoluteCutoff],
      )
      const session = sessionResult.rows[0]
      if (!session) {
        await client.query('ROLLBACK')
        await this.deleteExpiredSession(sessionId, idleCutoff, absoluteCutoff)
        return null
      }

      const wallet = await this.ledger.settleDemoGame(client, {
        accountId: session.account_id,
        bet,
        payout,
        spinId,
        gameId,
      })
      if (!wallet) {
        await client.query('ROLLBACK')
        return null
      }

      const updatedResult = await client.query(
        `UPDATE demo_sessions
         SET balance = $2::numeric,
             spins = spins + 1,
             last_seen_at = $3
         WHERE id = $1
         RETURNING id, account_id, player, balance, spins, created_at, last_seen_at`,
        [sessionId, wallet.balanceExact, timestamp],
      )

      await client.query('COMMIT')
      return {
        ...mapRow(updatedResult.rows[0]),
        balance: wallet.balance,
        wallet,
      }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      throw error
    } finally {
      client.release()
    }
  }

  async getWallet(sessionId) {
    const session = await this.get(sessionId)
    return session?.wallet || null
  }

  async pruneExpired() {
    const { idleCutoff, absoluteCutoff } = this.cutoffs()
    const result = await this.pool.query(
      'DELETE FROM demo_sessions WHERE last_seen_at <= $1 OR created_at <= $2',
      [idleCutoff, absoluteCutoff],
    )
    if (result.rowCount > 0) {
      this.metrics?.incrementEvent?.('session.expired', result.rowCount)
    }
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

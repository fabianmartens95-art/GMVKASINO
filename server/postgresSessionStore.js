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
    spins: Number(row.spins),
    createdAt: Number(row.created_at),
    lastSeenAt: Number(row.last_seen_at),
    authRequired: Boolean(row.auth_required),
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
           id, account_id, player, spins, created_at, last_seen_at, auth_required
         ) VALUES ($1, $2, $3, 0, $4, $4, FALSE)
         RETURNING id, account_id, player, spins, created_at, last_seen_at, auth_required`,
        [
          token(),
          identity.account.id,
          cleanPlayer(player),
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

  async createForAccount(accountId) {
    if (!accountId) throw new Error('accountId is required')
    const client = await this.pool.connect()
    const timestamp = this.now()

    try {
      await client.query('BEGIN')
      const accountResult = await client.query(
        `SELECT id, display_name, status
         FROM accounts
         WHERE id = $1
         FOR SHARE`,
        [accountId],
      )
      const account = accountResult.rows[0]
      if (!account || account.status !== 'active') {
        await client.query('ROLLBACK')
        return null
      }

      const wallet = await this.ledger.getWallet(client, accountId)
      if (!wallet) throw new Error('Authenticated account is missing its DEMO wallet')

      const result = await client.query(
        `INSERT INTO demo_sessions (
           id, account_id, player, spins, created_at, last_seen_at, auth_required
         ) VALUES ($1, $2, $3, 0, $4, $4, TRUE)
         RETURNING id, account_id, player, spins, created_at, last_seen_at, auth_required`,
        [token(), accountId, cleanPlayer(account.display_name), timestamp],
      )

      await client.query('COMMIT')
      return {
        ...mapRow(result.rows[0]),
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

  async get(sessionId, { accountId = null } = {}) {
    if (!sessionId) return null
    const { timestamp, idleCutoff, absoluteCutoff } = this.cutoffs()
    const result = await this.pool.query(
      `UPDATE demo_sessions
       SET last_seen_at = $2
       WHERE id = $1
         AND last_seen_at > $3
         AND created_at > $4
         AND (auth_required = FALSE OR ($5::text IS NOT NULL AND account_id = $5))
       RETURNING id, account_id, player, spins, created_at, last_seen_at, auth_required`,
      [sessionId, timestamp, idleCutoff, absoluteCutoff, accountId],
    )
    if (result.rows[0]) return this.hydrate(result.rows[0])
    await this.deleteExpiredSession(sessionId, idleCutoff, absoluteCutoff)
    return null
  }

  async resumeOrCreate({ sessionId, player, accountId = null } = {}) {
    if (sessionId) {
      const { timestamp, idleCutoff, absoluteCutoff } = this.cutoffs()
      const hasPlayer = !accountId && typeof player === 'string'
      const cleanedPlayer = cleanPlayer(player)
      const result = await this.pool.query(
        `WITH touched AS (
           UPDATE demo_sessions
           SET player = CASE WHEN $2::boolean THEN $3 ELSE player END,
               last_seen_at = $4
           WHERE id = $1
             AND last_seen_at > $5
             AND created_at > $6
             AND (auth_required = FALSE OR ($7::text IS NOT NULL AND account_id = $7))
           RETURNING id, account_id, player, spins, created_at, last_seen_at, auth_required
         ), updated_account AS (
           UPDATE accounts
           SET display_name = $3
           WHERE id = (SELECT account_id FROM touched LIMIT 1)
             AND $2::boolean
           RETURNING id
         )
         SELECT * FROM touched`,
        [sessionId, hasPlayer, cleanedPlayer, timestamp, idleCutoff, absoluteCutoff, accountId],
      )

      if (result.rows[0]) {
        return { session: await this.hydrate(result.rows[0]), created: false }
      }
      await this.deleteExpiredSession(sessionId, idleCutoff, absoluteCutoff)
    }

    const session = accountId
      ? await this.createForAccount(accountId)
      : await this.create({ player })
    return { session, created: true }
  }

  async rotate(sessionId, { accountId = null } = {}) {
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
         AND (auth_required = FALSE OR ($6::text IS NOT NULL AND account_id = $6))
       RETURNING id, account_id, player, spins, created_at, last_seen_at, auth_required`,
      [sessionId, nextId, timestamp, idleCutoff, absoluteCutoff, accountId],
    )
    if (result.rows[0]) return this.hydrate(result.rows[0])
    await this.deleteExpiredSession(sessionId, idleCutoff, absoluteCutoff)
    return null
  }

  async invalidate(sessionId, { accountId = null } = {}) {
    if (!sessionId) return false
    const result = await this.pool.query(
      `DELETE FROM demo_sessions
       WHERE id = $1
         AND (auth_required = FALSE OR ($2::text IS NOT NULL AND account_id = $2))
       RETURNING id`,
      [sessionId, accountId],
    )
    return Boolean(result.rows[0])
  }

  async applySpin(sessionId, { bet, payout, spinId = randomUUID(), gameId = 'unknown', accountId = null }) {
    const client = await this.pool.connect()
    const { timestamp, idleCutoff, absoluteCutoff } = this.cutoffs()

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
         SET spins = spins + 1,
             last_seen_at = $2
         WHERE id = $1
         RETURNING id, account_id, player, spins, created_at, last_seen_at, auth_required`,
        [sessionId, timestamp],
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

  async getWallet(sessionId, { accountId = null } = {}) {
    const session = await this.get(sessionId, { accountId })
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

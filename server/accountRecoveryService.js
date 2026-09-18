import { createHash, randomBytes, randomUUID } from 'node:crypto'

const TOKEN_BYTES = 32
const DEFAULT_TTL_MS = 30 * 60 * 1000

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex')
}

function normalizeAccountId(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 128) {
    throw new AccountRecoveryError(400, 'INVALID_ACCOUNT_ID', 'Account ID is required')
  }
  return value.trim()
}

function normalizeRawToken(value) {
  if (typeof value !== 'string' || value.length < 32 || value.length > 128) {
    throw new AccountRecoveryError(400, 'INVALID_RECOVERY_TOKEN', 'Recovery token is invalid')
  }
  return value
}

export class AccountRecoveryError extends Error {
  constructor(status, code, message) {
    super(message)
    this.name = 'AccountRecoveryError'
    this.status = status
    this.code = code
  }
}

export class AccountRecoveryService {
  constructor({ pool, now = Date.now, ttlMs = DEFAULT_TTL_MS } = {}) {
    if (!pool) throw new Error('AccountRecoveryService requires a pool')
    if (!Number.isInteger(ttlMs) || ttlMs < 60_000 || ttlMs > 24 * 60 * 60 * 1000) {
      throw new Error('AccountRecoveryService ttlMs must be between 1 minute and 24 hours')
    }
    this.pool = pool
    this.now = now
    this.ttlMs = ttlMs
  }

  async issueForAccount({ accountId, requestId = null } = {}) {
    const normalizedAccountId = normalizeAccountId(accountId)
    const timestamp = this.now()
    const expiresAt = timestamp + this.ttlMs
    const token = randomBytes(TOKEN_BYTES).toString('base64url')
    const tokenHash = hashToken(token)
    const client = await this.pool.connect()

    try {
      await client.query('BEGIN')
      const account = await client.query(
        `SELECT id, status, email
         FROM accounts
         WHERE id = $1
         FOR UPDATE`,
        [normalizedAccountId],
      )
      const row = account.rows[0]
      if (!row || row.status !== 'active' || !row.email) {
        throw new AccountRecoveryError(409, 'RECOVERY_UNAVAILABLE', 'Account recovery is unavailable')
      }

      await client.query(
        `UPDATE account_recovery_tokens
         SET invalidated_at = $2
         WHERE account_id = $1
           AND consumed_at IS NULL
           AND invalidated_at IS NULL`,
        [normalizedAccountId, timestamp],
      )

      const id = randomUUID()
      await client.query(
        `INSERT INTO account_recovery_tokens (
           id, account_id, token_hash, request_id,
           created_at, expires_at, consumed_at, invalidated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, NULL, NULL)`,
        [id, normalizedAccountId, tokenHash, requestId, timestamp, expiresAt],
      )
      await client.query('COMMIT')

      return {
        id,
        accountId: normalizedAccountId,
        token,
        expiresAt,
      }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      throw error
    } finally {
      client.release()
    }
  }

  async consume({ token, executor = this.pool } = {}) {
    const rawToken = normalizeRawToken(token)
    const timestamp = this.now()
    const result = await executor.query(
      `UPDATE account_recovery_tokens recovery
       SET consumed_at = $2
       FROM accounts account
       WHERE recovery.token_hash = $1
         AND recovery.account_id = account.id
         AND recovery.consumed_at IS NULL
         AND recovery.invalidated_at IS NULL
         AND recovery.expires_at > $2
         AND account.status = 'active'
       RETURNING recovery.id, recovery.account_id`,
      [hashToken(rawToken), timestamp],
    )
    const row = result.rows[0]
    if (!row) {
      throw new AccountRecoveryError(410, 'RECOVERY_TOKEN_UNAVAILABLE', 'Recovery token is expired, invalid, or already used')
    }

    return {
      id: row.id,
      accountId: row.account_id,
      consumedAt: timestamp,
    }
  }
}

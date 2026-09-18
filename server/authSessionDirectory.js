import { createHash } from 'node:crypto'

export class AuthSessionDirectoryError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'AuthSessionDirectoryError'
    this.code = code
    this.status = 400
  }
}

function opaqueRef(value) {
  return createHash('sha256').update(String(value)).digest('hex').slice(0, 16)
}

function normalizeLimit(value) {
  if (value === undefined || value === null || value === '') return 25
  const limit = Number(value)
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new AuthSessionDirectoryError(
      'INVALID_SESSION_LIMIT',
      'Session list limit must be an integer between 1 and 100',
    )
  }
  return limit
}

export class AuthSessionDirectory {
  constructor({ pool, now = Date.now, idleTtlMs = 86_400_000 } = {}) {
    if (!pool) throw new Error('AuthSessionDirectory requires a pool')
    if (!Number.isInteger(idleTtlMs) || idleTtlMs <= 0) {
      throw new Error('AuthSessionDirectory idleTtlMs must be a positive integer')
    }
    this.pool = pool
    this.now = now
    this.idleTtlMs = idleTtlMs
  }

  async list({ accountId, limit } = {}) {
    if (typeof accountId !== 'string' || !accountId.trim() || accountId.length > 128) {
      throw new AuthSessionDirectoryError('INVALID_ACCOUNT_ID', 'Target account ID is invalid')
    }
    const safeLimit = normalizeLimit(limit)
    const result = await this.pool.query(
      `SELECT id, created_at, last_seen_at, expires_at, revoked_at
       FROM auth_sessions
       WHERE account_id = $1
       ORDER BY created_at DESC, id DESC
       LIMIT $2`,
      [accountId.trim(), safeLimit],
    )

    const now = Number(this.now())
    const idleCutoff = now - this.idleTtlMs
    return result.rows.map((row) => {
      const revokedAt = row.revoked_at === null || row.revoked_at === undefined
        ? null
        : Number(row.revoked_at)
      const expiresAt = Number(row.expires_at)
      const lastSeenAt = Number(row.last_seen_at)
      const state = revokedAt !== null
        ? 'revoked'
        : expiresAt <= now || lastSeenAt <= idleCutoff
          ? 'expired'
          : 'active'

      return {
        sessionRef: opaqueRef(row.id),
        state,
        createdAt: Number(row.created_at),
        lastSeenAt,
        expiresAt,
        revokedAt,
      }
    })
  }
}

export function opaqueAccountRef(accountId) {
  return opaqueRef(accountId)
}

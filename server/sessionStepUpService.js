import { createHash } from 'node:crypto'
import { normalizeSessionAssurance } from './sessionAssurance.js'

const ASSURANCE_RANK = Object.freeze({
  base: 0,
  verified_email: 1,
  mfa: 2,
})

function tokenHash(token) {
  return createHash('sha256').update(token).digest('hex')
}

function opaqueRef(value) {
  return createHash('sha256').update(String(value)).digest('hex').slice(0, 16)
}

export class SessionStepUpError extends Error {
  constructor(status, code, message) {
    super(message)
    this.name = 'SessionStepUpError'
    this.status = status
    this.code = code
  }
}

function normalizeTarget(value) {
  if (value !== 'verified_email' && value !== 'mfa') {
    throw new SessionStepUpError(400, 'INVALID_STEP_UP_TARGET', 'Step-up target is invalid')
  }
  return value
}

export class SessionStepUpService {
  constructor({
    pool,
    verifier,
    auditLog = null,
    now = Date.now,
    idleTtlMs = 86_400_000,
  } = {}) {
    if (!pool) throw new Error('SessionStepUpService requires a pool')
    if (!verifier || typeof verifier.verify !== 'function') {
      throw new Error('SessionStepUpService requires a trusted verifier')
    }
    if (!Number.isInteger(idleTtlMs) || idleTtlMs <= 0) {
      throw new Error('SessionStepUpService idleTtlMs must be a positive integer')
    }
    this.pool = pool
    this.verifier = verifier
    this.auditLog = auditLog
    this.now = now
    this.idleTtlMs = idleTtlMs
  }

  async verifyAndUpgrade({ token, proof, requestId = null } = {}) {
    if (typeof token !== 'string' || token.length < 40 || token.length > 128) {
      throw new SessionStepUpError(401, 'AUTH_SESSION_REQUIRED', 'Authentication session is missing or expired')
    }

    const timestamp = Number(this.now())
    const idleCutoff = timestamp - this.idleTtlMs
    const client = await this.pool.connect()

    try {
      await client.query('BEGIN')
      const result = await client.query(
        `SELECT
           s.id,
           s.account_id,
           s.assurance_level,
           s.assurance_at,
           a.status,
           a.email_verified_at,
           a.mfa_enrolled_at
         FROM auth_sessions s
         JOIN accounts a ON a.id = s.account_id
         WHERE s.token_hash = $1
           AND s.revoked_at IS NULL
           AND s.last_seen_at > $2
           AND s.expires_at > $3
         FOR UPDATE OF s`,
        [tokenHash(token), idleCutoff, timestamp],
      )

      const row = result.rows[0]
      if (!row || row.status !== 'active') {
        throw new SessionStepUpError(401, 'AUTH_SESSION_REQUIRED', 'Authentication session is missing or expired')
      }

      const current = normalizeSessionAssurance({
        level: row.assurance_level,
        verifiedAt: row.assurance_at,
      })

      const verification = await this.verifier.verify({
        accountId: row.account_id,
        currentAssurance: current,
        proof,
        requestId,
      })

      if (!verification || verification.verified !== true) {
        throw new SessionStepUpError(401, 'STEP_UP_VERIFICATION_FAILED', 'Step-up verification failed')
      }

      const target = normalizeTarget(verification.assurance)

      if (target === 'verified_email' && row.email_verified_at === null) {
        throw new SessionStepUpError(409, 'EMAIL_NOT_VERIFIED', 'Verified email assurance is unavailable')
      }
      if (
        target === 'mfa'
        && (row.email_verified_at === null || row.mfa_enrolled_at === null)
      ) {
        throw new SessionStepUpError(409, 'MFA_NOT_READY', 'MFA assurance is unavailable')
      }

      const currentRank = ASSURANCE_RANK[current.level] ?? 0
      const targetRank = ASSURANCE_RANK[target]
      if (targetRank < currentRank) {
        throw new SessionStepUpError(409, 'ASSURANCE_DOWNGRADE_REJECTED', 'Session assurance cannot be downgraded')
      }

      const upgraded = await client.query(
        `UPDATE auth_sessions
         SET assurance_level = $2,
             assurance_at = $3,
             last_seen_at = $3
         WHERE id = $1
         RETURNING assurance_level, assurance_at, expires_at`,
        [row.id, target, timestamp],
      )

      await client.query('COMMIT')

      const assurance = Object.freeze({
        level: upgraded.rows[0].assurance_level,
        verifiedAt: Number(upgraded.rows[0].assurance_at),
      })
      this.auditLog?.record?.('auth.session_step_up', {
        requestId,
        accountRef: opaqueRef(row.account_id),
        authSessionRef: opaqueRef(row.id),
        assurance: assurance.level,
      })

      return {
        assurance,
        expiresAt: Number(upgraded.rows[0].expires_at),
      }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      throw error
    } finally {
      client.release()
    }
  }
}

import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto'
import { promisify } from 'node:util'
import { PostgresLedger } from './postgresLedger.js'
import { normalizeAccountRoles } from './accessControl.js'

const scrypt = promisify(scryptCallback)
const PASSWORD_SCHEME = 'scrypt-v1'
const PASSWORD_KEY_BYTES = 64
const PASSWORD_SALT_BYTES = 16
const TOKEN_BYTES = 32
const DUMMY_SALT = Buffer.alloc(PASSWORD_SALT_BYTES, 0x5a)
const DUMMY_HASH = Buffer.alloc(PASSWORD_KEY_BYTES, 0xa5)
const SCRYPT_OPTIONS = Object.freeze({ N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })

export class AccountAuthError extends Error {
  constructor(status, code, message) {
    super(message)
    this.name = 'AccountAuthError'
    this.status = status
    this.code = code
  }
}

function cleanDisplayName(value) {
  return typeof value === 'string' ? value.trim().slice(0, 40) : ''
}

function normalizeEmail(value) {
  if (typeof value !== 'string') {
    throw new AccountAuthError(400, 'INVALID_EMAIL', 'A valid email address is required')
  }
  const email = value.trim().toLowerCase()
  if (
    email.length < 3
    || email.length > 254
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    throw new AccountAuthError(400, 'INVALID_EMAIL', 'A valid email address is required')
  }
  return email
}

function validatePassword(password) {
  if (typeof password !== 'string') {
    throw new AccountAuthError(400, 'INVALID_PASSWORD', 'Password must be between 12 and 128 characters')
  }
  const bytes = Buffer.byteLength(password, 'utf8')
  if (password.length < 12 || password.length > 128 || bytes > 256) {
    throw new AccountAuthError(400, 'INVALID_PASSWORD', 'Password must be between 12 and 128 characters')
  }
  return password
}

async function derivePassword(password, salt) {
  return scrypt(password, salt, PASSWORD_KEY_BYTES, SCRYPT_OPTIONS)
}

function tokenHash(token) {
  return createHash('sha256').update(token).digest('hex')
}

function accountSnapshot(row, roles = []) {
  if (!row) return null
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name || '',
    status: row.status,
    roles: normalizeAccountRoles(roles),
    createdAt: Number(row.created_at),
    updatedAt: row.updated_at === null || row.updated_at === undefined
      ? null
      : Number(row.updated_at),
  }
}

async function accountRoles(executor, accountId) {
  const result = await executor.query(
    `SELECT role
     FROM account_roles
     WHERE account_id = $1
     ORDER BY role`,
    [accountId],
  )
  return normalizeAccountRoles(result.rows.map((row) => row.role))
}

async function accountSnapshotWithRoles(executor, row) {
  if (!row) return null
  return accountSnapshot(row, await accountRoles(executor, row.id))
}

export class AccountAuthService {
  constructor({
    pool,
    ledger,
    startingBalance = 1000,
    idleTtlMs = 86_400_000,
    absoluteTtlMs = 604_800_000,
    now = Date.now,
  } = {}) {
    if (!pool) throw new Error('AccountAuthService requires a pool')
    this.pool = pool
    this.ledger = ledger || new PostgresLedger({ pool, now })
    this.startingBalance = startingBalance
    this.idleTtlMs = idleTtlMs
    this.absoluteTtlMs = absoluteTtlMs
    this.now = now
  }

  async createAuthSession(executor, accountId) {
    const timestamp = this.now()
    const token = randomBytes(TOKEN_BYTES).toString('base64url')
    const expiresAt = timestamp + this.absoluteTtlMs

    await executor.query(
      `INSERT INTO auth_sessions (
         id, account_id, token_hash, created_at, last_seen_at, expires_at, revoked_at
       ) VALUES ($1, $2, $3, $4, $4, $5, NULL)`,
      [randomUUID(), accountId, tokenHash(token), timestamp, expiresAt],
    )

    return { token, expiresAt }
  }

  async register({ email, password, displayName = '' } = {}) {
    const normalizedEmail = normalizeEmail(email)
    const validPassword = validatePassword(password)
    const salt = randomBytes(PASSWORD_SALT_BYTES)
    const passwordHash = await derivePassword(validPassword, salt)
    const client = await this.pool.connect()

    try {
      await client.query('BEGIN')
      const identity = await this.ledger.createDemoAccount(client, {
        displayName: cleanDisplayName(displayName),
        startingBalance: this.startingBalance,
      })
      const timestamp = this.now()

      const accountResult = await client.query(
        `UPDATE accounts
         SET email = $2,
             password_scheme = $3,
             password_salt = $4,
             password_hash = $5,
             updated_at = $6
         WHERE id = $1
         RETURNING id, email, display_name, status, created_at, updated_at`,
        [
          identity.account.id,
          normalizedEmail,
          PASSWORD_SCHEME,
          salt,
          passwordHash,
          timestamp,
        ],
      )

      const account = await accountSnapshotWithRoles(client, accountResult.rows[0])
      const auth = await this.createAuthSession(client, identity.account.id)
      await client.query('COMMIT')

      return {
        account,
        wallet: identity.wallet,
        auth,
      }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      if (error?.code === '23505') {
        throw new AccountAuthError(409, 'EMAIL_ALREADY_REGISTERED', 'An account with this email already exists')
      }
      throw error
    } finally {
      client.release()
    }
  }

  async upgradeGuest({ accountId, sessionId, email, password, displayName } = {}) {
    if (!accountId || !sessionId) {
      throw new AccountAuthError(409, 'GUEST_UPGRADE_UNAVAILABLE', 'Guest session cannot be upgraded')
    }

    const normalizedEmail = normalizeEmail(email)
    const validPassword = validatePassword(password)
    const salt = randomBytes(PASSWORD_SALT_BYTES)
    const passwordHash = await derivePassword(validPassword, salt)
    const hasDisplayName = typeof displayName === 'string' && displayName.trim().length > 0
    const cleanedDisplayName = cleanDisplayName(displayName)
    const client = await this.pool.connect()

    try {
      await client.query('BEGIN')
      const existing = await client.query(
        `SELECT id, email, display_name, status, created_at, updated_at,
                password_scheme, password_salt, password_hash
         FROM accounts
         WHERE id = $1
         FOR UPDATE`,
        [accountId],
      )
      const row = existing.rows[0]
      if (!row) {
        throw new AccountAuthError(409, 'GUEST_UPGRADE_UNAVAILABLE', 'Guest account cannot be upgraded')
      }
      if (row.status !== 'active') {
        throw new AccountAuthError(403, 'ACCOUNT_DISABLED', 'Account is disabled')
      }
      if (row.email || row.password_scheme || row.password_salt || row.password_hash) {
        throw new AccountAuthError(409, 'ACCOUNT_ALREADY_REGISTERED', 'Account already has credentials')
      }

      const protectedSession = await client.query(
        `UPDATE demo_sessions
         SET auth_required = TRUE,
             player = CASE WHEN $3::boolean THEN $4 ELSE player END
         WHERE id = $1
           AND account_id = $2
           AND auth_required = FALSE
         RETURNING id`,
        [sessionId, accountId, hasDisplayName, cleanedDisplayName],
      )
      if (!protectedSession.rows[0]) {
        throw new AccountAuthError(409, 'GUEST_UPGRADE_UNAVAILABLE', 'Guest account cannot be upgraded')
      }

      const timestamp = this.now()
      const accountResult = await client.query(
        `UPDATE accounts
         SET email = $2,
             display_name = CASE WHEN $7::boolean THEN $8 ELSE display_name END,
             password_scheme = $3,
             password_salt = $4,
             password_hash = $5,
             updated_at = $6
         WHERE id = $1
         RETURNING id, email, display_name, status, created_at, updated_at`,
        [
          accountId,
          normalizedEmail,
          PASSWORD_SCHEME,
          salt,
          passwordHash,
          timestamp,
          hasDisplayName,
          cleanedDisplayName,
        ],
      )
      const account = await accountSnapshotWithRoles(client, accountResult.rows[0])
      const wallet = await this.ledger.getWallet(client, accountId)
      if (!wallet) throw new Error('Guest account is missing its DEMO wallet')
      const auth = await this.createAuthSession(client, accountId)
      await client.query('COMMIT')

      return {
        account,
        wallet,
        auth,
        upgraded: true,
      }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      if (error?.code === '23505') {
        throw new AccountAuthError(409, 'EMAIL_ALREADY_REGISTERED', 'An account with this email already exists')
      }
      throw error
    } finally {
      client.release()
    }
  }

  async login({ email, password } = {}) {
    const normalizedEmail = normalizeEmail(email)
    const validPassword = validatePassword(password)
    const result = await this.pool.query(
      `SELECT id, email, display_name, status, created_at, updated_at,
              password_scheme, password_salt, password_hash
       FROM accounts
       WHERE email = $1`,
      [normalizedEmail],
    )
    const row = result.rows[0]

    const salt = row?.password_salt || DUMMY_SALT
    const expectedHash = row?.password_hash || DUMMY_HASH
    const derived = await derivePassword(validPassword, salt)
    const valid = Buffer.isBuffer(expectedHash)
      && expectedHash.length === derived.length
      && timingSafeEqual(expectedHash, derived)

    if (!row || row.password_scheme !== PASSWORD_SCHEME || !valid) {
      throw new AccountAuthError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect')
    }
    if (row.status !== 'active') {
      throw new AccountAuthError(403, 'ACCOUNT_DISABLED', 'Account is disabled')
    }

    const account = await accountSnapshotWithRoles(this.pool, row)
    const auth = await this.createAuthSession(this.pool, row.id)
    const wallet = await this.ledger.getWallet(this.pool, row.id)
    if (!wallet) throw new Error('Authenticated account is missing its DEMO wallet')

    return {
      account,
      wallet,
      auth,
    }
  }

  async authenticate(token) {
    if (typeof token !== 'string' || token.length < 40 || token.length > 128) return null
    const timestamp = this.now()
    const idleCutoff = timestamp - this.idleTtlMs
    const result = await this.pool.query(
      `WITH touched AS (
         UPDATE auth_sessions
         SET last_seen_at = $2
         WHERE token_hash = $1
           AND revoked_at IS NULL
           AND last_seen_at > $3
           AND expires_at > $2
         RETURNING account_id, expires_at
       )
       SELECT a.id, a.email, a.display_name, a.status, a.created_at, a.updated_at,
              touched.expires_at
       FROM touched
       JOIN accounts a ON a.id = touched.account_id
       WHERE a.status = 'active'`,
      [tokenHash(token), timestamp, idleCutoff],
    )
    const row = result.rows[0]
    if (!row) return null
    return {
      account: await accountSnapshotWithRoles(this.pool, row),
      expiresAt: Number(row.expires_at),
    }
  }

  async profile(token) {
    const authenticated = await this.authenticate(token)
    if (!authenticated) return null
    const wallet = await this.ledger.getWallet(this.pool, authenticated.account.id)
    if (!wallet) throw new Error('Authenticated account is missing its DEMO wallet')
    return { ...authenticated, wallet }
  }

  async logout(token) {
    if (typeof token !== 'string' || token.length < 40 || token.length > 128) return false
    const result = await this.pool.query(
      `UPDATE auth_sessions
       SET revoked_at = $2
       WHERE token_hash = $1
         AND revoked_at IS NULL
       RETURNING id`,
      [tokenHash(token), this.now()],
    )
    return Boolean(result.rows[0])
  }

  async pruneExpired() {
    const timestamp = this.now()
    const idleCutoff = timestamp - this.idleTtlMs
    const result = await this.pool.query(
      `DELETE FROM auth_sessions
       WHERE revoked_at IS NOT NULL
          OR expires_at <= $1
          OR last_seen_at <= $2`,
      [timestamp, idleCutoff],
    )
    return result.rowCount
  }
}

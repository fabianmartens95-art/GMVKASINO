import { createHash } from 'node:crypto'
import { decimalToAtomic } from './amounts.js'

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

export function normalizeIdempotencyKey(value) {
  if (typeof value !== 'string') return ''
  const normalized = value.trim()
  return IDEMPOTENCY_KEY_PATTERN.test(normalized) ? normalized : ''
}

export function idempotencyRef(value) {
  const normalized = normalizeIdempotencyKey(value)
  return normalized ? sha256(normalized).slice(0, 16) : null
}

export function createGameRoundFingerprint({
  accountId = '',
  sessionId,
  gameId,
  bet,
  assetCode = 'DEMO',
  decimals = 2,
} = {}) {
  if (!sessionId) throw new Error('sessionId is required for game-round fingerprinting')
  if (!gameId) throw new Error('gameId is required for game-round fingerprinting')

  const sessionRef = sha256(String(sessionId)).slice(0, 32)
  const betAtomic = decimalToAtomic(bet, decimals)
  const canonical = JSON.stringify({
    version: 1,
    accountId: String(accountId || ''),
    sessionRef,
    gameId: String(gameId),
    assetCode: String(assetCode),
    betAtomic,
  })

  return {
    fingerprint: sha256(canonical),
    sessionRef,
    betAtomic,
  }
}

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createGameRoundFingerprint,
  idempotencyRef,
  normalizeIdempotencyKey,
} from '../server/gameRound.js'

test('idempotency keys are normalized and constrained', () => {
  assert.equal(normalizeIdempotencyKey('  spin-12345678  '), 'spin-12345678')
  assert.equal(normalizeIdempotencyKey('short'), '')
  assert.equal(normalizeIdempotencyKey('spin key with spaces'), '')
  assert.equal(normalizeIdempotencyKey('x'.repeat(129)), '')
})

test('game round fingerprint is stable, exact and does not expose the session token', () => {
  const input = {
    accountId: 'account-1',
    sessionId: 'raw-session-token-that-must-not-be-stored',
    gameId: 'golden-vault',
    bet: 1,
    assetCode: 'DEMO',
    decimals: 2,
  }

  const first = createGameRoundFingerprint(input)
  const second = createGameRoundFingerprint(input)
  const changedBet = createGameRoundFingerprint({ ...input, bet: 2 })
  const changedSession = createGameRoundFingerprint({ ...input, sessionId: 'another-session-token' })

  assert.equal(first.fingerprint, second.fingerprint)
  assert.equal(first.betAtomic, '100')
  assert.equal(first.sessionRef.length, 32)
  assert.notEqual(first.sessionRef, input.sessionId)
  assert.notEqual(first.fingerprint, changedBet.fingerprint)
  assert.notEqual(first.fingerprint, changedSession.fingerprint)
})

test('audit idempotency reference is stable and never contains the raw key', () => {
  const key = 'spin-super-secret-retry-key'
  const ref = idempotencyRef(key)

  assert.equal(ref, idempotencyRef(key))
  assert.equal(ref.length, 16)
  assert.equal(ref.includes(key), false)
})

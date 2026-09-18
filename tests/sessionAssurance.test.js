import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeSessionAssurance,
  sessionMeetsAssurance,
} from '../server/sessionAssurance.js'

test('session assurance defaults fail closed to base', () => {
  assert.deepEqual(normalizeSessionAssurance(null), {
    level: 'base',
    verifiedAt: null,
  })
  assert.equal(sessionMeetsAssurance(null, 'base'), true)
  assert.equal(sessionMeetsAssurance(null, 'mfa'), false)
})

test('elevated session assurance requires a verification timestamp', () => {
  assert.equal(
    sessionMeetsAssurance({ level: 'mfa', verifiedAt: null }, 'mfa'),
    false,
  )
  assert.equal(
    sessionMeetsAssurance({ level: 'mfa', verifiedAt: 1234 }, 'mfa'),
    true,
  )
  assert.equal(
    sessionMeetsAssurance({ level: 'verified_email', verifiedAt: 1234 }, 'mfa'),
    false,
  )
})

test('unknown required assurance defaults to strongest level', () => {
  assert.equal(
    sessionMeetsAssurance({ level: 'verified_email', verifiedAt: 1234 }, 'future_level'),
    false,
  )
  assert.equal(
    sessionMeetsAssurance({ level: 'mfa', verifiedAt: 1234 }, 'future_level'),
    true,
  )
})

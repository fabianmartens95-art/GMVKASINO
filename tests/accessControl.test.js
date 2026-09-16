import test from 'node:test'
import assert from 'node:assert/strict'
import {
  accessContext,
  anyRoleHasCapability,
  normalizeAccountRoles,
} from '../server/accessControl.js'

test('account roles are normalized and de-duplicated', () => {
  assert.deepEqual(
    normalizeAccountRoles(['support', 'player', 'support', 'unknown']),
    ['player', 'support'],
  )
})

test('role capabilities are deny-by-default and admin can access every capability', () => {
  assert.equal(anyRoleHasCapability(['player'], 'casino.play'), true)
  assert.equal(anyRoleHasCapability(['player'], 'ledger.read'), false)
  assert.equal(anyRoleHasCapability([], 'casino.play'), false)
  assert.equal(anyRoleHasCapability(['admin'], 'future.capability'), true)
})

test('access context exposes the effective role and capability set', () => {
  assert.deepEqual(accessContext({ roles: ['finance', 'player'] }), {
    roles: ['finance', 'player'],
    capabilities: ['casino.play', 'ledger.read', 'profile.read', 'reconciliation.read', 'wallet.read'],
  })
})

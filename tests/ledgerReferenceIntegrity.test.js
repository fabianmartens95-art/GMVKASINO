import test from 'node:test'
import assert from 'node:assert/strict'
import { validateLedgerReference } from '../server/ledgerReferenceIntegrity.js'

test('semantic ledger references accept current authoritative transaction patterns', () => {
  assert.deepEqual(validateLedgerReference({
    type: 'GAME_SETTLEMENT',
    reference_type: 'spin',
    reference_id: 'spin-1',
    idempotency_key: 'spin:spin-1',
  }), [])
  assert.deepEqual(validateLedgerReference({
    type: 'SANDBOX_WITHDRAWAL_RESERVE',
    reference_type: 'payment_operation',
    reference_id: 'payment-1',
    idempotency_key: 'sandbox-withdrawal:payment-1:reserve',
  }), [])
})

test('semantic ledger references fail closed on malformed type/reference/idempotency pairings', () => {
  const issues = validateLedgerReference({
    type: 'SANDBOX_DEPOSIT',
    reference_type: 'spin',
    reference_id: 'payment-1',
    idempotency_key: 'something-else',
  })
  assert.deepEqual(issues.map((item) => item.code), [
    'reference_type_mismatch',
    'idempotency_reference_mismatch',
  ])

  assert.deepEqual(validateLedgerReference({
    type: 'GAME_SETTLEMENT',
    reference_type: 'spin',
    reference_id: null,
    idempotency_key: null,
  }), [{ code: 'reference_id_missing' }])
})

test('unclassified ledger transaction types are left to their own domain contract', () => {
  assert.deepEqual(validateLedgerReference({
    type: 'FUTURE_ADJUSTMENT',
    reference_type: null,
    reference_id: null,
    idempotency_key: null,
  }), [])
})

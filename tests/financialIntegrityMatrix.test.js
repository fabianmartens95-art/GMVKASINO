import test from 'node:test'
import assert from 'node:assert/strict'
import {
  FINANCIAL_MUTATION_CONTROLS,
  FinancialIntegrityMatrixError,
  getFinancialMutationControls,
  validateFinancialIntegrityMatrix,
} from '../server/financialIntegrityMatrix.js'

test('financial integrity matrix covers every planned money-like mutation class', () => {
  const report = validateFinancialIntegrityMatrix()
  assert.equal(report.ok, true)
  assert.deepEqual(report.mutationTypes, [
    'adjustment',
    'bonus',
    'deposit',
    'fee',
    'payout',
    'refund',
    'reversal',
    'wager',
    'withdrawal',
  ])

  for (const type of report.mutationTypes) {
    const controls = getFinancialMutationControls(type)
    assert.equal(controls.ledgerBacked, true)
    assert.equal(controls.idempotent, true)
    assert.equal(controls.audited, true)
    assert.equal(controls.reconciled, true)
    assert.equal(controls.capabilityBound, true)
    assert.equal(controls.concurrencySafe, true)
    assert.ok(controls.requiredCapability)
  }
})

test('unknown financial mutation classes fail closed', () => {
  assert.throws(
    () => getFinancialMutationControls('mystery-credit'),
    (error) => error instanceof FinancialIntegrityMatrixError
      && error.code === 'UNKNOWN_FINANCIAL_MUTATION',
  )
})

test('matrix validator rejects any mutation class missing a required control', () => {
  const unsafe = {
    ...FINANCIAL_MUTATION_CONTROLS,
    deposit: {
      ...FINANCIAL_MUTATION_CONTROLS.deposit,
      reconciled: false,
    },
  }

  assert.throws(
    () => validateFinancialIntegrityMatrix(unsafe),
    (error) => error instanceof FinancialIntegrityMatrixError
      && error.code === 'INCOMPLETE_FINANCIAL_CONTROLS'
      && error.violations.some((violation) => (
        violation.type === 'deposit' && violation.control === 'reconciled'
      )),
  )
})

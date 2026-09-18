import test from 'node:test'
import assert from 'node:assert/strict'
import {
  AUTH_ASSURANCE,
  StepUpPolicyError,
  evaluateStepUpRequirement,
  requiredAssuranceForCapability,
} from '../server/stepUpPolicy.js'

test('read-only baseline capabilities can remain on base authentication', () => {
  assert.equal(requiredAssuranceForCapability('operations.read'), AUTH_ASSURANCE.BASE)
  assert.deepEqual(
    evaluateStepUpRequirement({ emailVerified: false, mfaEnrolled: false }, 'operations.read'),
    {
      capability: 'operations.read',
      requiredAssurance: 'base',
      satisfied: true,
      missing: [],
    },
  )
})

test('sensitive read capabilities require verified email', () => {
  const missing = evaluateStepUpRequirement(
    { emailVerified: false, mfaEnrolled: false },
    'ledger.read',
  )
  assert.equal(missing.satisfied, false)
  assert.deepEqual(missing.missing, ['verified_email'])

  const satisfied = evaluateStepUpRequirement(
    { emailVerified: true, mfaEnrolled: false },
    'ledger.read',
  )
  assert.equal(satisfied.satisfied, true)
})

test('privileged financial/risk mutations require verified email plus MFA', () => {
  const partial = evaluateStepUpRequirement(
    { emailVerified: true, mfaEnrolled: false },
    'payments.sandbox.manage',
  )
  assert.equal(partial.requiredAssurance, AUTH_ASSURANCE.MFA)
  assert.equal(partial.satisfied, false)
  assert.deepEqual(partial.missing, ['mfa'])

  const complete = evaluateStepUpRequirement(
    { emailVerified: true, mfaEnrolled: true },
    'payments.sandbox.manage',
  )
  assert.equal(complete.satisfied, true)
})

test('unknown capabilities fail closed to strongest assurance', () => {
  assert.equal(requiredAssuranceForCapability('future.admin.write'), AUTH_ASSURANCE.MFA)
  const result = evaluateStepUpRequirement({}, 'future.admin.write')
  assert.equal(result.satisfied, false)
  assert.deepEqual(result.missing, ['verified_email', 'mfa'])
})

test('empty capability names are rejected', () => {
  assert.throws(
    () => requiredAssuranceForCapability('  '),
    (error) => error instanceof StepUpPolicyError && error.code === 'INVALID_CAPABILITY',
  )
})

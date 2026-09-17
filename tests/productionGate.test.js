import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluateProductionGate } from '../scripts/evaluate-production-gate.mjs'
import { verifyProductionRevision } from '../scripts/verify-production-revision.mjs'

const policy = {
  defaultDecision: 'BLOCK',
  requiredStatuses: [
    { id: 'ci', env: 'GATE_CI_STATUS', expected: 'passed' },
    { id: 'compliance', env: 'GATE_COMPLIANCE_STATUS', expected: 'approved' },
  ],
  requiredEvidence: [
    { id: 'compliance', env: 'GATE_COMPLIANCE_EVIDENCE', minLength: 8 },
  ],
  conditionalStatuses: [
    {
      id: 'deposit_idempotency',
      conditionEnv: 'GATE_PAYMENT_DOMAIN_INTRODUCED',
      conditionValue: 'true',
      env: 'GATE_DEPOSIT_IDEMPOTENCY_STATUS',
      expected: 'passed',
    },
  ],
}

test('production gate defaults to BLOCK when required evidence is missing', () => {
  const result = evaluateProductionGate(policy, {
    GATE_CI_STATUS: 'passed',
    GATE_COMPLIANCE_STATUS: 'approved',
    GATE_PAYMENT_DOMAIN_INTRODUCED: 'false',
  })

  assert.equal(result.ok, false)
  assert.equal(result.decision, 'BLOCK')
  assert.deepEqual(result.failedChecks, ['compliance'])
})

test('production gate returns GO only when all active checks pass', () => {
  const result = evaluateProductionGate(policy, {
    GATE_CI_STATUS: 'passed',
    GATE_COMPLIANCE_STATUS: 'approved',
    GATE_COMPLIANCE_EVIDENCE: 'license-review-2026-09-17',
    GATE_PAYMENT_DOMAIN_INTRODUCED: 'false',
  })

  assert.equal(result.ok, true)
  assert.equal(result.decision, 'GO')
  assert.deepEqual(result.failedChecks, [])
})

test('payment idempotency becomes mandatory once the payment domain is introduced', () => {
  const result = evaluateProductionGate(policy, {
    GATE_CI_STATUS: 'passed',
    GATE_COMPLIANCE_STATUS: 'approved',
    GATE_COMPLIANCE_EVIDENCE: 'license-review-2026-09-17',
    GATE_PAYMENT_DOMAIN_INTRODUCED: 'true',
  })

  assert.equal(result.ok, false)
  assert.equal(result.decision, 'BLOCK')
  assert.deepEqual(result.failedChecks, ['deposit_idempotency'])
})

test('production revision check requires exact revision and demo mode', async () => {
  const revision = 'a'.repeat(40)
  const result = await verifyProductionRevision({
    baseUrl: 'https://casino.example.test',
    expectedRevision: revision,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async json() {
        return { ok: true, status: 'live', mode: 'demo', revision }
      },
    }),
  })

  assert.deepEqual(result, { ok: true, revision, mode: 'demo' })
})

test('production revision check rejects a real-money mode before gate approval', async () => {
  const revision = 'b'.repeat(40)
  await assert.rejects(
    verifyProductionRevision({
      baseUrl: 'https://casino.example.test',
      expectedRevision: revision,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        async json() {
          return { ok: true, status: 'live', mode: 'real-money', revision }
        },
      }),
    }),
    /must remain in demo mode/,
  )
})

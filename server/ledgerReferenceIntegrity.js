export const LEDGER_REFERENCE_RULES = Object.freeze({
  INITIAL_CREDIT: Object.freeze({
    referenceType: 'account',
    idempotencyKey(referenceId) {
      return `initial-credit:${referenceId}`
    },
  }),
  GAME_SETTLEMENT: Object.freeze({
    referenceType: 'spin',
    idempotencyKey(referenceId) {
      return `spin:${referenceId}`
    },
  }),
  SANDBOX_DEPOSIT: Object.freeze({
    referenceType: 'payment_operation',
    idempotencyKey(referenceId) {
      return `sandbox-deposit:${referenceId}:complete`
    },
  }),
  SANDBOX_WITHDRAWAL_RESERVE: Object.freeze({
    referenceType: 'payment_operation',
    idempotencyKey(referenceId) {
      return `sandbox-withdrawal:${referenceId}:reserve`
    },
  }),
  SANDBOX_WITHDRAWAL_RELEASE: Object.freeze({
    referenceType: 'payment_operation',
    idempotencyKey(referenceId) {
      return `sandbox-withdrawal:${referenceId}:release`
    },
  }),
  SANDBOX_WITHDRAWAL: Object.freeze({
    referenceType: 'payment_operation',
    idempotencyKey(referenceId) {
      return `sandbox-withdrawal:${referenceId}:complete`
    },
  }),
})

export function validateLedgerReference(row) {
  const rule = LEDGER_REFERENCE_RULES[row?.type]
  if (!rule) return []

  const issues = []
  const referenceId = typeof row?.reference_id === 'string' ? row.reference_id : ''
  const referenceType = typeof row?.reference_type === 'string' ? row.reference_type : ''
  const idempotencyKey = typeof row?.idempotency_key === 'string' ? row.idempotency_key : ''

  if (!referenceId) {
    issues.push({ code: 'reference_id_missing' })
    return issues
  }
  if (referenceType !== rule.referenceType) {
    issues.push({
      code: 'reference_type_mismatch',
      expected: rule.referenceType,
      actual: referenceType || null,
    })
  }

  const expectedKey = rule.idempotencyKey(referenceId)
  if (idempotencyKey !== expectedKey) {
    issues.push({
      code: 'idempotency_reference_mismatch',
      expected: expectedKey,
      actual: idempotencyKey || null,
    })
  }

  return issues
}

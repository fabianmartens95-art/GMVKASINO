export const LEDGER_REFERENCE_RULES = Object.freeze({
  INITIAL_CREDIT: Object.freeze({
    variants: Object.freeze([
      Object.freeze({
        referenceType: 'account',
        idempotencyKey(referenceId) {
          return `initial-credit:${referenceId}`
        },
      }),
      Object.freeze({
        referenceType: 'demo_session',
        idempotencyKey(referenceId) {
          return `bootstrap:${referenceId}`
        },
      }),
    ]),
  }),
  GAME_SETTLEMENT: Object.freeze({
    variants: Object.freeze([
      Object.freeze({
        referenceType: 'spin',
        idempotencyKey(referenceId) {
          return `spin:${referenceId}`
        },
      }),
    ]),
  }),
  SANDBOX_DEPOSIT: Object.freeze({
    variants: Object.freeze([
      Object.freeze({
        referenceType: 'payment_operation',
        idempotencyKey(referenceId) {
          return `sandbox-deposit:${referenceId}:complete`
        },
      }),
    ]),
  }),
  SANDBOX_WITHDRAWAL_RESERVE: Object.freeze({
    variants: Object.freeze([
      Object.freeze({
        referenceType: 'payment_operation',
        idempotencyKey(referenceId) {
          return `sandbox-withdrawal:${referenceId}:reserve`
        },
      }),
    ]),
  }),
  SANDBOX_WITHDRAWAL_RELEASE: Object.freeze({
    variants: Object.freeze([
      Object.freeze({
        referenceType: 'payment_operation',
        idempotencyKey(referenceId) {
          return `sandbox-withdrawal:${referenceId}:release`
        },
      }),
    ]),
  }),
  SANDBOX_WITHDRAWAL: Object.freeze({
    variants: Object.freeze([
      Object.freeze({
        referenceType: 'payment_operation',
        idempotencyKey(referenceId) {
          return `sandbox-withdrawal:${referenceId}:complete`
        },
      }),
    ]),
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

  const variant = rule.variants.find((candidate) => candidate.referenceType === referenceType)
  if (!variant) {
    issues.push({
      code: 'reference_type_mismatch',
      expected: rule.variants.map((candidate) => candidate.referenceType),
      actual: referenceType || null,
    })
    return issues
  }

  const expectedKey = variant.idempotencyKey(referenceId)
  if (idempotencyKey !== expectedKey) {
    issues.push({
      code: 'idempotency_reference_mismatch',
      expected: expectedKey,
      actual: idempotencyKey || null,
    })
  }

  return issues
}

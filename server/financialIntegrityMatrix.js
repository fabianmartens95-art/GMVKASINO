const REQUIRED_CONTROLS = Object.freeze([
  'ledgerBacked',
  'idempotent',
  'audited',
  'reconciled',
  'capabilityBound',
  'concurrencySafe',
])

function rule(requiredCapability) {
  return Object.freeze({
    ledgerBacked: true,
    idempotent: true,
    audited: true,
    reconciled: true,
    capabilityBound: true,
    concurrencySafe: true,
    requiredCapability,
  })
}

export const FINANCIAL_MUTATION_CONTROLS = Object.freeze({
  wager: rule('casino.play'),
  payout: rule('casino.play'),
  deposit: rule('payments.sandbox.create'),
  withdrawal: rule('payments.sandbox.create'),
  reversal: rule('payments.sandbox.manage'),
  refund: rule('payments.sandbox.manage'),
  bonus: rule('bonus.adjust'),
  adjustment: rule('ledger.adjust'),
  fee: rule('ledger.adjust'),
})

export class FinancialIntegrityMatrixError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'FinancialIntegrityMatrixError'
    this.code = code
  }
}

export function getFinancialMutationControls(type) {
  const normalized = typeof type === 'string' ? type.trim().toLowerCase() : ''
  const controls = FINANCIAL_MUTATION_CONTROLS[normalized]
  if (!controls) {
    throw new FinancialIntegrityMatrixError(
      'UNKNOWN_FINANCIAL_MUTATION',
      `Unknown financial mutation class: ${normalized || '<empty>'}`,
    )
  }
  return controls
}

export function validateFinancialIntegrityMatrix(matrix = FINANCIAL_MUTATION_CONTROLS) {
  if (!matrix || typeof matrix !== 'object' || Array.isArray(matrix)) {
    throw new FinancialIntegrityMatrixError('INVALID_FINANCIAL_MATRIX', 'Financial integrity matrix must be an object')
  }

  const violations = []
  for (const [type, controls] of Object.entries(matrix)) {
    if (!controls || typeof controls !== 'object' || Array.isArray(controls)) {
      violations.push({ type, control: 'rule', reason: 'missing' })
      continue
    }

    for (const control of REQUIRED_CONTROLS) {
      if (controls[control] !== true) {
        violations.push({ type, control, reason: 'required_true' })
      }
    }

    if (typeof controls.requiredCapability !== 'string' || !controls.requiredCapability.trim()) {
      violations.push({ type, control: 'requiredCapability', reason: 'required_nonempty_string' })
    }
  }

  if (violations.length) {
    const error = new FinancialIntegrityMatrixError(
      'INCOMPLETE_FINANCIAL_CONTROLS',
      'Financial mutation controls are incomplete',
    )
    error.violations = violations
    throw error
  }

  return {
    ok: true,
    mutationTypes: Object.keys(matrix).sort(),
    requiredControls: [...REQUIRED_CONTROLS],
  }
}

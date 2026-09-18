export const AUTH_ASSURANCE = Object.freeze({
  BASE: 'base',
  VERIFIED_EMAIL: 'verified_email',
  MFA: 'mfa',
})

const CAPABILITY_ASSURANCE = Object.freeze({
  'casino.play': AUTH_ASSURANCE.BASE,
  'profile.read': AUTH_ASSURANCE.BASE,
  'wallet.read': AUTH_ASSURANCE.BASE,
  'payments.sandbox.create': AUTH_ASSURANCE.BASE,
  'payments.sandbox.read': AUTH_ASSURANCE.BASE,
  'operations.read': AUTH_ASSURANCE.BASE,
  'player.read': AUTH_ASSURANCE.VERIFIED_EMAIL,
  'session.read': AUTH_ASSURANCE.VERIFIED_EMAIL,
  'ledger.read': AUTH_ASSURANCE.VERIFIED_EMAIL,
  'reconciliation.read': AUTH_ASSURANCE.VERIFIED_EMAIL,
  'audit.read': AUTH_ASSURANCE.VERIFIED_EMAIL,
  'risk.review': AUTH_ASSURANCE.MFA,
  'payments.sandbox.manage': AUTH_ASSURANCE.MFA,
  'ledger.adjust': AUTH_ASSURANCE.MFA,
  'bonus.adjust': AUTH_ASSURANCE.MFA,
})

export class StepUpPolicyError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'StepUpPolicyError'
    this.code = code
  }
}

function normalizeCapability(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new StepUpPolicyError('INVALID_CAPABILITY', 'Capability must be a non-empty string')
  }
  return value.trim()
}

export function requiredAssuranceForCapability(capability) {
  const normalized = normalizeCapability(capability)
  return CAPABILITY_ASSURANCE[normalized] || AUTH_ASSURANCE.MFA
}

export function evaluateStepUpRequirement(account, capability) {
  const required = requiredAssuranceForCapability(capability)
  const emailVerified = Boolean(account?.emailVerified)
  const mfaEnrolled = Boolean(account?.mfaEnrolled)

  const satisfied = required === AUTH_ASSURANCE.BASE
    || (required === AUTH_ASSURANCE.VERIFIED_EMAIL && emailVerified)
    || (required === AUTH_ASSURANCE.MFA && emailVerified && mfaEnrolled)

  return Object.freeze({
    capability: normalizeCapability(capability),
    requiredAssurance: required,
    satisfied,
    missing: Object.freeze([
      ...(required !== AUTH_ASSURANCE.BASE && !emailVerified ? ['verified_email'] : []),
      ...(required === AUTH_ASSURANCE.MFA && !mfaEnrolled ? ['mfa'] : []),
    ]),
  })
}

export const SESSION_ASSURANCE_LEVELS = Object.freeze([
  'base',
  'verified_email',
  'mfa',
])

const ASSURANCE_RANK = Object.freeze({
  base: 0,
  verified_email: 1,
  mfa: 2,
})

export function normalizeSessionAssurance(value) {
  const level = typeof value?.level === 'string' && SESSION_ASSURANCE_LEVELS.includes(value.level)
    ? value.level
    : 'base'
  const verifiedAt = value?.verifiedAt === null || value?.verifiedAt === undefined
    ? null
    : Number(value.verifiedAt)

  return Object.freeze({
    level,
    verifiedAt: Number.isFinite(verifiedAt) && verifiedAt >= 0 ? verifiedAt : null,
  })
}

export function sessionMeetsAssurance(value, requiredLevel) {
  const required = typeof requiredLevel === 'string' && SESSION_ASSURANCE_LEVELS.includes(requiredLevel)
    ? requiredLevel
    : 'mfa'
  const assurance = normalizeSessionAssurance(value)
  if (assurance.level !== 'base' && assurance.verifiedAt === null) return false
  return ASSURANCE_RANK[assurance.level] >= ASSURANCE_RANK[required]
}

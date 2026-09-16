export const ACCOUNT_ROLES = Object.freeze([
  'player',
  'support',
  'compliance',
  'finance',
  'admin',
  'provider',
])

const ROLE_CAPABILITIES = Object.freeze({
  player: Object.freeze([
    'casino.play',
    'profile.read',
    'wallet.read',
  ]),
  support: Object.freeze([
    'player.read',
    'profile.read',
    'session.read',
  ]),
  compliance: Object.freeze([
    'audit.read',
    'player.read',
    'risk.review',
    'session.read',
  ]),
  finance: Object.freeze([
    'ledger.read',
    'reconciliation.read',
  ]),
  admin: Object.freeze(['*']),
  provider: Object.freeze([
    'games.read',
  ]),
})

export function normalizeAccountRoles(roles) {
  if (!Array.isArray(roles)) return []
  const allowed = new Set(ACCOUNT_ROLES)
  return [...new Set(roles.filter((role) => typeof role === 'string' && allowed.has(role)))].sort()
}

export function anyRoleHasCapability(roles, capability) {
  if (typeof capability !== 'string' || !capability.trim()) return false
  return normalizeAccountRoles(roles).some((role) => {
    const capabilities = ROLE_CAPABILITIES[role] || []
    return capabilities.includes('*') || capabilities.includes(capability)
  })
}

export function accessContext(account) {
  const roles = normalizeAccountRoles(account?.roles)
  return {
    roles,
    capabilities: [...new Set(roles.flatMap((role) => ROLE_CAPABILITIES[role] || []))].sort(),
  }
}

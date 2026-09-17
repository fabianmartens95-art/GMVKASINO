import { anyRoleHasCapability, normalizeAccountRoles } from './accessControl.js'

export class AuthorizationError extends Error {
  constructor(capability) {
    super('Account does not have the required capability')
    this.name = 'AuthorizationError'
    this.status = 403
    this.code = 'CAPABILITY_REQUIRED'
    this.details = { capability }
  }
}

export function requireAccountCapability(account, capability, {
  auditLog = null,
  requestId = null,
} = {}) {
  if (account && anyRoleHasCapability(account.roles, capability)) return account

  auditLog?.record?.('authorization.denied', {
    requestId,
    accountId: typeof account?.id === 'string' ? account.id : null,
    capability,
    roles: normalizeAccountRoles(account?.roles),
  })

  throw new AuthorizationError(capability)
}

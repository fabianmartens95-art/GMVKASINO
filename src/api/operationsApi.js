import { createClientIdempotencyKey, loginAccount, logoutAccount } from './casinoApi.js'

const API_BASE = '/api/v1'
const AUTH_KEY = 'gmvkasino.auth.token'

function authToken() {
  if (typeof window === 'undefined') return ''
  try {
    return window.sessionStorage?.getItem(AUTH_KEY) || ''
  } catch {
    return ''
  }
}

async function requestStaff(path, { method = 'GET', body } = {}) {
  const token = authToken()
  const headers = { Accept: 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(payload.error?.message || 'Operations request failed')
    error.status = response.status
    error.code = payload.error?.code || 'API_ERROR'
    error.details = payload.error?.details
    error.requestId = payload.error?.requestId || response.headers.get('x-request-id') || ''
    throw error
  }
  return payload
}

async function requestOverview() {
  const payload = await requestStaff('/ops/overview')
  return payload.overview
}

export async function getOperationsOverview() {
  return requestOverview()
}

export async function getPlayerAuthSessions(accountId, { limit = 25 } = {}) {
  if (typeof accountId !== 'string' || !accountId.trim()) throw new Error('Account ID is required')
  const safeLimit = Number.isInteger(limit) ? Math.max(1, Math.min(100, limit)) : 25
  const payload = await requestStaff(
    `/ops/players/${encodeURIComponent(accountId.trim())}/sessions?limit=${safeLimit}`,
  )
  return payload.sessions || []
}

export async function getAuditEvidence({ limit = 50 } = {}) {
  const safeLimit = Number.isInteger(limit) ? Math.max(1, Math.min(100, limit)) : 50
  const payload = await requestStaff(`/ops/audit?limit=${safeLimit}`)
  return payload.events || []
}

export async function getReconciliationEvidence() {
  const payload = await requestStaff('/ops/reconciliation')
  return payload.reconciliation || null
}

export async function getSandboxPaymentQueue() {
  const payload = await requestStaff('/sandbox/payments/queue')
  return payload.operations || []
}

export async function transitionSandboxPayment(operationId, action) {
  const payload = await requestStaff(`/sandbox/payments/${encodeURIComponent(operationId)}/transition`, {
    method: 'POST',
    body: {
      action,
      eventId: createClientIdempotencyKey(`finance-${action}`),
    },
  })
  return payload.operation
}

export async function loginOperations({ email, password }) {
  const login = await loginAccount({ email, password })
  try {
    const overview = await requestOverview()
    return { account: login.account, overview }
  } catch (error) {
    await logoutAccount().catch(() => {})
    throw error
  }
}

export async function logoutOperations() {
  return logoutAccount()
}

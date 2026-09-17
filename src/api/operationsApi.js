import { loginAccount, logoutAccount } from './casinoApi.js'

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

async function requestOverview() {
  const token = authToken()
  const headers = { Accept: 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`

  const response = await fetch(`${API_BASE}/ops/overview`, { headers })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(payload.error?.message || 'Operations request failed')
    error.status = response.status
    error.code = payload.error?.code || 'API_ERROR'
    error.details = payload.error?.details
    error.requestId = payload.error?.requestId || response.headers.get('x-request-id') || ''
    throw error
  }
  return payload.overview
}

export async function getOperationsOverview() {
  return requestOverview()
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

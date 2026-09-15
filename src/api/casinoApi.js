const API_BASE = '/api/v1'
const SESSION_KEY = 'gmvkasino.demo.sessionId'
const AUTH_KEY = 'gmvkasino.auth.token'
let memorySessionId = ''
let memoryAuthToken = ''

function browserStorage(name) {
  if (typeof window === 'undefined') return null
  try {
    return window[name] || null
  } catch {
    return null
  }
}

function readSessionId() {
  const sessionStorage = browserStorage('sessionStorage')
  if (sessionStorage) {
    const sessionId = sessionStorage.getItem(SESSION_KEY) || ''
    if (sessionId) {
      memorySessionId = sessionId
      return sessionId
    }

    const legacyStorage = browserStorage('localStorage')
    const legacySessionId = legacyStorage?.getItem(SESSION_KEY) || ''
    if (legacySessionId) {
      sessionStorage.setItem(SESSION_KEY, legacySessionId)
      legacyStorage.removeItem(SESSION_KEY)
      memorySessionId = legacySessionId
      return legacySessionId
    }
  }

  return memorySessionId
}

function writeSessionId(sessionId) {
  memorySessionId = sessionId || ''

  const sessionStorage = browserStorage('sessionStorage')
  if (sessionStorage) {
    if (sessionId) sessionStorage.setItem(SESSION_KEY, sessionId)
    else sessionStorage.removeItem(SESSION_KEY)
  }

  const legacyStorage = browserStorage('localStorage')
  legacyStorage?.removeItem(SESSION_KEY)
}

function readAuthToken() {
  const sessionStorage = browserStorage('sessionStorage')
  if (sessionStorage) {
    const token = sessionStorage.getItem(AUTH_KEY) || ''
    if (token) {
      memoryAuthToken = token
      return token
    }
  }
  return memoryAuthToken
}

function writeAuthToken(token) {
  memoryAuthToken = token || ''
  const sessionStorage = browserStorage('sessionStorage')
  if (sessionStorage) {
    if (token) sessionStorage.setItem(AUTH_KEY, token)
    else sessionStorage.removeItem(AUTH_KEY)
  }
}

async function request(path, {
  method = 'GET',
  body,
  includeSession = true,
  includeAuth = true,
} = {}) {
  const headers = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  const sessionId = readSessionId()
  if (includeSession && sessionId) headers['X-Demo-Session'] = sessionId

  const authToken = readAuthToken()
  if (includeAuth && authToken) headers.Authorization = `Bearer ${authToken}`

  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })

  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(payload.error?.message || 'Casino API request failed')
    error.status = response.status
    error.code = payload.error?.code || 'API_ERROR'
    error.details = payload.error?.details
    error.requestId = payload.error?.requestId || response.headers.get('x-request-id') || ''
    throw error
  }

  return payload
}

export async function getGames() {
  const payload = await request('/games', { includeSession: false, includeAuth: false })
  return payload.games
}

export async function registerAccount({ email, password, displayName = '' }) {
  const payload = await request('/auth/register', {
    method: 'POST',
    body: { email, password, displayName },
    includeSession: false,
    includeAuth: false,
  })
  writeAuthToken(payload.auth.token)
  writeSessionId(payload.session.id)
  return payload
}

export async function loginAccount({ email, password }) {
  const payload = await request('/auth/login', {
    method: 'POST',
    body: { email, password },
    includeSession: false,
    includeAuth: false,
  })
  writeAuthToken(payload.auth.token)
  writeSessionId(payload.session.id)
  return payload
}

export async function getAccountProfile() {
  if (!readAuthToken()) return null
  try {
    const payload = await request('/auth/me', { includeSession: false })
    return payload.profile
  } catch (error) {
    if (error.status === 401) writeAuthToken('')
    throw error
  }
}

export async function logoutAccount() {
  if (!readAuthToken()) {
    writeSessionId('')
    return false
  }

  try {
    await request('/auth/logout', { method: 'POST' })
    return true
  } catch (error) {
    if (error.status !== 401) throw error
    return false
  } finally {
    writeAuthToken('')
    writeSessionId('')
  }
}

export async function openDemoSession({ player = '' } = {}) {
  const payload = await request('/session', {
    method: 'POST',
    body: { player },
  })
  writeSessionId(payload.session.id)
  return payload.session
}

export async function getDemoSession() {
  if (!readSessionId()) return openDemoSession()

  try {
    const payload = await request('/session')
    return payload.session
  } catch (error) {
    if (error.status !== 401 || error.code === 'AUTH_SESSION_REQUIRED') throw error
    writeSessionId('')
    return openDemoSession()
  }
}

export async function getDemoWallet() {
  if (!readSessionId()) await openDemoSession()

  try {
    const payload = await request('/wallet')
    return payload.wallet
  } catch (error) {
    if (error.status !== 401 || error.code === 'AUTH_SESSION_REQUIRED') throw error
    writeSessionId('')
    await openDemoSession()
    const payload = await request('/wallet')
    return payload.wallet
  }
}

export async function rotateDemoSession() {
  if (!readSessionId()) return openDemoSession()

  try {
    const payload = await request('/session/rotate', { method: 'POST' })
    writeSessionId(payload.session.id)
    return payload.session
  } catch (error) {
    if (error.status !== 401 || error.code === 'AUTH_SESSION_REQUIRED') throw error
    writeSessionId('')
    return openDemoSession()
  }
}

export async function invalidateDemoSession() {
  if (!readSessionId()) {
    writeSessionId('')
    return false
  }

  try {
    await request('/session', { method: 'DELETE' })
    return true
  } catch (error) {
    if (error.status !== 401 && error.code !== 'AUTH_SESSION_REQUIRED') throw error
    return false
  } finally {
    writeSessionId('')
  }
}

export async function syncDemoPlayer(player) {
  return openDemoSession({ player })
}

async function performSpin({ gameId, bet }) {
  const payload = await request('/spin', {
    method: 'POST',
    body: { gameId, bet },
  })
  return payload.result
}

export async function spinDemo({ gameId, bet }) {
  if (!readSessionId()) await openDemoSession()

  try {
    return await performSpin({ gameId, bet })
  } catch (error) {
    if (error.status !== 401 || error.code === 'AUTH_SESSION_REQUIRED') throw error
    writeSessionId('')
    await openDemoSession()
    return performSpin({ gameId, bet })
  }
}

export function clearDemoSession() {
  writeSessionId('')
}

export function clearAccountAuth() {
  writeAuthToken('')
}

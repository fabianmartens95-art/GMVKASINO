const API_BASE = '/api/v1'
const SESSION_KEY = 'gmvkasino.demo.sessionId'
let memorySessionId = ''

function readSessionId() {
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage.getItem(SESSION_KEY) || ''
  }
  return memorySessionId
}

function writeSessionId(sessionId) {
  memorySessionId = sessionId || ''
  if (typeof window !== 'undefined' && window.localStorage) {
    if (sessionId) window.localStorage.setItem(SESSION_KEY, sessionId)
    else window.localStorage.removeItem(SESSION_KEY)
  }
}

async function request(path, { method = 'GET', body, includeSession = true } = {}) {
  const headers = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  const sessionId = readSessionId()
  if (includeSession && sessionId) headers['X-Demo-Session'] = sessionId

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
  const payload = await request('/games', { includeSession: false })
  return payload.games
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
    if (error.status !== 401) throw error
    writeSessionId('')
    return openDemoSession()
  }
}

export async function syncDemoPlayer(player) {
  return openDemoSession({ player })
}

export async function spinDemo({ gameId, bet }) {
  if (!readSessionId()) await openDemoSession()
  const payload = await request('/spin', {
    method: 'POST',
    body: { gameId, bet },
  })
  return payload.result
}

export function clearDemoSession() {
  writeSessionId('')
}

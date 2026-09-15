import test from 'node:test'
import assert from 'node:assert/strict'

const SESSION_KEY = 'gmvkasino.demo.sessionId'

class MemoryStorage {
  constructor() {
    this.values = new Map()
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null
  }

  setItem(key, value) {
    this.values.set(key, String(value))
  }

  removeItem(key) {
    this.values.delete(key)
  }
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

async function withBrowser(testFn) {
  const originalWindow = globalThis.window
  const originalFetch = globalThis.fetch
  const sessionStorage = new MemoryStorage()
  const localStorage = new MemoryStorage()
  globalThis.window = { sessionStorage, localStorage }

  try {
    await testFn({ sessionStorage, localStorage })
  } finally {
    if (originalWindow === undefined) delete globalThis.window
    else globalThis.window = originalWindow
    globalThis.fetch = originalFetch
  }
}

test('client migrates the legacy localStorage bearer token into sessionStorage', async () => {
  await withBrowser(async ({ sessionStorage, localStorage }) => {
    localStorage.setItem(SESSION_KEY, 'legacy-session-token')
    const calls = []
    globalThis.fetch = async (url, options = {}) => {
      calls.push({ url, options })
      return jsonResponse({
        session: { id: 'legacy-session-token', balance: 1000, player: '' },
      })
    }

    const api = await import(`../src/api/casinoApi.js?migration=${Date.now()}`)
    const session = await api.getDemoSession()

    assert.equal(session.id, 'legacy-session-token')
    assert.equal(sessionStorage.getItem(SESSION_KEY), 'legacy-session-token')
    assert.equal(localStorage.getItem(SESSION_KEY), null)
    assert.equal(calls[0].options.headers['X-Demo-Session'], 'legacy-session-token')
  })
})

test('spin recovers once from an expired bearer token by creating a fresh session', async () => {
  await withBrowser(async ({ sessionStorage }) => {
    sessionStorage.setItem(SESSION_KEY, 'expired-session-token')
    const calls = []
    globalThis.fetch = async (url, options = {}) => {
      calls.push({ url, options })

      if (calls.length === 1) {
        return jsonResponse({
          error: { code: 'SESSION_REQUIRED', message: 'Demo session is missing or expired' },
        }, 401)
      }
      if (calls.length === 2) {
        return jsonResponse({
          session: { id: 'fresh-session-token', balance: 1000, player: '' },
        })
      }
      return jsonResponse({
        result: { gameId: 'golden-vault', bet: 1, balance: 999, totalWin: 0, spins: 1 },
      })
    }

    const api = await import(`../src/api/casinoApi.js?recovery=${Date.now()}`)
    const result = await api.spinDemo({ gameId: 'golden-vault', bet: 1 })

    assert.equal(result.balance, 999)
    assert.equal(calls.length, 3)
    assert.equal(calls[0].options.headers['X-Demo-Session'], 'expired-session-token')
    assert.equal(calls[1].options.headers['X-Demo-Session'], undefined)
    assert.equal(calls[2].options.headers['X-Demo-Session'], 'fresh-session-token')
    assert.equal(sessionStorage.getItem(SESSION_KEY), 'fresh-session-token')
  })
})

test('explicit invalidation clears the browser bearer token', async () => {
  await withBrowser(async ({ sessionStorage }) => {
    sessionStorage.setItem(SESSION_KEY, 'active-session-token')
    const calls = []
    globalThis.fetch = async (url, options = {}) => {
      calls.push({ url, options })
      return jsonResponse({ invalidated: true })
    }

    const api = await import(`../src/api/casinoApi.js?invalidate=${Date.now()}`)
    const invalidated = await api.invalidateDemoSession()

    assert.equal(invalidated, true)
    assert.equal(calls[0].options.method, 'DELETE')
    assert.equal(calls[0].options.headers['X-Demo-Session'], 'active-session-token')
    assert.equal(sessionStorage.getItem(SESSION_KEY), null)
  })
})

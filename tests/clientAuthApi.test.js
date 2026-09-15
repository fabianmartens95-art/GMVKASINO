import test from 'node:test'
import assert from 'node:assert/strict'

const SESSION_KEY = 'gmvkasino.demo.sessionId'
const AUTH_KEY = 'gmvkasino.auth.token'

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

test('register stores auth and game bearer tokens in sessionStorage and sends auth on gameplay', async () => {
  await withBrowser(async ({ sessionStorage, localStorage }) => {
    const calls = []
    globalThis.fetch = async (url, options = {}) => {
      calls.push({ url, options })
      if (url.endsWith('/auth/register')) {
        return jsonResponse({
          account: { id: 'account-1', email: 'player@example.com' },
          wallet: { balance: 1000 },
          auth: { token: 'auth-token-abcdefghijklmnopqrstuvwxyz-1234567890', expiresAt: 123 },
          session: { id: 'game-session-token', balance: 1000, authRequired: true },
          upgraded: false,
        }, 201)
      }
      return jsonResponse({
        result: { gameId: 'golden-vault', bet: 1, balance: 999, totalWin: 0, spins: 1 },
      })
    }

    const api = await import(`../src/api/casinoApi.js?auth-register=${Date.now()}`)
    await api.registerAccount({
      email: 'player@example.com',
      password: 'correct-horse-demo-42',
      displayName: 'Player',
    })
    await api.spinDemo({ gameId: 'golden-vault', bet: 1 })

    assert.equal(sessionStorage.getItem(AUTH_KEY), 'auth-token-abcdefghijklmnopqrstuvwxyz-1234567890')
    assert.equal(sessionStorage.getItem(SESSION_KEY), 'game-session-token')
    assert.equal(localStorage.getItem(AUTH_KEY), null)
    assert.equal(calls[1].options.headers.Authorization, 'Bearer auth-token-abcdefghijklmnopqrstuvwxyz-1234567890')
    assert.equal(calls[1].options.headers['X-Demo-Session'], 'game-session-token')
  })
})

test('register sends an existing guest session so the server can upgrade it in place', async () => {
  await withBrowser(async ({ sessionStorage }) => {
    sessionStorage.setItem(SESSION_KEY, 'existing-guest-session')
    const calls = []
    globalThis.fetch = async (url, options = {}) => {
      calls.push({ url, options })
      return jsonResponse({
        account: { id: 'guest-account', email: 'upgrade@example.com' },
        wallet: { id: 'existing-wallet', balance: 1049 },
        auth: { token: 'upgraded-auth-token-abcdefghijklmnopqrstuvwxyz-1234', expiresAt: 123 },
        session: { id: 'existing-guest-session', balance: 1049, authRequired: true },
        upgraded: true,
      }, 201)
    }

    const api = await import(`../src/api/casinoApi.js?guest-upgrade=${Date.now()}`)
    const result = await api.registerAccount({
      email: 'upgrade@example.com',
      password: 'correct-horse-demo-42',
      displayName: 'Upgraded Player',
    })

    assert.equal(result.upgraded, true)
    assert.equal(calls[0].options.headers['X-Demo-Session'], 'existing-guest-session')
    assert.equal(calls[0].options.headers.Authorization, undefined)
    assert.equal(sessionStorage.getItem(SESSION_KEY), 'existing-guest-session')
    assert.equal(sessionStorage.getItem(AUTH_KEY), 'upgraded-auth-token-abcdefghijklmnopqrstuvwxyz-1234')
  })
})

test('expired account auth does not silently downgrade an authenticated player to a guest session', async () => {
  await withBrowser(async ({ sessionStorage }) => {
    sessionStorage.setItem(AUTH_KEY, 'expired-auth-token-abcdefghijklmnopqrstuvwxyz-123')
    sessionStorage.setItem(SESSION_KEY, 'protected-game-session')
    let calls = 0
    globalThis.fetch = async () => {
      calls += 1
      return jsonResponse({
        error: { code: 'AUTH_SESSION_REQUIRED', message: 'Authentication session is missing or expired' },
      }, 401)
    }

    const api = await import(`../src/api/casinoApi.js?auth-expired=${Date.now()}`)
    await assert.rejects(
      api.spinDemo({ gameId: 'golden-vault', bet: 1 }),
      (error) => error.code === 'AUTH_SESSION_REQUIRED' && error.status === 401,
    )
    assert.equal(calls, 1)
    assert.equal(sessionStorage.getItem(SESSION_KEY), 'protected-game-session')
  })
})

test('logout clears both browser bearer tokens', async () => {
  await withBrowser(async ({ sessionStorage }) => {
    sessionStorage.setItem(AUTH_KEY, 'active-auth-token-abcdefghijklmnopqrstuvwxyz-1234')
    sessionStorage.setItem(SESSION_KEY, 'active-game-session')
    globalThis.fetch = async () => jsonResponse({ loggedOut: true })

    const api = await import(`../src/api/casinoApi.js?auth-logout=${Date.now()}`)
    assert.equal(await api.logoutAccount(), true)
    assert.equal(sessionStorage.getItem(AUTH_KEY), null)
    assert.equal(sessionStorage.getItem(SESSION_KEY), null)
  })
})

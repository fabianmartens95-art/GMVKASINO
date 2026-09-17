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

test('client preserves one idempotency key across session recovery retry', async () => {
  const originalWindow = globalThis.window
  const originalFetch = globalThis.fetch
  const sessionStorage = new MemoryStorage()
  const localStorage = new MemoryStorage()
  sessionStorage.setItem(SESSION_KEY, 'expired-session-token')
  globalThis.window = { sessionStorage, localStorage }

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

  try {
    const api = await import(`../src/api/casinoApi.js?idem=${Date.now()}`)
    await api.spinDemo({ gameId: 'golden-vault', bet: 1 })

    assert.equal(calls.length, 3)
    const firstBody = JSON.parse(calls[0].options.body)
    const retriedBody = JSON.parse(calls[2].options.body)
    assert.match(firstBody.idempotencyKey, /^[A-Za-z0-9._:-]{8,128}$/)
    assert.equal(retriedBody.idempotencyKey, firstBody.idempotencyKey)
    assert.equal(retriedBody.gameId, firstBody.gameId)
    assert.equal(retriedBody.bet, firstBody.bet)
  } finally {
    if (originalWindow === undefined) delete globalThis.window
    else globalThis.window = originalWindow
    globalThis.fetch = originalFetch
  }
})

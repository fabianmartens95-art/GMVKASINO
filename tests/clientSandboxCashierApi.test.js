import test from 'node:test'
import assert from 'node:assert/strict'

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

test('cashier list and create calls use account auth without demo-session authority', async () => {
  await withBrowser(async ({ sessionStorage }) => {
    sessionStorage.setItem(AUTH_KEY, 'player-auth-token-abcdefghijklmnopqrstuvwxyz')
    const calls = []
    globalThis.fetch = async (url, options = {}) => {
      calls.push({ url, options })
      if (url.endsWith('/sandbox/payments')) {
        return jsonResponse({ sandbox: true, mode: 'demo', operations: [] })
      }
      return jsonResponse({
        sandbox: true,
        mode: 'demo',
        operation: {
          id: 'payment-1',
          kind: 'deposit',
          amountExact: '12.50',
          status: 'pending',
        },
      }, 201)
    }

    const api = await import(`../src/api/casinoApi.js?cashier-api=${Date.now()}`)
    await api.listSandboxPayments()
    await api.createSandboxPayment({
      kind: 'deposit',
      amount: '12.50',
      idempotencyKey: 'cashier-test-deposit-0001',
    })

    assert.equal(calls.length, 2)
    assert.equal(calls[0].options.headers.Authorization, 'Bearer player-auth-token-abcdefghijklmnopqrstuvwxyz')
    assert.equal(calls[0].options.headers['X-Demo-Session'], undefined)
    assert.equal(calls[1].options.headers.Authorization, 'Bearer player-auth-token-abcdefghijklmnopqrstuvwxyz')
    assert.equal(calls[1].options.headers['X-Demo-Session'], undefined)

    const body = JSON.parse(calls[1].options.body)
    assert.deepEqual(body, {
      amount: '12.50',
      idempotencyKey: 'cashier-test-deposit-0001',
    })
    assert.equal(calls[1].url.endsWith('/api/v1/sandbox/payments/deposits'), true)
  })
})

test('finance client reads queue and generates a unique transition event id', async () => {
  await withBrowser(async ({ sessionStorage }) => {
    sessionStorage.setItem(AUTH_KEY, 'finance-auth-token-abcdefghijklmnopqrstuvwxyz')
    const calls = []
    globalThis.fetch = async (url, options = {}) => {
      calls.push({ url, options })
      if (url.endsWith('/sandbox/payments/queue')) {
        return jsonResponse({
          sandbox: true,
          mode: 'demo',
          operations: [{ id: 'operation-1', accountRef: 'abc123', status: 'reserved' }],
        })
      }
      return jsonResponse({
        sandbox: true,
        mode: 'demo',
        operation: { id: 'operation-1', status: 'approved' },
      })
    }

    const opsApi = await import(`../src/api/operationsApi.js?finance-api=${Date.now()}`)
    const queue = await opsApi.getSandboxPaymentQueue()
    assert.equal(queue[0].accountRef, 'abc123')

    await opsApi.transitionSandboxPayment('operation-1', 'approve')

    assert.equal(calls[0].options.headers.Authorization, 'Bearer finance-auth-token-abcdefghijklmnopqrstuvwxyz')
    assert.equal(calls[1].options.headers.Authorization, 'Bearer finance-auth-token-abcdefghijklmnopqrstuvwxyz')
    const transitionBody = JSON.parse(calls[1].options.body)
    assert.equal(transitionBody.action, 'approve')
    assert.match(transitionBody.eventId, /^finance-approve:/)
    assert.equal(calls[1].url.endsWith('/api/v1/sandbox/payments/operation-1/transition'), true)
  })
})

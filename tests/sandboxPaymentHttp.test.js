import test from 'node:test'
import assert from 'node:assert/strict'
import { createSandboxPaymentHttpServer } from '../server/sandboxPaymentHttpServer.js'

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  return `http://127.0.0.1:${address.port}`
}

async function close(server) {
  await new Promise((resolve) => server.close(resolve))
}

function fixture() {
  const calls = []
  const profiles = {
    'player-token': { account: { id: 'player-1', roles: ['player'] } },
    'finance-token': { account: { id: 'finance-1', roles: ['finance'] } },
    'provider-token': { account: { id: 'provider-1', roles: ['provider'] } },
  }
  const paymentService = {
    async createOperation(input) {
      calls.push({ type: 'create', input })
      return {
        id: 'payment-1',
        accountId: input.accountId,
        kind: input.kind,
        status: input.kind === 'deposit' ? 'pending' : 'reserved',
        sandbox: true,
        mode: 'demo',
        replayed: false,
      }
    },
    async listOperations(input) {
      calls.push({ type: 'list', input })
      return [{ id: 'payment-1', accountId: input.accountId, sandbox: true, mode: 'demo' }]
    },
    async transition(input) {
      calls.push({ type: 'transition', input })
      return {
        id: input.operationId,
        accountId: 'player-1',
        kind: 'deposit',
        status: 'completed',
        sandbox: true,
        mode: 'demo',
        replayed: false,
      }
    },
  }
  const authService = {
    profile: async (token) => profiles[token] || null,
  }
  const service = {
    metrics: null,
    authService,
    paymentService,
    auditLog: { record() {} },
    checkReadiness: async () => ({ ok: true, backend: 'memory' }),
    getGames: () => [],
  }
  const config = { maxBodyBytes: 16_384, metricsToken: '', deploymentRevision: null }
  return { service, paymentService, authService, config, calls }
}

test('sandbox payment routes require authentication and explicit capabilities', async () => {
  const { service, paymentService, authService, config } = fixture()
  const server = createSandboxPaymentHttpServer({
    service,
    paymentService,
    authService,
    config,
    staticDir: '/tmp/gmvkasino-no-static',
    log: () => {},
  })
  const baseUrl = await listen(server)

  try {
    const anonymous = await fetch(`${baseUrl}/api/v1/sandbox/payments`)
    assert.equal(anonymous.status, 401)

    const providerCreate = await fetch(`${baseUrl}/api/v1/sandbox/payments/deposits`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer provider-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ amount: '10.00', idempotencyKey: 'provider-denied-01' }),
    })
    assert.equal(providerCreate.status, 403)
    assert.equal((await providerCreate.json()).error.code, 'CAPABILITY_REQUIRED')

    const playerTransition = await fetch(`${baseUrl}/api/v1/sandbox/payments/payment-1/transition`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer player-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'complete', eventId: 'player-event-0001' }),
    })
    assert.equal(playerTransition.status, 403)
    assert.equal((await playerTransition.json()).error.details.capability, 'payments.sandbox.manage')
  } finally {
    await close(server)
  }
})

test('player can create and read own sandbox payment operations', async () => {
  const { service, paymentService, authService, config, calls } = fixture()
  const server = createSandboxPaymentHttpServer({
    service,
    paymentService,
    authService,
    config,
    staticDir: '/tmp/gmvkasino-no-static',
    log: () => {},
  })
  const baseUrl = await listen(server)

  try {
    const createResponse = await fetch(`${baseUrl}/api/v1/sandbox/payments/deposits`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer player-token',
        'Content-Type': 'application/json',
        'X-Request-Id': 'sandbox-payment-create-01',
      },
      body: JSON.stringify({ amount: '12.50', idempotencyKey: 'deposit-http-0001' }),
    })
    assert.equal(createResponse.status, 201)
    const created = await createResponse.json()
    assert.equal(created.sandbox, true)
    assert.equal(created.mode, 'demo')
    assert.equal(created.operation.accountId, 'player-1')

    const listResponse = await fetch(`${baseUrl}/api/v1/sandbox/payments`, {
      headers: { Authorization: 'Bearer player-token' },
    })
    assert.equal(listResponse.status, 200)
    const listed = await listResponse.json()
    assert.equal(listed.sandbox, true)
    assert.equal(listed.mode, 'demo')
    assert.equal(listed.operations[0].accountId, 'player-1')

    const createCall = calls.find((call) => call.type === 'create')
    assert.equal(createCall.input.accountId, 'player-1')
    assert.equal(createCall.input.kind, 'deposit')
    assert.equal(createCall.input.requestId, 'sandbox-payment-create-01')
  } finally {
    await close(server)
  }
})

test('finance capability can execute provider-style sandbox transitions', async () => {
  const { service, paymentService, authService, config, calls } = fixture()
  const server = createSandboxPaymentHttpServer({
    service,
    paymentService,
    authService,
    config,
    staticDir: '/tmp/gmvkasino-no-static',
    log: () => {},
  })
  const baseUrl = await listen(server)

  try {
    const response = await fetch(`${baseUrl}/api/v1/sandbox/payments/payment-1/transition`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer finance-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'complete', eventId: 'finance-event-0001' }),
    })
    assert.equal(response.status, 200)
    const payload = await response.json()
    assert.equal(payload.operation.status, 'completed')
    assert.equal(payload.sandbox, true)
    assert.equal(payload.mode, 'demo')

    const transitionCall = calls.find((call) => call.type === 'transition')
    assert.equal(transitionCall.input.actorAccountId, 'finance-1')
    assert.equal(transitionCall.input.eventId, 'finance-event-0001')
  } finally {
    await close(server)
  }
})

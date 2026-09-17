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
  const auditEvents = []
  const profiles = {
    'finance-token': { account: { id: 'finance-1', roles: ['finance'] } },
    'support-token': { account: { id: 'support-1', roles: ['support'] } },
    'player-token': { account: { id: 'player-1', roles: ['player'] } },
  }
  const authService = { profile: async (token) => profiles[token] || null }
  const paymentService = {
    async listOperations() { return [] },
    async createOperation() { throw new Error('not used') },
    async transition() { throw new Error('not used') },
  }
  const paymentQueue = {
    async list() {
      return [{
        id: 'operation-1',
        accountRef: 'a1b2c3d4e5f6',
        kind: 'withdrawal',
        amountExact: '25.00',
        status: 'reserved',
        sandbox: true,
        mode: 'demo',
      }]
    },
  }
  const auditLog = {
    record(type, data) { auditEvents.push({ type, data }) },
  }
  const service = {
    authService,
    paymentService,
    paymentQueue,
    auditLog,
    metrics: null,
    checkReadiness: async () => ({ ok: true, backend: 'memory' }),
    getGames: () => [],
  }
  const config = { maxBodyBytes: 16_384, metricsToken: '', deploymentRevision: null }
  return { service, authService, paymentService, paymentQueue, auditLog, auditEvents, config }
}

test('finance queue denies non-manage roles', async () => {
  const { service, authService, paymentService, paymentQueue, auditLog, config } = fixture()
  const server = createSandboxPaymentHttpServer({
    service,
    authService,
    paymentService,
    paymentQueue,
    auditLog,
    config,
    staticDir: '/tmp/gmvkasino-no-static',
    log: () => {},
  })
  const baseUrl = await listen(server)

  try {
    for (const token of ['support-token', 'player-token']) {
      const response = await fetch(`${baseUrl}/api/v1/sandbox/payments/queue`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      assert.equal(response.status, 403)
      const payload = await response.json()
      assert.equal(payload.error.code, 'CAPABILITY_REQUIRED')
      assert.equal(payload.error.details.capability, 'payments.sandbox.manage')
    }
  } finally {
    await close(server)
  }
})

test('finance queue returns sanitized operations and audits access', async () => {
  const { service, authService, paymentService, paymentQueue, auditLog, auditEvents, config } = fixture()
  const server = createSandboxPaymentHttpServer({
    service,
    authService,
    paymentService,
    paymentQueue,
    auditLog,
    config,
    staticDir: '/tmp/gmvkasino-no-static',
    log: () => {},
  })
  const baseUrl = await listen(server)

  try {
    const response = await fetch(`${baseUrl}/api/v1/sandbox/payments/queue`, {
      headers: {
        Authorization: 'Bearer finance-token',
        'X-Request-Id': 'finance-queue-request-0001',
      },
    })
    assert.equal(response.status, 200)
    const payload = await response.json()
    assert.equal(payload.sandbox, true)
    assert.equal(payload.mode, 'demo')
    assert.equal(payload.operations[0].accountRef, 'a1b2c3d4e5f6')

    const serialized = JSON.stringify(payload)
    assert.equal(serialized.includes('player-1'), false)
    assert.equal(serialized.includes('accountId'), false)
    assert.equal(serialized.includes('idempotencyKey'), false)
    assert.equal(serialized.includes('TransactionId'), false)

    const audit = auditEvents.find((entry) => entry.type === 'sandbox_payment.queue_read')
    assert.ok(audit)
    assert.equal(audit.data.accountId, 'finance-1')
    assert.equal(audit.data.operationCount, 1)
    assert.equal(audit.data.requestId, 'finance-queue-request-0001')
  } finally {
    await close(server)
  }
})

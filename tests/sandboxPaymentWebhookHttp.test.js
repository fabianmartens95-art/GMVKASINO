import test from 'node:test'
import assert from 'node:assert/strict'
import { createSandboxPaymentHttpServer } from '../server/sandboxPaymentHttpServer.js'
import { signPaymentWebhookEnvelope } from '../server/paymentWebhookVerifier.js'

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

function fixture({ secret = '' } = {}) {
  const calls = []
  const paymentService = {
    async transition(input) {
      calls.push(input)
      return {
        id: input.operationId,
        kind: 'deposit',
        status: 'completed',
        sandbox: true,
        mode: 'demo',
        replayed: false,
      }
    },
  }
  const service = {
    metrics: null,
    paymentService,
    auditLog: { record() {} },
    checkReadiness: async () => ({ ok: true, backend: 'memory' }),
    getGames: () => [],
  }
  const config = {
    maxBodyBytes: 16_384,
    metricsToken: '',
    deploymentRevision: null,
    sandboxPaymentWebhookSecret: secret,
  }
  return { service, paymentService, config, calls }
}

test('sandbox provider webhook route is unavailable when no explicit secret is configured', async () => {
  const { service, paymentService, config, calls } = fixture()
  const server = createSandboxPaymentHttpServer({
    service,
    paymentService,
    config,
    staticDir: '/tmp/gmvkasino-no-static',
    log: () => {},
  })
  const baseUrl = await listen(server)

  try {
    const response = await fetch(`${baseUrl}/api/v1/sandbox/providers/sandbox/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: 'sandbox',
        eventId: 'event-disabled-0001',
        operationId: 'payment-1',
        action: 'complete',
      }),
    })
    assert.equal(response.status, 404)
    assert.equal(calls.length, 0)
  } finally {
    await close(server)
  }
})

test('valid signed sandbox provider webhook is normalized before authoritative transition', async () => {
  const secret = 'sandbox-webhook-secret-that-is-at-least-32-bytes'
  const { service, paymentService, config, calls } = fixture({ secret })
  const server = createSandboxPaymentHttpServer({
    service,
    paymentService,
    config,
    staticDir: '/tmp/gmvkasino-no-static',
    log: () => {},
  })
  const baseUrl = await listen(server)
  const timestamp = String(Math.floor(Date.now() / 1000))
  const rawBody = JSON.stringify({
    provider: 'sandbox',
    eventId: 'event-signed-0001',
    operationId: 'payment-1',
    action: 'complete',
    reference: 'provider-ref-001',
  })
  const signature = signPaymentWebhookEnvelope({ secret, timestamp, rawBody })

  try {
    const response = await fetch(`${baseUrl}/api/v1/sandbox/providers/sandbox/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Provider-Timestamp': timestamp,
        'X-Provider-Signature': signature,
        'X-Request-Id': 'provider-webhook-request-01',
      },
      body: rawBody,
    })
    assert.equal(response.status, 200)
    const payload = await response.json()
    assert.equal(payload.sandbox, true)
    assert.equal(payload.mode, 'demo')
    assert.equal(payload.accepted, true)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].operationId, 'payment-1')
    assert.equal(calls[0].action, 'complete')
    assert.equal(calls[0].eventId, 'sandbox:event-signed-0001')
    assert.equal(calls[0].actorAccountId, null)
    assert.equal(calls[0].requestId, 'provider-webhook-request-01')
  } finally {
    await close(server)
  }
})

test('invalid signature or stale timestamp never reaches payment transition', async () => {
  const secret = 'sandbox-webhook-secret-that-is-at-least-32-bytes'
  const { service, paymentService, config, calls } = fixture({ secret })
  const server = createSandboxPaymentHttpServer({
    service,
    paymentService,
    config,
    staticDir: '/tmp/gmvkasino-no-static',
    log: () => {},
  })
  const baseUrl = await listen(server)
  const rawBody = JSON.stringify({
    provider: 'sandbox',
    eventId: 'event-invalid-0001',
    operationId: 'payment-1',
    action: 'complete',
  })

  try {
    const badSignature = await fetch(`${baseUrl}/api/v1/sandbox/providers/sandbox/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Provider-Timestamp': String(Math.floor(Date.now() / 1000)),
        'X-Provider-Signature': 'sha256=' + '0'.repeat(64),
      },
      body: rawBody,
    })
    assert.equal(badSignature.status, 401)
    assert.equal(calls.length, 0)

    const staleTimestamp = String(Math.floor(Date.now() / 1000) - 1000)
    const staleSignature = signPaymentWebhookEnvelope({ secret, timestamp: staleTimestamp, rawBody })
    const stale = await fetch(`${baseUrl}/api/v1/sandbox/providers/sandbox/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Provider-Timestamp': staleTimestamp,
        'X-Provider-Signature': staleSignature,
      },
      body: rawBody,
    })
    assert.equal(stale.status, 401)
    assert.equal(calls.length, 0)
  } finally {
    await close(server)
  }
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { anyRoleHasCapability } from '../server/accessControl.js'
import { createOperationsHttpServer } from '../server/operationsHttpServer.js'
import { OperationalMetrics } from '../server/operationalMetrics.js'

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
  const metrics = new OperationalMetrics({ now: () => 1_000 })
  const profiles = {
    'support-token': { account: { id: 'support-1', roles: ['support'] }, wallet: { balance: 0 } },
    'player-token': { account: { id: 'player-1', roles: ['player'] }, wallet: { balance: 1000 } },
    'provider-token': { account: { id: 'provider-1', roles: ['provider'] }, wallet: { balance: 0 } },
  }
  const authService = {
    profile: async (token) => profiles[token] || null,
  }
  const paymentReconciler = {
    sanitizedSummary: async () => ({
      ok: true,
      checkedAt: '2026-09-17T17:00:00.000Z',
      sandbox: true,
      mode: 'demo',
      operationsChecked: 7,
      paymentTransactionsChecked: 8,
      countsByKind: { deposit: 3, withdrawal: 4 },
      countsByStatus: { completed: 5, reserved: 2 },
      mismatchCount: 0,
      mismatchCategories: { operations: 0, transactions: 0, events: 0, reserves: 0 },
    }),
  }
  const service = {
    metrics,
    authService,
    paymentReconciler,
    auditLog: {
      record(event, data) {
        auditEvents.push({ event, data })
      },
    },
    checkReadiness: async () => ({ ok: true, backend: 'postgres' }),
    getGames: () => [
      { id: 'golden-vault', status: 'playable' },
      { id: 'neon-fruits', status: 'coming-soon' },
    ],
  }
  const config = {
    deploymentRevision: 'a'.repeat(40),
    maxBodyBytes: 16_384,
    metricsToken: '',
  }

  return { service, authService, paymentReconciler, metrics, auditEvents, config }
}

test('operations.read is limited to staff roles', () => {
  assert.equal(anyRoleHasCapability(['support'], 'operations.read'), true)
  assert.equal(anyRoleHasCapability(['compliance'], 'operations.read'), true)
  assert.equal(anyRoleHasCapability(['finance'], 'operations.read'), true)
  assert.equal(anyRoleHasCapability(['admin'], 'operations.read'), true)
  assert.equal(anyRoleHasCapability(['player'], 'operations.read'), false)
  assert.equal(anyRoleHasCapability(['provider'], 'operations.read'), false)
})

test('operations overview requires an authenticated staff capability', async () => {
  const { service, authService, config } = fixture()
  const server = createOperationsHttpServer({
    service,
    authService,
    config,
    staticDir: '/tmp/gmvkasino-no-static',
    log: () => {},
  })
  const baseUrl = await listen(server)

  try {
    const anonymous = await fetch(`${baseUrl}/api/v1/ops/overview`)
    assert.equal(anonymous.status, 401)
    assert.equal((await anonymous.json()).error.code, 'AUTH_SESSION_REQUIRED')

    const player = await fetch(`${baseUrl}/api/v1/ops/overview`, {
      headers: { Authorization: 'Bearer player-token' },
    })
    assert.equal(player.status, 403)
    const playerPayload = await player.json()
    assert.equal(playerPayload.error.code, 'CAPABILITY_REQUIRED')
    assert.equal(playerPayload.error.details.capability, 'operations.read')

    const provider = await fetch(`${baseUrl}/api/v1/ops/overview`, {
      headers: { Authorization: 'Bearer provider-token' },
    })
    assert.equal(provider.status, 403)
  } finally {
    await close(server)
  }
})

test('authorized operations overview is read-only, sanitized, payment-aware and audited', async () => {
  const { service, authService, config, auditEvents } = fixture()
  const server = createOperationsHttpServer({
    service,
    authService,
    config,
    staticDir: '/tmp/gmvkasino-no-static',
    log: () => {},
  })
  const baseUrl = await listen(server)

  try {
    const response = await fetch(`${baseUrl}/api/v1/ops/overview`, {
      headers: {
        Authorization: 'Bearer support-token',
        'X-Request-Id': 'ops-test-request-123',
      },
    })
    assert.equal(response.status, 200)

    const payload = await response.json()
    assert.equal(payload.overview.mode, 'demo')
    assert.equal(payload.overview.readOnly, true)
    assert.equal(payload.overview.persistence, 'postgres')
    assert.equal(payload.overview.revision, 'a'.repeat(40))
    assert.deepEqual(payload.overview.games, { total: 2, playable: 1, comingSoon: 1 })
    assert.equal(payload.overview.payments.ok, true)
    assert.equal(payload.overview.payments.sandbox, true)
    assert.equal(payload.overview.payments.operationsChecked, 7)
    assert.equal(payload.overview.payments.mismatchCount, 0)
    assert.deepEqual(payload.overview.payments.countsByStatus, { completed: 5, reserved: 2 })
    assert.equal(payload.requestId, 'ops-test-request-123')

    const serialized = JSON.stringify(payload)
    assert.equal(serialized.includes('support-token'), false)
    assert.equal(serialized.includes('password'), false)
    assert.equal(serialized.includes('wallet'), false)
    assert.equal(serialized.includes('accountId'), false)

    const audit = auditEvents.find((entry) => entry.event === 'operations.overview_read')
    assert.ok(audit)
    assert.equal(audit.data.requestId, 'ops-test-request-123')
    assert.equal(audit.data.accountId, 'support-1')
    assert.equal(audit.data.paymentReconciliationOk, true)
    assert.equal(audit.data.paymentMismatchCount, 0)
  } finally {
    await close(server)
  }
})

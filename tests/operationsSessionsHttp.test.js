import test from 'node:test'
import assert from 'node:assert/strict'
import { createOperationsHttpServer } from '../server/operationsHttpServer.js'

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

test('player auth-session visibility requires session.read and returns opaque metadata only', async () => {
  const profiles = {
    'support-token': { account: { id: 'support-1', roles: ['support'] }, wallet: { balance: 0 } },
    'finance-token': { account: { id: 'finance-1', roles: ['finance'] }, wallet: { balance: 0 } },
  }
  const authService = { profile: async (token) => profiles[token] || null }
  const auditEvents = []
  const authSessionDirectory = {
    async list({ accountId, limit }) {
      assert.equal(accountId, 'player-1')
      assert.equal(limit, '5')
      return [{
        sessionRef: '0123456789abcdef',
        state: 'active',
        createdAt: 1000,
        lastSeenAt: 2000,
        expiresAt: 9000,
        revokedAt: null,
      }]
    },
  }
  const service = {
    metrics: null,
    authService,
    auditLog: { record(event, data) { auditEvents.push({ event, data }) } },
    checkReadiness: async () => ({ ok: true, backend: 'memory' }),
    getGames: () => [],
  }
  const server = createOperationsHttpServer({
    service,
    authService,
    authSessionDirectory,
    config: {
      maxBodyBytes: 16_384,
      metricsToken: '',
      deploymentRevision: null,
      authSessionIdleTtlMs: 86_400_000,
    },
    staticDir: '/tmp/gmvkasino-no-static',
    log: () => {},
  })
  const baseUrl = await listen(server)

  try {
    const denied = await fetch(`${baseUrl}/api/v1/ops/players/player-1/sessions?limit=5`, {
      headers: { Authorization: 'Bearer finance-token' },
    })
    assert.equal(denied.status, 403)
    assert.equal((await denied.json()).error.details.capability, 'session.read')

    const allowed = await fetch(`${baseUrl}/api/v1/ops/players/player-1/sessions?limit=5`, {
      headers: {
        Authorization: 'Bearer support-token',
        'X-Request-Id': 'session-read-request-01',
      },
    })
    assert.equal(allowed.status, 200)
    const payload = await allowed.json()
    assert.equal(payload.readOnly, true)
    assert.equal(payload.sessions[0].sessionRef, '0123456789abcdef')
    const serialized = JSON.stringify(payload)
    assert.equal(serialized.includes('token_hash'), false)
    assert.equal(serialized.includes('raw-session'), false)
    assert.equal(serialized.includes('player-1'), false)

    const audit = auditEvents.find((entry) => entry.event === 'operations.player_sessions_read')
    assert.ok(audit)
    assert.equal(audit.data.accountId, 'support-1')
    assert.equal(audit.data.resultCount, 1)
    assert.equal(typeof audit.data.targetAccountRef, 'string')
    assert.notEqual(audit.data.targetAccountRef, 'player-1')
  } finally {
    await close(server)
  }
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { createHttpServer } from '../server/httpServer.js'

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

test('spin history is authenticated, player-capability protected and sanitized', async () => {
  const profiles = {
    'player-token': { account: { id: 'player-1', roles: ['player'] }, wallet: { balance: 1000 } },
    'finance-token': { account: { id: 'finance-1', roles: ['finance'] }, wallet: { balance: 0 } },
  }
  const authService = {
    profile: async (token) => profiles[token] || null,
  }
  const gameRoundHistory = {
    async list({ accountId, limit }) {
      assert.equal(accountId, 'player-1')
      assert.equal(limit, '10')
      return [{
        roundId: 'round-1',
        gameId: 'golden-vault',
        bet: 1,
        betExact: '1.00',
        payout: 2,
        payoutExact: '2.00',
        status: 'settled',
        createdAt: 1000,
      }]
    },
  }
  const service = {
    metrics: null,
    authService,
    auditLog: { record() {} },
    checkReadiness: async () => ({ ok: true, backend: 'memory' }),
    getGames: () => [],
  }
  const server = createHttpServer({
    service,
    authService,
    gameRoundHistory,
    config: { maxBodyBytes: 16_384, metricsToken: '' },
    staticDir: '/tmp/gmvkasino-no-static',
    log: () => {},
  })
  const baseUrl = await listen(server)

  try {
    const anonymous = await fetch(`${baseUrl}/api/v1/history/spins?limit=10`)
    assert.equal(anonymous.status, 401)

    const finance = await fetch(`${baseUrl}/api/v1/history/spins?limit=10`, {
      headers: { Authorization: 'Bearer finance-token' },
    })
    assert.equal(finance.status, 403)

    const player = await fetch(`${baseUrl}/api/v1/history/spins?limit=10`, {
      headers: { Authorization: 'Bearer player-token' },
    })
    assert.equal(player.status, 200)
    const payload = await player.json()
    assert.equal(payload.mode, 'demo')
    assert.equal(payload.rounds[0].roundId, 'round-1')
    const serialized = JSON.stringify(payload)
    assert.equal(serialized.includes('accountId'), false)
    assert.equal(serialized.includes('idempotency'), false)
    assert.equal(serialized.includes('requestFingerprint'), false)
    assert.equal(serialized.includes('responseJson'), false)
  } finally {
    await close(server)
  }
})

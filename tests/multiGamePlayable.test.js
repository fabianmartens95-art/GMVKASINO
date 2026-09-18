import test from 'node:test'
import assert from 'node:assert/strict'
import { SessionStore } from '../server/sessionStore.js'
import { SlidingWindowRateLimiter } from '../server/rateLimiter.js'
import { AuditLog } from '../server/auditLog.js'
import { CasinoService } from '../server/casinoService.js'

const CASES = [
  ['golden-vault', 50],
  ['neon-fruits', 10],
  ['diamond-rush', 75],
  ['lucky-777', 100],
]

function createService() {
  let rngCalls = 0
  const service = new CasinoService({
    sessionStore: new SessionStore({ startingBalance: 1000 }),
    rateLimiter: new SlidingWindowRateLimiter({ limit: 100, windowMs: 10_000 }),
    auditLog: new AuditLog({ sink: () => {} }),
    rng: () => {
      rngCalls += 1
      return 0
    },
  })
  return { service, getRngCalls: () => rngCalls }
}

for (const [gameId, expectedPayout] of CASES) {
  test(`${gameId} resolves through authoritative service and replays without rerunning RNG`, async () => {
    const { service, getRngCalls } = createService()
    const session = await service.openSession({ player: `QA ${gameId}` })
    const idempotencyKey = `cert-${gameId}-0001`

    const first = await service.spin({
      sessionId: session.id,
      gameId,
      bet: 1,
      idempotencyKey,
      requestId: `cert-${gameId}-request-a`,
    })

    const callsAfterFirst = getRngCalls()
    assert.equal(callsAfterFirst, 9)
    assert.equal(first.gameId, gameId)
    assert.equal(first.bet, 1)
    assert.equal(first.totalWin, expectedPayout)
    assert.equal(first.balance, 999 + expectedPayout)
    assert.equal(first.spins, 1)

    const replay = await service.spin({
      sessionId: session.id,
      gameId,
      bet: 1,
      idempotencyKey,
      requestId: `cert-${gameId}-request-b`,
    })

    assert.deepEqual(replay, first)
    assert.equal(getRngCalls(), callsAfterFirst)

    await service.close()
  })
}

test('one idempotency key cannot be reused across different games for the same owner', async () => {
  const { service } = createService()
  const session = await service.openSession({ player: 'Cross-game idempotency QA' })
  const idempotencyKey = 'cross-game-cert-0001'

  await service.spin({
    sessionId: session.id,
    gameId: 'golden-vault',
    bet: 1,
    idempotencyKey,
    requestId: 'cross-game-a',
  })

  await assert.rejects(
    service.spin({
      sessionId: session.id,
      gameId: 'neon-fruits',
      bet: 1,
      idempotencyKey,
      requestId: 'cross-game-b',
    }),
    (error) => error?.code === 'IDEMPOTENCY_CONFLICT' && error?.status === 409,
  )

  await service.close()
})

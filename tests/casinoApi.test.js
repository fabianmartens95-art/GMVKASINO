import test from 'node:test'
import assert from 'node:assert/strict'
import { SessionStore } from '../server/sessionStore.js'
import { SlidingWindowRateLimiter } from '../server/rateLimiter.js'
import { AuditLog } from '../server/auditLog.js'
import { CasinoService } from '../server/casinoService.js'

function makeService({ startingBalance = 1000, limit = 15, rng = () => 0, now = Date.now } = {}) {
  const auditLog = new AuditLog({ sink: () => {}, now })
  const service = new CasinoService({
    sessionStore: new SessionStore({ startingBalance, now }),
    rateLimiter: new SlidingWindowRateLimiter({ limit, windowMs: 10_000, now }),
    auditLog,
    rng,
  })
  return { service, auditLog }
}

test('server session owns demo balance and deterministic spin settlement', async () => {
  const { service, auditLog } = makeService()
  const session = await service.openSession({ player: 'Petrus' })

  assert.equal(session.balance, 1000)
  assert.equal(session.player, 'Petrus')

  const result = await service.spin({
    sessionId: session.id,
    gameId: 'golden-vault',
    bet: 1,
    idempotencyKey: 'service-spin-0001',
    requestId: 'service-request-0001',
  })

  assert.equal(result.totalWin, 50)
  assert.equal(result.balance, 1049)
  assert.equal(result.spins, 1)
  assert.ok(result.roundId)
  assert.equal(result.spinId, result.roundId)
  assert.equal(auditLog.recent(1)[0].type, 'spin.resolved')
  assert.equal(auditLog.recent(1)[0].requestId, 'service-request-0001')
})

test('same idempotency key replays the exact round without rerunning RNG or mutating balance', async () => {
  let rngCalls = 0
  const { service, auditLog } = makeService({ rng: () => {
    rngCalls += 1
    return 0
  } })
  const session = await service.openSession()
  const input = {
    sessionId: session.id,
    gameId: 'golden-vault',
    bet: 1,
    idempotencyKey: 'service-spin-replay-0001',
  }

  const first = await service.spin({ ...input, requestId: 'replay-request-0001' })
  const rngCallsAfterFirst = rngCalls
  const second = await service.spin({ ...input, requestId: 'replay-request-0002' })
  const current = await service.getSession(session.id)

  assert.deepEqual(second, first)
  assert.equal(rngCalls, rngCallsAfterFirst)
  assert.equal(current.spins, 1)
  assert.equal(current.balance, first.balance)
  assert.equal(auditLog.recent(1)[0].type, 'game_round.replayed')
  assert.equal(auditLog.recent(1)[0].roundId, first.roundId)
})

test('reusing an idempotency key with a different request fingerprint is rejected', async () => {
  const { service } = makeService()
  const session = await service.openSession()

  await service.spin({
    sessionId: session.id,
    gameId: 'golden-vault',
    bet: 1,
    idempotencyKey: 'service-spin-conflict-0001',
  })

  await assert.rejects(
    service.spin({
      sessionId: session.id,
      gameId: 'golden-vault',
      bet: 2,
      idempotencyKey: 'service-spin-conflict-0001',
    }),
    (error) => error.code === 'IDEMPOTENCY_CONFLICT' && error.status === 409,
  )

  const current = await service.getSession(session.id)
  assert.equal(current.spins, 1)
})

test('server rejects missing idempotency keys, unapproved bets and insufficient demo credits', async () => {
  const { service } = makeService({ startingBalance: 1 })
  const session = await service.openSession()

  await assert.rejects(
    service.spin({ sessionId: session.id, gameId: 'golden-vault', bet: 1 }),
    (error) => error.code === 'IDEMPOTENCY_KEY_REQUIRED' && error.status === 400,
  )

  await assert.rejects(
    service.spin({
      sessionId: session.id,
      gameId: 'golden-vault',
      bet: 3,
      idempotencyKey: 'service-invalid-bet-0001',
    }),
    (error) => error.code === 'INVALID_BET' && error.status === 400,
  )

  await assert.rejects(
    service.spin({
      sessionId: session.id,
      gameId: 'golden-vault',
      bet: 2,
      idempotencyKey: 'service-insufficient-0001',
    }),
    (error) => error.code === 'INSUFFICIENT_DEMO_CREDITS' && error.status === 409,
  )
})

test('spin rate limiter blocks excess distinct rounds per session', async () => {
  const { service } = makeService({ limit: 1 })
  const session = await service.openSession()

  await service.spin({
    sessionId: session.id,
    gameId: 'golden-vault',
    bet: 1,
    idempotencyKey: 'service-rate-0001',
  })

  await assert.rejects(
    service.spin({
      sessionId: session.id,
      gameId: 'golden-vault',
      bet: 1,
      idempotencyKey: 'service-rate-0002',
    }),
    (error) => error.code === 'RATE_LIMITED' && error.status === 429,
  )
})

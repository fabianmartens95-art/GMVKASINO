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

test('server session owns demo balance and deterministic spin settlement', () => {
  const { service, auditLog } = makeService()
  const session = service.openSession({ player: 'Petrus' })

  assert.equal(session.balance, 1000)
  assert.equal(session.player, 'Petrus')

  const result = service.spin({
    sessionId: session.id,
    gameId: 'golden-vault',
    bet: 1,
  })

  assert.equal(result.totalWin, 50)
  assert.equal(result.balance, 1049)
  assert.equal(result.spins, 1)
  assert.equal(auditLog.recent(1)[0].type, 'spin.resolved')
})

test('server rejects unapproved bets and insufficient demo credits', () => {
  const { service } = makeService({ startingBalance: 1 })
  const session = service.openSession()

  assert.throws(
    () => service.spin({ sessionId: session.id, gameId: 'golden-vault', bet: 3 }),
    (error) => error.code === 'INVALID_BET' && error.status === 400,
  )

  assert.throws(
    () => service.spin({ sessionId: session.id, gameId: 'golden-vault', bet: 2 }),
    (error) => error.code === 'INSUFFICIENT_DEMO_CREDITS' && error.status === 409,
  )
})

test('spin rate limiter blocks excess requests per session', () => {
  const { service } = makeService({ limit: 1 })
  const session = service.openSession()

  service.spin({ sessionId: session.id, gameId: 'golden-vault', bet: 1 })

  assert.throws(
    () => service.spin({ sessionId: session.id, gameId: 'golden-vault', bet: 1 }),
    (error) => error.code === 'RATE_LIMITED' && error.status === 429,
  )
})

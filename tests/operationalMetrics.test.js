import test from 'node:test'
import assert from 'node:assert/strict'
import { OperationalMetrics } from '../server/operationalMetrics.js'
import { SessionStore } from '../server/sessionStore.js'
import { SlidingWindowRateLimiter } from '../server/rateLimiter.js'
import { AuditLog } from '../server/auditLog.js'
import { CasinoService } from '../server/casinoService.js'

function makeService({ metrics, now = Date.now, startingBalance = 1000, rng = () => 0 } = {}) {
  return new CasinoService({
    sessionStore: new SessionStore({
      startingBalance,
      idleTtlMs: 100,
      absoluteTtlMs: 1_000,
      now,
      metrics,
    }),
    rateLimiter: new SlidingWindowRateLimiter({ limit: 5, windowMs: 10_000, now }),
    auditLog: new AuditLog({ sink: () => {}, now }),
    rng,
    metrics,
  })
}

test('request metrics are bounded to supplied normalized labels and aggregate latency', () => {
  let now = 1_000
  const metrics = new OperationalMetrics({ now: () => now })

  metrics.recordRequest({ route: '/api/v1/spin', method: 'POST', status: 200, durationMs: 12 })
  metrics.recordRequest({ route: '/api/v1/spin', method: 'POST', status: 409, durationMs: 8 })
  now = 1_100

  const snapshot = metrics.snapshot()
  assert.equal(snapshot.retention, 'process_lifetime')
  assert.equal(snapshot.cardinality.requestSeries, 2)

  const success = snapshot.requests.find((entry) => entry.statusClass === '2xx')
  const error = snapshot.requests.find((entry) => entry.statusClass === '4xx')
  assert.deepEqual(
    { count: success.count, errorCount: success.errorCount, averageDurationMs: success.averageDurationMs },
    { count: 1, errorCount: 0, averageDurationMs: 12 },
  )
  assert.deepEqual(
    { count: error.count, errorCount: error.errorCount, averageDurationMs: error.averageDurationMs },
    { count: 1, errorCount: 1, averageDurationMs: 8 },
  )
})

test('business metrics count lifecycle, expiry and spin outcomes without identifiers', async () => {
  let now = 1_000
  const metrics = new OperationalMetrics({ now: () => now })
  const service = makeService({ metrics, now: () => now })

  const session = await service.openSession({ player: 'Private Player Name' })
  await service.spin({ sessionId: session.id, gameId: 'golden-vault', bet: 1 })
  const resumed = await service.openSession({ sessionId: session.id, player: 'Still Private' })
  const rotated = await service.rotateSession(resumed.id)

  now = 1_101
  await assert.rejects(
    service.getSession(rotated.id),
    (error) => error.code === 'SESSION_REQUIRED',
  )

  const serialized = JSON.stringify(metrics.snapshot())
  const events = metrics.snapshot().events
  assert.equal(events['session.created'], 1)
  assert.equal(events['session.resumed'], 1)
  assert.equal(events['session.rotated'], 1)
  assert.equal(events['session.expired'], 1)
  assert.equal(events['spin.resolved'], 1)
  assert.equal(events['spin.win'], 1)
  assert.equal(serialized.includes(session.id), false)
  assert.equal(serialized.includes('Private Player Name'), false)
  assert.equal(serialized.includes('Still Private'), false)
})

test('unknown business event names are rejected to prevent unbounded cardinality', () => {
  const metrics = new OperationalMetrics()
  assert.equal(metrics.incrementEvent('player.arbitrary.123'), false)
  assert.equal(Object.hasOwn(metrics.snapshot().events, 'player.arbitrary.123'), false)
})

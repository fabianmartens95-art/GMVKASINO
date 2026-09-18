import test from 'node:test'
import assert from 'node:assert/strict'
import {
  OperationalAlertPolicyError,
  evaluateOperationalAlerts,
  normalizeOperationalAlertThresholds,
} from '../server/operationalAlertEvaluator.js'

const healthy = {
  requests: [
    { route: '/api/v1/spin', method: 'POST', statusClass: '2xx', count: 100, maxDurationMs: 200 },
    { route: '/api/v1/spin', method: 'POST', statusClass: '4xx', count: 5, maxDurationMs: 300 },
  ],
  events: {
    'session.expired': 2,
    'spin.rate_limited': 3,
  },
}

test('operational alert evaluator stays green within explicit process-lifetime thresholds', () => {
  const result = evaluateOperationalAlerts(healthy, {
    minRequestsForErrorRate: 20,
    max5xxRate: 0.02,
    maxRouteLatencyMs: 1000,
    maxSessionExpired: 10,
    maxSpinRateLimited: 20,
  })
  assert.equal(result.ok, true)
  assert.deepEqual(result.alerts, [])
  assert.equal(result.observed.totalRequests, 105)
  assert.equal(result.observed.total5xx, 0)
})

test('operational alert evaluator emits machine-readable 5xx, latency and event alerts', () => {
  const result = evaluateOperationalAlerts({
    requests: [
      { route: '/api/v1/spin', method: 'POST', statusClass: '2xx', count: 90, maxDurationMs: 2500 },
      { route: '/api/v1/spin', method: 'POST', statusClass: '5xx', count: 10, maxDurationMs: 3000 },
    ],
    events: {
      'session.expired': 30,
      'spin.rate_limited': 60,
    },
  }, {
    minRequestsForErrorRate: 20,
    max5xxRate: 0.02,
    maxRouteLatencyMs: 2000,
    maxSessionExpired: 25,
    maxSpinRateLimited: 50,
  })

  assert.equal(result.ok, false)
  assert.deepEqual(result.alerts.map((item) => item.code), [
    'HTTP_5XX_RATE_HIGH',
    'ROUTE_LATENCY_HIGH',
    'ROUTE_LATENCY_HIGH',
    'SESSION_EXPIRY_COUNT_HIGH',
    'SPIN_RATE_LIMIT_COUNT_HIGH',
  ])
  assert.equal(result.alerts[0].severity, 'critical')
  assert.equal(result.observed.fiveXxRate, 0.1)
})

test('5xx rate does not alert before minimum request volume', () => {
  const result = evaluateOperationalAlerts({
    requests: [
      { route: '/api/v1/spin', method: 'POST', statusClass: '5xx', count: 1, maxDurationMs: 100 },
    ],
    events: {},
  }, {
    minRequestsForErrorRate: 20,
    max5xxRate: 0.01,
  })
  assert.equal(result.ok, true)
  assert.equal(result.observed.totalRequests, 1)
})

test('malformed thresholds and snapshots fail closed', () => {
  assert.throws(
    () => normalizeOperationalAlertThresholds({ max5xxRate: 2 }),
    (error) => error instanceof OperationalAlertPolicyError
      && error.code === 'INVALID_ALERT_POLICY',
  )
  assert.throws(
    () => evaluateOperationalAlerts({ requests: 'not-an-array', events: {} }),
    (error) => error instanceof OperationalAlertPolicyError
      && error.code === 'INVALID_METRICS_SNAPSHOT',
  )
  assert.throws(
    () => evaluateOperationalAlerts({
      requests: [{ route: '/x', method: 'GET', statusClass: '2xx', count: -1, maxDurationMs: 1 }],
      events: {},
    }),
    (error) => error instanceof OperationalAlertPolicyError,
  )
})

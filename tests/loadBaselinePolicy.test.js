import test from 'node:test'
import assert from 'node:assert/strict'
import {
  LoadBaselinePolicyError,
  evaluateLoadReport,
  normalizeLoadThresholds,
} from '../scripts/loadBaselinePolicy.mjs'

const healthy = {
  configuredRequests: 100,
  completedRequests: 100,
  failedRequests: 0,
  errorRate: 0,
  latencyMs: { p50: 120, p95: 400, p99: 700 },
}

test('load baseline evaluator accepts reports within explicit thresholds', () => {
  const result = evaluateLoadReport(healthy, {
    maxErrorRate: 0.01,
    maxP95Ms: 500,
    maxP99Ms: 1000,
  })
  assert.equal(result.ok, true)
  assert.deepEqual(result.failures, [])
})

test('load baseline evaluator returns machine-readable threshold failures', () => {
  const result = evaluateLoadReport({
    ...healthy,
    completedRequests: 98,
    failedRequests: 2,
    errorRate: 0.02,
    latencyMs: { p50: 200, p95: 900, p99: 1800 },
  }, {
    maxErrorRate: 0.01,
    maxP95Ms: 800,
    maxP99Ms: 1500,
  })

  assert.equal(result.ok, false)
  assert.deepEqual(result.failures.map((failure) => failure.metric), [
    'errorRate',
    'latencyMs.p95',
    'latencyMs.p99',
  ])
})

test('malformed reports and thresholds fail closed', () => {
  assert.throws(
    () => normalizeLoadThresholds({ maxErrorRate: 2 }),
    (error) => error instanceof LoadBaselinePolicyError
      && error.code === 'INVALID_LOAD_POLICY',
  )

  assert.throws(
    () => evaluateLoadReport({
      ...healthy,
      completedRequests: 99,
      failedRequests: 0,
    }),
    (error) => error instanceof LoadBaselinePolicyError
      && error.code === 'INVALID_LOAD_REPORT',
  )
})

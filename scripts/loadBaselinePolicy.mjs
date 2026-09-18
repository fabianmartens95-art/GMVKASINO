export class LoadBaselinePolicyError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'LoadBaselinePolicyError'
    this.code = code
  }
}

function finiteNumber(value, field, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const number = Number(value)
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new LoadBaselinePolicyError(
      'INVALID_LOAD_POLICY',
      `${field} must be a finite number between ${min} and ${max}`,
    )
  }
  return number
}

export function normalizeLoadThresholds({
  maxErrorRate = 0.01,
  maxP95Ms = 1500,
  maxP99Ms = 2500,
} = {}) {
  return Object.freeze({
    maxErrorRate: finiteNumber(maxErrorRate, 'maxErrorRate', { min: 0, max: 1 }),
    maxP95Ms: finiteNumber(maxP95Ms, 'maxP95Ms'),
    maxP99Ms: finiteNumber(maxP99Ms, 'maxP99Ms'),
  })
}

export function evaluateLoadReport(report, thresholds = {}) {
  if (!report || typeof report !== 'object' || Array.isArray(report)) {
    throw new LoadBaselinePolicyError('INVALID_LOAD_REPORT', 'Load report must be an object')
  }

  const normalized = normalizeLoadThresholds(thresholds)
  const errorRate = finiteNumber(report.errorRate, 'report.errorRate', { min: 0, max: 1 })
  const p95 = finiteNumber(report?.latencyMs?.p95, 'report.latencyMs.p95')
  const p99 = finiteNumber(report?.latencyMs?.p99, 'report.latencyMs.p99')
  const configuredRequests = finiteNumber(report.configuredRequests, 'report.configuredRequests', { min: 1 })
  const completedRequests = finiteNumber(report.completedRequests, 'report.completedRequests')
  const failedRequests = finiteNumber(report.failedRequests, 'report.failedRequests')

  if (completedRequests + failedRequests !== configuredRequests) {
    throw new LoadBaselinePolicyError(
      'INVALID_LOAD_REPORT',
      'completedRequests + failedRequests must equal configuredRequests',
    )
  }

  const failures = []
  if (errorRate > normalized.maxErrorRate) {
    failures.push({
      metric: 'errorRate',
      actual: errorRate,
      maximum: normalized.maxErrorRate,
    })
  }
  if (p95 > normalized.maxP95Ms) {
    failures.push({
      metric: 'latencyMs.p95',
      actual: p95,
      maximum: normalized.maxP95Ms,
    })
  }
  if (p99 > normalized.maxP99Ms) {
    failures.push({
      metric: 'latencyMs.p99',
      actual: p99,
      maximum: normalized.maxP99Ms,
    })
  }

  return Object.freeze({
    ok: failures.length === 0,
    thresholds: normalized,
    observed: Object.freeze({
      errorRate,
      p95Ms: p95,
      p99Ms: p99,
      configuredRequests,
    }),
    failures: Object.freeze(failures.map((failure) => Object.freeze(failure))),
  })
}

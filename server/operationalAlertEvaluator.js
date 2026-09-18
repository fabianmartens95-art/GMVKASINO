export class OperationalAlertPolicyError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'OperationalAlertPolicyError'
    this.code = code
  }
}

function finite(value, field, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const number = Number(value)
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new OperationalAlertPolicyError(
      'INVALID_ALERT_POLICY',
      `${field} must be a finite number between ${min} and ${max}`,
    )
  }
  return number
}

function integer(value, field, options = {}) {
  const number = finite(value, field, options)
  if (!Number.isInteger(number)) {
    throw new OperationalAlertPolicyError('INVALID_ALERT_POLICY', `${field} must be an integer`)
  }
  return number
}

export function normalizeOperationalAlertThresholds({
  minRequestsForErrorRate = 20,
  max5xxRate = 0.02,
  maxRouteLatencyMs = 2000,
  maxSessionExpired = 25,
  maxSpinRateLimited = 50,
} = {}) {
  return Object.freeze({
    minRequestsForErrorRate: integer(minRequestsForErrorRate, 'minRequestsForErrorRate', { min: 1, max: 1_000_000 }),
    max5xxRate: finite(max5xxRate, 'max5xxRate', { min: 0, max: 1 }),
    maxRouteLatencyMs: finite(maxRouteLatencyMs, 'maxRouteLatencyMs', { min: 1, max: 300_000 }),
    maxSessionExpired: integer(maxSessionExpired, 'maxSessionExpired', { min: 0, max: 1_000_000_000 }),
    maxSpinRateLimited: integer(maxSpinRateLimited, 'maxSpinRateLimited', { min: 0, max: 1_000_000_000 }),
  })
}

function validatedSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    throw new OperationalAlertPolicyError('INVALID_METRICS_SNAPSHOT', 'Metrics snapshot must be an object')
  }
  if (!Array.isArray(snapshot.requests)) {
    throw new OperationalAlertPolicyError('INVALID_METRICS_SNAPSHOT', 'Metrics snapshot requests must be an array')
  }
  if (!snapshot.events || typeof snapshot.events !== 'object' || Array.isArray(snapshot.events)) {
    throw new OperationalAlertPolicyError('INVALID_METRICS_SNAPSHOT', 'Metrics snapshot events must be an object')
  }

  const requests = snapshot.requests.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new OperationalAlertPolicyError('INVALID_METRICS_SNAPSHOT', `requests[${index}] must be an object`)
    }
    return {
      route: typeof item.route === 'string' && item.route ? item.route : 'unknown',
      method: typeof item.method === 'string' && item.method ? item.method : 'UNKNOWN',
      statusClass: typeof item.statusClass === 'string' ? item.statusClass : 'unknown',
      count: integer(item.count, `requests[${index}].count`, { min: 0 }),
      maxDurationMs: finite(item.maxDurationMs, `requests[${index}].maxDurationMs`, { min: 0 }),
    }
  })

  return {
    requests,
    events: snapshot.events,
  }
}

function alert({ code, severity, actual, threshold, scope = null }) {
  return Object.freeze({ code, severity, actual, threshold, scope })
}

export function evaluateOperationalAlerts(snapshot, thresholds = {}) {
  const policy = normalizeOperationalAlertThresholds(thresholds)
  const metrics = validatedSnapshot(snapshot)
  const alerts = []

  const totalRequests = metrics.requests.reduce((sum, item) => sum + item.count, 0)
  const total5xx = metrics.requests
    .filter((item) => item.statusClass === '5xx')
    .reduce((sum, item) => sum + item.count, 0)
  const fiveXxRate = totalRequests > 0 ? total5xx / totalRequests : 0

  if (totalRequests >= policy.minRequestsForErrorRate && fiveXxRate > policy.max5xxRate) {
    alerts.push(alert({
      code: 'HTTP_5XX_RATE_HIGH',
      severity: 'critical',
      actual: Number(fiveXxRate.toFixed(4)),
      threshold: policy.max5xxRate,
      scope: 'all_routes',
    }))
  }

  for (const item of metrics.requests) {
    if (item.maxDurationMs > policy.maxRouteLatencyMs) {
      alerts.push(alert({
        code: 'ROUTE_LATENCY_HIGH',
        severity: 'warning',
        actual: item.maxDurationMs,
        threshold: policy.maxRouteLatencyMs,
        scope: `${item.method} ${item.route} ${item.statusClass}`,
      }))
    }
  }

  const sessionExpired = integer(metrics.events['session.expired'] || 0, 'events.session.expired', { min: 0 })
  if (sessionExpired > policy.maxSessionExpired) {
    alerts.push(alert({
      code: 'SESSION_EXPIRY_COUNT_HIGH',
      severity: 'warning',
      actual: sessionExpired,
      threshold: policy.maxSessionExpired,
      scope: 'process_lifetime',
    }))
  }

  const spinRateLimited = integer(metrics.events['spin.rate_limited'] || 0, 'events.spin.rate_limited', { min: 0 })
  if (spinRateLimited > policy.maxSpinRateLimited) {
    alerts.push(alert({
      code: 'SPIN_RATE_LIMIT_COUNT_HIGH',
      severity: 'warning',
      actual: spinRateLimited,
      threshold: policy.maxSpinRateLimited,
      scope: 'process_lifetime',
    }))
  }

  return Object.freeze({
    ok: alerts.length === 0,
    retention: 'process_lifetime',
    observed: Object.freeze({
      totalRequests,
      total5xx,
      fiveXxRate: Number(fiveXxRate.toFixed(4)),
      sessionExpired,
      spinRateLimited,
    }),
    thresholds: policy,
    alerts: Object.freeze(alerts),
  })
}

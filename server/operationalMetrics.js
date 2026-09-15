const BUSINESS_EVENTS = new Set([
  'session.created',
  'session.resumed',
  'session.expired',
  'session.rotated',
  'session.invalidated',
  'spin.resolved',
  'spin.win',
  'spin.no_win',
  'spin.rate_limited',
  'spin.invalid_bet',
  'spin.insufficient_credits',
  'spin.game_unavailable',
  'spin.session_missing',
])

function statusClass(status) {
  const numeric = Number(status)
  if (!Number.isFinite(numeric)) return 'unknown'
  return `${Math.floor(numeric / 100)}xx`
}

export class OperationalMetrics {
  constructor({ now = Date.now } = {}) {
    this.now = now
    this.startedAt = now()
    this.requests = new Map()
    this.events = new Map([...BUSINESS_EVENTS].map((event) => [event, 0]))
  }

  recordRequest({ route, method, status, durationMs }) {
    const safeRoute = typeof route === 'string' && route ? route : 'unknown'
    const safeMethod = typeof method === 'string' && method ? method.toUpperCase() : 'UNKNOWN'
    const safeStatusClass = statusClass(status)
    const duration = Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : 0
    const key = `${safeMethod} ${safeRoute} ${safeStatusClass}`
    const current = this.requests.get(key) || {
      route: safeRoute,
      method: safeMethod,
      statusClass: safeStatusClass,
      count: 0,
      errorCount: 0,
      totalDurationMs: 0,
      maxDurationMs: 0,
    }

    current.count += 1
    if (Number(status) >= 400) current.errorCount += 1
    current.totalDurationMs += duration
    current.maxDurationMs = Math.max(current.maxDurationMs, duration)
    this.requests.set(key, current)
  }

  incrementEvent(event, amount = 1) {
    if (!BUSINESS_EVENTS.has(event)) return false
    const increment = Number.isFinite(amount) && amount > 0 ? Math.floor(amount) : 1
    this.events.set(event, (this.events.get(event) || 0) + increment)
    return true
  }

  snapshot() {
    return {
      startedAt: new Date(this.startedAt).toISOString(),
      uptimeMs: Math.max(0, this.now() - this.startedAt),
      retention: 'process_lifetime',
      cardinality: {
        requestSeries: this.requests.size,
        businessSeries: BUSINESS_EVENTS.size,
      },
      requests: [...this.requests.values()]
        .map((metric) => ({
          ...metric,
          averageDurationMs: metric.count > 0
            ? Number((metric.totalDurationMs / metric.count).toFixed(2))
            : 0,
        }))
        .sort((a, b) => `${a.method} ${a.route} ${a.statusClass}`.localeCompare(`${b.method} ${b.route} ${b.statusClass}`)),
      events: Object.fromEntries([...this.events.entries()].sort(([a], [b]) => a.localeCompare(b))),
    }
  }
}

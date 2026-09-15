export class SlidingWindowRateLimiter {
  constructor({ limit = 15, windowMs = 10_000, now = Date.now } = {}) {
    this.limit = limit
    this.windowMs = windowMs
    this.now = now
    this.events = new Map()
  }

  consume(key) {
    const timestamp = this.now()
    const cutoff = timestamp - this.windowMs
    const recent = (this.events.get(key) || []).filter((entry) => entry > cutoff)

    if (recent.length >= this.limit) {
      const retryAfterMs = Math.max(1, this.windowMs - (timestamp - recent[0]))
      this.events.set(key, recent)
      return { allowed: false, retryAfterMs }
    }

    recent.push(timestamp)
    this.events.set(key, recent)
    return { allowed: true, retryAfterMs: 0 }
  }
}

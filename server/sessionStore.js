import { randomBytes } from 'node:crypto'

function cleanPlayer(player) {
  return typeof player === 'string' ? player.trim().slice(0, 40) : ''
}

function createSessionToken() {
  return randomBytes(32).toString('base64url')
}

export class SessionStore {
  constructor({
    startingBalance = 1000,
    ttlMs,
    idleTtlMs = ttlMs ?? 86_400_000,
    absoluteTtlMs = 604_800_000,
    now = Date.now,
    persistence = null,
  } = {}) {
    this.startingBalance = startingBalance
    this.idleTtlMs = idleTtlMs
    this.absoluteTtlMs = absoluteTtlMs
    this.now = now
    this.persistence = persistence
    this.sessions = new Map()

    for (const session of this.persistence?.load?.() || []) {
      if (session && typeof session.id === 'string') {
        this.sessions.set(session.id, { ...session })
      }
    }

    this.pruneExpired()
  }

  create({ player = '' } = {}) {
    const timestamp = this.now()
    const session = {
      id: createSessionToken(),
      player: cleanPlayer(player),
      balance: Number(this.startingBalance.toFixed(2)),
      spins: 0,
      createdAt: timestamp,
      lastSeenAt: timestamp,
    }
    this.sessions.set(session.id, session)
    this.persist()
    return this.snapshot(session)
  }

  get(sessionId) {
    const session = this.findMutable(sessionId)
    if (!session) return null

    session.lastSeenAt = this.now()
    this.persist()
    return this.snapshot(session)
  }

  resumeOrCreate({ sessionId, player } = {}) {
    const existing = this.findMutable(sessionId)
    if (existing) {
      if (typeof player === 'string') existing.player = cleanPlayer(player)
      existing.lastSeenAt = this.now()
      this.persist()
      return { session: this.snapshot(existing), created: false }
    }

    return { session: this.create({ player }), created: true }
  }

  rotate(sessionId) {
    const existing = this.findMutable(sessionId)
    if (!existing) return null

    const timestamp = this.now()
    const rotated = {
      ...existing,
      id: createSessionToken(),
      lastSeenAt: timestamp,
      rotatedAt: timestamp,
    }

    this.sessions.delete(sessionId)
    this.sessions.set(rotated.id, rotated)
    this.persist()
    return this.snapshot(rotated)
  }

  invalidate(sessionId) {
    if (!sessionId) return false
    const removed = this.sessions.delete(sessionId)
    if (removed) this.persist()
    return removed
  }

  settleSpin(sessionId, { bet, payout }) {
    const session = this.findMutable(sessionId)
    if (!session) return { status: 'missing', session: null }
    if (session.balance < bet) return { status: 'insufficient', session: this.snapshot(session) }

    session.balance = Number((session.balance - bet + payout).toFixed(2))
    session.spins += 1
    session.lastSeenAt = this.now()
    this.persist()
    return { status: 'ok', session: this.snapshot(session) }
  }

  applySpin(sessionId, { bet, payout }) {
    const settlement = this.settleSpin(sessionId, { bet, payout })
    return settlement.status === 'ok' ? settlement.session : null
  }

  async checkReadiness() {
    if (!this.persistence) return { ok: true, backend: 'memory' }
    if (typeof this.persistence.check !== 'function') return { ok: true, backend: 'unknown' }
    return this.persistence.check()
  }

  findMutable(sessionId) {
    if (!sessionId) return null
    const session = this.sessions.get(sessionId)
    if (!session) return null

    if (this.isExpired(session)) {
      this.sessions.delete(sessionId)
      this.persist()
      return null
    }

    return session
  }

  pruneExpired() {
    let changed = false
    for (const [sessionId, session] of this.sessions.entries()) {
      if (this.isExpired(session)) {
        this.sessions.delete(sessionId)
        changed = true
      }
    }
    if (changed) this.persist()
  }

  isExpired(session) {
    const timestamp = this.now()
    const idleExpired = timestamp - session.lastSeenAt > this.idleTtlMs
    const absoluteExpired = timestamp - session.createdAt > this.absoluteTtlMs
    return idleExpired || absoluteExpired
  }

  persist() {
    this.persistence?.save?.([...this.sessions.values()].map((session) => this.snapshot(session)))
  }

  snapshot(session) {
    return { ...session }
  }
}

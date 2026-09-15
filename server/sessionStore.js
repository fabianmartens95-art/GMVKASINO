import { randomUUID } from 'node:crypto'

function cleanPlayer(player) {
  return typeof player === 'string' ? player.trim().slice(0, 40) : ''
}

export class SessionStore {
  constructor({ startingBalance = 1000, ttlMs = 86_400_000, now = Date.now } = {}) {
    this.startingBalance = startingBalance
    this.ttlMs = ttlMs
    this.now = now
    this.sessions = new Map()
  }

  create({ player = '' } = {}) {
    const timestamp = this.now()
    const session = {
      id: randomUUID(),
      player: cleanPlayer(player),
      balance: Number(this.startingBalance.toFixed(2)),
      spins: 0,
      createdAt: timestamp,
      lastSeenAt: timestamp,
    }
    this.sessions.set(session.id, session)
    return this.snapshot(session)
  }

  get(sessionId) {
    const session = this.getMutable(sessionId)
    return session ? this.snapshot(session) : null
  }

  resumeOrCreate({ sessionId, player } = {}) {
    const existing = this.getMutable(sessionId)
    if (existing) {
      if (typeof player === 'string') existing.player = cleanPlayer(player)
      existing.lastSeenAt = this.now()
      return { session: this.snapshot(existing), created: false }
    }

    return { session: this.create({ player }), created: true }
  }

  applySpin(sessionId, { bet, payout }) {
    const session = this.getMutable(sessionId)
    if (!session) return null

    session.balance = Number((session.balance - bet + payout).toFixed(2))
    session.spins += 1
    session.lastSeenAt = this.now()
    return this.snapshot(session)
  }

  getMutable(sessionId) {
    if (!sessionId) return null
    const session = this.sessions.get(sessionId)
    if (!session) return null

    if (this.now() - session.lastSeenAt > this.ttlMs) {
      this.sessions.delete(sessionId)
      return null
    }

    session.lastSeenAt = this.now()
    return session
  }

  snapshot(session) {
    return { ...session }
  }
}

import { randomBytes, randomUUID } from 'node:crypto'

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
    metrics = null,
  } = {}) {
    this.startingBalance = startingBalance
    this.idleTtlMs = idleTtlMs
    this.absoluteTtlMs = absoluteTtlMs
    this.now = now
    this.persistence = persistence
    this.metrics = metrics
    this.sessions = new Map()
    this.rounds = new Map()

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
    this.deleteRoundsForSession(sessionId)
    this.sessions.set(rotated.id, rotated)
    this.persist()
    return this.snapshot(rotated)
  }

  invalidate(sessionId) {
    if (!sessionId) return false
    const removed = this.sessions.delete(sessionId)
    if (removed) {
      this.deleteRoundsForSession(sessionId)
      this.persist()
    }
    return removed
  }

  applySpin(sessionId, { bet, payout }) {
    const session = this.findMutable(sessionId)
    if (!session) return null

    session.balance = Number((session.balance - bet + payout).toFixed(2))
    session.spins += 1
    session.lastSeenAt = this.now()
    this.persist()
    return this.snapshot(session)
  }

  async executeGameRound(sessionId, {
    bet,
    gameId,
    idempotencyKey,
    fingerprint,
  } = {}, resolveResult) {
    const session = this.findMutable(sessionId)
    if (!session) return null
    if (typeof resolveResult !== 'function') throw new Error('resolveResult is required')

    const roundKey = `${session.id}:${idempotencyKey}`
    const existing = this.rounds.get(roundKey)
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        return { conflict: true, roundId: existing.response.roundId }
      }
      session.lastSeenAt = this.now()
      this.persist()
      return { replayed: true, response: structuredClone(existing.response) }
    }

    if (session.balance < bet) return { insufficient: true }

    const roundId = randomUUID()
    const result = await resolveResult({ roundId })
    session.balance = Number((session.balance - bet + result.totalWin).toFixed(2))
    session.spins += 1
    session.lastSeenAt = this.now()

    const response = {
      roundId,
      spinId: roundId,
      gameId,
      bet,
      ...result,
      balance: session.balance,
      spins: session.spins,
    }

    this.rounds.set(roundKey, {
      fingerprint,
      response: structuredClone(response),
    })
    this.persist()
    return { replayed: false, response }
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
      this.deleteRoundsForSession(sessionId)
      this.persist()
      this.metrics?.incrementEvent?.('session.expired')
      return null
    }

    return session
  }

  pruneExpired() {
    let expired = 0
    for (const [sessionId, session] of this.sessions.entries()) {
      if (this.isExpired(session)) {
        this.sessions.delete(sessionId)
        this.deleteRoundsForSession(sessionId)
        expired += 1
      }
    }
    if (expired > 0) {
      this.persist()
      this.metrics?.incrementEvent?.('session.expired', expired)
    }
  }

  isExpired(session) {
    const timestamp = this.now()
    const idleExpired = timestamp - session.lastSeenAt > this.idleTtlMs
    const absoluteExpired = timestamp - session.createdAt > this.absoluteTtlMs
    return idleExpired || absoluteExpired
  }

  deleteRoundsForSession(sessionId) {
    const prefix = `${sessionId}:`
    for (const key of this.rounds.keys()) {
      if (key.startsWith(prefix)) this.rounds.delete(key)
    }
  }

  persist() {
    this.persistence?.save?.([...this.sessions.values()].map((session) => this.snapshot(session)))
  }

  snapshot(session) {
    return { ...session }
  }
}

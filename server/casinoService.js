import { createHash, randomUUID } from 'node:crypto'
import { GAMES, getGameById } from '../src/config/games.js'
import { spin } from '../src/game/slotEngine.js'

function sessionRef(sessionId) {
  if (!sessionId) return null
  return createHash('sha256').update(sessionId).digest('hex').slice(0, 16)
}

export class CasinoError extends Error {
  constructor(status, code, message, details = undefined) {
    super(message)
    this.name = 'CasinoError'
    this.status = status
    this.code = code
    this.details = details
  }
}

export class CasinoService {
  constructor({ sessionStore, rateLimiter, auditLog, rng, metrics = null } = {}) {
    this.sessionStore = sessionStore
    this.rateLimiter = rateLimiter
    this.auditLog = auditLog
    this.rng = rng
    this.metrics = metrics
  }

  async checkReadiness() {
    if (typeof this.sessionStore.checkReadiness === 'function') {
      return this.sessionStore.checkReadiness()
    }
    if (typeof this.sessionStore.ready === 'function') {
      const ready = await this.sessionStore.ready()
      if (!ready) throw new Error('Session store is not ready')
      return { ok: true, backend: 'unknown' }
    }
    return { ok: true, backend: 'memory' }
  }

  getGames() {
    return GAMES.map((game) => ({
      ...game,
      allowedBets: game.allowedBets ? [...game.allowedBets] : [],
    }))
  }

  async openSession({ sessionId, player } = {}) {
    const result = await this.sessionStore.resumeOrCreate({ sessionId, player })
    const event = result.created ? 'session.created' : 'session.resumed'
    this.metrics?.incrementEvent?.(event)
    this.auditLog.record(event, {
      sessionRef: sessionRef(result.session.id),
      player: result.session.player || null,
      balance: result.session.balance,
    })
    return result.session
  }

  async getSession(sessionId) {
    const session = await this.sessionStore.get(sessionId)
    if (!session) {
      throw new CasinoError(401, 'SESSION_REQUIRED', 'Demo session is missing or expired')
    }
    return session
  }

  async rotateSession(sessionId) {
    const rotated = await this.sessionStore.rotate(sessionId)
    if (!rotated) {
      throw new CasinoError(401, 'SESSION_REQUIRED', 'Demo session is missing or expired')
    }

    this.metrics?.incrementEvent?.('session.rotated')
    this.auditLog.record('session.rotated', {
      previousSessionRef: sessionRef(sessionId),
      sessionRef: sessionRef(rotated.id),
      player: rotated.player || null,
    })
    return rotated
  }

  async invalidateSession(sessionId) {
    if (!await this.sessionStore.invalidate(sessionId)) {
      throw new CasinoError(401, 'SESSION_REQUIRED', 'Demo session is missing or expired')
    }

    this.metrics?.incrementEvent?.('session.invalidated')
    this.auditLog.record('session.invalidated', {
      sessionRef: sessionRef(sessionId),
    })
    return true
  }

  async spin({ sessionId, gameId, bet }) {
    let session
    try {
      session = await this.getSession(sessionId)
    } catch (error) {
      if (error instanceof CasinoError && error.code === 'SESSION_REQUIRED') {
        this.metrics?.incrementEvent?.('spin.session_missing')
      }
      throw error
    }

    const game = getGameById(gameId)

    if (!game || game.status !== 'playable') {
      this.metrics?.incrementEvent?.('spin.game_unavailable')
      throw new CasinoError(404, 'GAME_UNAVAILABLE', 'Game is not available')
    }

    if (!Number.isFinite(bet) || !game.allowedBets?.includes(bet)) {
      this.metrics?.incrementEvent?.('spin.invalid_bet')
      throw new CasinoError(400, 'INVALID_BET', 'Bet is not allowed', {
        allowedBets: game.allowedBets || [],
      })
    }

    if (session.balance < bet) {
      this.metrics?.incrementEvent?.('spin.insufficient_credits')
      throw new CasinoError(409, 'INSUFFICIENT_DEMO_CREDITS', 'Not enough demo credits')
    }

    const rate = this.rateLimiter.consume(session.id)
    if (!rate.allowed) {
      this.metrics?.incrementEvent?.('spin.rate_limited')
      throw new CasinoError(429, 'RATE_LIMITED', 'Too many spins', {
        retryAfterMs: rate.retryAfterMs,
      })
    }

    const result = spin(bet, this.rng)
    const updatedSession = await this.sessionStore.applySpin(session.id, {
      bet,
      payout: result.totalWin,
    })

    if (!updatedSession) {
      this.metrics?.incrementEvent?.('spin.insufficient_credits')
      throw new CasinoError(409, 'INSUFFICIENT_DEMO_CREDITS', 'Demo balance changed before settlement')
    }

    const spinId = randomUUID()
    this.metrics?.incrementEvent?.('spin.resolved')
    this.metrics?.incrementEvent?.(result.totalWin > 0 ? 'spin.win' : 'spin.no_win')

    this.auditLog.record('spin.resolved', {
      spinId,
      sessionRef: sessionRef(session.id),
      gameId,
      bet,
      payout: result.totalWin,
      balance: updatedSession.balance,
      winLines: result.wins.map((win) => win.line),
    })

    return {
      spinId,
      gameId,
      bet,
      ...result,
      balance: updatedSession.balance,
      spins: updatedSession.spins,
    }
  }

  async ready() {
    await this.checkReadiness()
    return true
  }

  async close() {
    if (typeof this.sessionStore.close === 'function') {
      await this.sessionStore.close()
    }
  }
}

import { randomUUID } from 'node:crypto'
import { GAMES, getGameById } from '../src/config/games.js'
import { spin } from '../src/game/slotEngine.js'

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
  constructor({ sessionStore, rateLimiter, auditLog, rng } = {}) {
    this.sessionStore = sessionStore
    this.rateLimiter = rateLimiter
    this.auditLog = auditLog
    this.rng = rng
  }

  getGames() {
    return GAMES.map((game) => ({
      ...game,
      allowedBets: game.allowedBets ? [...game.allowedBets] : [],
    }))
  }

  async openSession({ sessionId, player } = {}) {
    const result = await this.sessionStore.resumeOrCreate({ sessionId, player })
    this.auditLog.record(result.created ? 'session.created' : 'session.resumed', {
      sessionId: result.session.id,
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

  async spin({ sessionId, gameId, bet }) {
    const session = await this.getSession(sessionId)
    const game = getGameById(gameId)

    if (!game || game.status !== 'playable') {
      throw new CasinoError(404, 'GAME_UNAVAILABLE', 'Game is not available')
    }

    if (!Number.isFinite(bet) || !game.allowedBets?.includes(bet)) {
      throw new CasinoError(400, 'INVALID_BET', 'Bet is not allowed', {
        allowedBets: game.allowedBets || [],
      })
    }

    if (session.balance < bet) {
      throw new CasinoError(409, 'INSUFFICIENT_DEMO_CREDITS', 'Not enough demo credits')
    }

    const rate = this.rateLimiter.consume(session.id)
    if (!rate.allowed) {
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
      throw new CasinoError(409, 'INSUFFICIENT_DEMO_CREDITS', 'Demo balance changed before settlement')
    }

    const spinId = randomUUID()

    this.auditLog.record('spin.resolved', {
      spinId,
      sessionId: session.id,
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
    if (typeof this.sessionStore.ready !== 'function') return true
    return Boolean(await this.sessionStore.ready())
  }

  async close() {
    if (typeof this.sessionStore.close === 'function') {
      await this.sessionStore.close()
    }
  }
}

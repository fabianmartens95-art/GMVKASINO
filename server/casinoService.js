import { createHash } from 'node:crypto'
import { GAMES, getGameById } from '../src/config/games.js'
import { spin } from '../src/game/slotEngine.js'
import {
  createGameRoundFingerprint,
  idempotencyRef,
  normalizeIdempotencyKey,
} from './gameRound.js'
import { PostgresGameRoundStore } from './postgresGameRoundStore.js'

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
  constructor({
    sessionStore,
    gameRoundStore = null,
    rateLimiter,
    auditLog,
    rng,
    metrics = null,
    authService = null,
    authRateLimiter = null,
  } = {}) {
    this.sessionStore = sessionStore
    this.gameRoundStore = gameRoundStore
      || (sessionStore?.pool && sessionStore?.ledger
        ? new PostgresGameRoundStore({ sessionStore })
        : sessionStore)
    this.rateLimiter = rateLimiter
    this.auditLog = auditLog
    this.rng = rng
    this.metrics = metrics
    this.authService = authService
    this.authRateLimiter = authRateLimiter
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

  async openSession({ sessionId, player, accountId = null } = {}) {
    const result = await this.sessionStore.resumeOrCreate({ sessionId, player, accountId })
    if (!result.session) {
      throw new CasinoError(403, 'ACCOUNT_UNAVAILABLE', 'Account is not available')
    }
    const event = result.created ? 'session.created' : 'session.resumed'
    this.metrics?.incrementEvent?.(event)
    this.auditLog.record(event, {
      sessionRef: sessionRef(result.session.id),
      accountId: result.session.accountId || null,
      player: result.session.player || null,
      balance: result.session.balance,
      authRequired: Boolean(result.session.authRequired),
    })
    return result.session
  }

  async getSession(sessionId, { accountId = null } = {}) {
    const session = await this.sessionStore.get(sessionId, { accountId })
    if (!session) {
      throw new CasinoError(401, 'SESSION_REQUIRED', 'Demo session is missing, expired, or not authorized')
    }
    return session
  }

  async getWallet(sessionId, { accountId = null } = {}) {
    if (typeof this.sessionStore.getWallet === 'function') {
      const wallet = await this.sessionStore.getWallet(sessionId, { accountId })
      if (!wallet) {
        throw new CasinoError(401, 'SESSION_REQUIRED', 'Demo session is missing, expired, or not authorized')
      }
      return wallet
    }

    const session = await this.getSession(sessionId, { accountId })
    return {
      id: null,
      accountId: session.accountId || null,
      asset: { code: 'DEMO', decimals: 2, kind: 'demo' },
      balanceAtomic: String(Math.round(session.balance * 100)),
      balance: session.balance,
      balanceExact: Number(session.balance).toFixed(2),
      ledgerBacked: false,
    }
  }

  async rotateSession(sessionId, { accountId = null } = {}) {
    const rotated = await this.sessionStore.rotate(sessionId, { accountId })
    if (!rotated) {
      throw new CasinoError(401, 'SESSION_REQUIRED', 'Demo session is missing, expired, or not authorized')
    }

    this.metrics?.incrementEvent?.('session.rotated')
    this.auditLog.record('session.rotated', {
      previousSessionRef: sessionRef(sessionId),
      sessionRef: sessionRef(rotated.id),
      accountId: rotated.accountId || null,
      player: rotated.player || null,
      authRequired: Boolean(rotated.authRequired),
    })
    return rotated
  }

  async invalidateSession(sessionId, { accountId = null } = {}) {
    if (!await this.sessionStore.invalidate(sessionId, { accountId })) {
      throw new CasinoError(401, 'SESSION_REQUIRED', 'Demo session is missing, expired, or not authorized')
    }

    this.metrics?.incrementEvent?.('session.invalidated')
    this.auditLog.record('session.invalidated', {
      sessionRef: sessionRef(sessionId),
      accountId,
    })
    return true
  }

  async spin({
    sessionId,
    gameId,
    bet,
    accountId = null,
    idempotencyKey,
    requestId = null,
  }) {
    let session
    try {
      session = await this.getSession(sessionId, { accountId })
    } catch (error) {
      if (error instanceof CasinoError && error.code === 'SESSION_REQUIRED') {
        this.metrics?.incrementEvent?.('spin.session_missing')
      }
      throw error
    }

    const normalizedIdempotencyKey = normalizeIdempotencyKey(idempotencyKey)
    if (!normalizedIdempotencyKey) {
      this.metrics?.incrementEvent?.('spin.idempotency_key_invalid')
      throw new CasinoError(
        400,
        'IDEMPOTENCY_KEY_REQUIRED',
        'A valid Idempotency-Key header is required for spins',
      )
    }

    if (!Number.isFinite(bet) || bet <= 0) {
      this.metrics?.incrementEvent?.('spin.invalid_bet')
      throw new CasinoError(400, 'INVALID_BET', 'Bet is not allowed')
    }

    const asset = session.wallet?.asset || { code: 'DEMO', decimals: 2 }
    let roundContext
    try {
      roundContext = createGameRoundFingerprint({
        accountId: session.accountId || '',
        sessionId: session.id,
        gameId,
        bet,
        assetCode: asset.code,
        decimals: asset.decimals,
      })
    } catch {
      this.metrics?.incrementEvent?.('spin.invalid_bet')
      throw new CasinoError(400, 'INVALID_BET', 'Bet is not allowed')
    }

    const execution = await this.gameRoundStore.executeGameRound(session.id, {
      bet,
      betAtomic: roundContext.betAtomic,
      gameId,
      accountId,
      assetCode: asset.code,
      idempotencyKey: normalizedIdempotencyKey,
      fingerprint: roundContext.fingerprint,
      sessionRef: roundContext.sessionRef,
      requestId,
    }, async () => {
      const game = getGameById(gameId)
      if (!game || game.status !== 'playable') {
        this.metrics?.incrementEvent?.('spin.game_unavailable')
        throw new CasinoError(404, 'GAME_UNAVAILABLE', 'Game is not available')
      }

      if (!game.allowedBets?.includes(bet)) {
        this.metrics?.incrementEvent?.('spin.invalid_bet')
        throw new CasinoError(400, 'INVALID_BET', 'Bet is not allowed', {
          allowedBets: game.allowedBets || [],
        })
      }

      return {
        resolve: async () => {
          const rate = this.rateLimiter.consume(session.id)
          if (!rate.allowed) {
            this.metrics?.incrementEvent?.('spin.rate_limited')
            throw new CasinoError(429, 'RATE_LIMITED', 'Too many spins', {
              retryAfterMs: rate.retryAfterMs,
            })
          }

          return spin(bet, this.rng)
        },
      }
    })

    if (!execution) {
      this.metrics?.incrementEvent?.('spin.session_missing')
      throw new CasinoError(401, 'SESSION_REQUIRED', 'Demo session is missing, expired, or not authorized')
    }

    const auditContext = {
      requestId,
      sessionRef: sessionRef(session.id),
      accountId: session.accountId || null,
      gameId,
      bet,
      idempotencyRef: idempotencyRef(normalizedIdempotencyKey),
    }

    if (execution.conflict) {
      this.metrics?.incrementEvent?.('spin.idempotency_conflict')
      this.auditLog.record('game_round.idempotency_conflict', {
        ...auditContext,
        roundId: execution.roundId,
      })
      throw new CasinoError(
        409,
        'IDEMPOTENCY_CONFLICT',
        'Idempotency key was already used for a different game-round request',
        { roundId: execution.roundId },
      )
    }

    if (execution.insufficient) {
      this.metrics?.incrementEvent?.('spin.insufficient_credits')
      throw new CasinoError(409, 'INSUFFICIENT_DEMO_CREDITS', 'Not enough demo credits')
    }

    const result = execution.response
    if (execution.replayed) {
      this.metrics?.incrementEvent?.('spin.replayed')
      this.auditLog.record('game_round.replayed', {
        ...auditContext,
        roundId: result.roundId,
        payout: result.totalWin,
        balance: result.balance,
      })
      return result
    }

    this.metrics?.incrementEvent?.('spin.resolved')
    this.metrics?.incrementEvent?.(result.totalWin > 0 ? 'spin.win' : 'spin.no_win')

    this.auditLog.record('spin.resolved', {
      ...auditContext,
      roundId: result.roundId,
      spinId: result.spinId,
      payout: result.totalWin,
      balance: result.balance,
      winLines: result.wins.map((win) => win.line),
    })

    return result
  }

  async ready() {
    await this.checkReadiness()
    return true
  }

  async close() {
    if (typeof this.auditLog?.flush === 'function') {
      await this.auditLog.flush()
    }
    if (typeof this.sessionStore.close === 'function') {
      await this.sessionStore.close()
    }
  }
}

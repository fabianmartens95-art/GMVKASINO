import { createHash, randomUUID } from 'node:crypto'
import { GAMES, getGameById } from '../src/config/games.js'
import { createDefaultGameRegistry, GameAdapterContractError } from './gameRegistry.js'
import { PostgresGameRoundExecutor } from './postgresGameRoundExecutor.js'

function sessionRef(sessionId) {
  if (!sessionId) return null
  return createHash('sha256').update(sessionId).digest('hex').slice(0, 16)
}

function idempotencyRef(idempotencyKey) {
  if (!idempotencyKey) return null
  return createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 16)
}

function normalizeIdempotencyKey(value) {
  if (value === undefined || value === null || value === '') {
    return `internal:${randomUUID()}`
  }
  if (typeof value !== 'string') {
    throw new CasinoError(400, 'INVALID_IDEMPOTENCY_KEY', 'Idempotency key must be a string')
  }
  const key = value.trim()
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(key)) {
    throw new CasinoError(
      400,
      'INVALID_IDEMPOTENCY_KEY',
      'Idempotency key must be 8-128 characters using letters, numbers, dot, underscore, colon, or hyphen',
    )
  }
  return key
}

function spinFingerprint({ ownerId, gameId, bet }) {
  return createHash('sha256')
    .update(JSON.stringify({ ownerId, gameId, bet, asset: 'DEMO' }))
    .digest('hex')
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
    rateLimiter,
    auditLog,
    rng,
    gameRegistry = null,
    metrics = null,
    authService = null,
    authRateLimiter = null,
  } = {}) {
    this.sessionStore = sessionStore
    this.rateLimiter = rateLimiter
    this.auditLog = auditLog
    this.rng = rng
    this.gameRegistry = gameRegistry || createDefaultGameRegistry()
    this.metrics = metrics
    this.authService = authService
    this.authRateLimiter = authRateLimiter
    this.gameRoundExecutor = sessionStore?.pool && sessionStore?.ledger
      ? new PostgresGameRoundExecutor({ sessionStore })
      : null
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

  async resolveGameResult({ game, bet, requestId = null } = {}) {
    try {
      return await this.gameRegistry.resolve(game.id, {
        bet,
        rng: this.rng,
        game: Object.freeze({ ...game }),
        requestId,
      })
    } catch (error) {
      if (!(error instanceof GameAdapterContractError)) throw error

      this.metrics?.incrementEvent?.('game.contract_rejected')
      this.auditLog.record('game.contract_rejected', {
        requestId,
        gameId: game?.id || null,
        contractCode: error.code,
      })
      throw new CasinoError(
        500,
        'GAME_RESULT_INVALID',
        'Game result failed server contract validation',
      )
    }
  }

  async openSession({ sessionId, player, accountId = null, requestId = null } = {}) {
    const result = await this.sessionStore.resumeOrCreate({ sessionId, player, accountId })
    if (!result.session) {
      throw new CasinoError(403, 'ACCOUNT_UNAVAILABLE', 'Account is not available')
    }
    const event = result.created ? 'session.created' : 'session.resumed'
    this.metrics?.incrementEvent?.(event)
    this.auditLog.record(event, {
      requestId,
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

  async rotateSession(sessionId, { accountId = null, requestId = null } = {}) {
    const rotated = await this.sessionStore.rotate(sessionId, { accountId })
    if (!rotated) {
      throw new CasinoError(401, 'SESSION_REQUIRED', 'Demo session is missing, expired, or not authorized')
    }

    this.metrics?.incrementEvent?.('session.rotated')
    this.auditLog.record('session.rotated', {
      requestId,
      previousSessionRef: sessionRef(sessionId),
      sessionRef: sessionRef(rotated.id),
      accountId: rotated.accountId || null,
      player: rotated.player || null,
      authRequired: Boolean(rotated.authRequired),
    })
    return rotated
  }

  async invalidateSession(sessionId, { accountId = null, requestId = null } = {}) {
    if (!await this.sessionStore.invalidate(sessionId, { accountId })) {
      throw new CasinoError(401, 'SESSION_REQUIRED', 'Demo session is missing, expired, or not authorized')
    }

    this.metrics?.incrementEvent?.('session.invalidated')
    this.auditLog.record('session.invalidated', {
      requestId,
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
    idempotencyKey = null,
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

    const game = getGameById(gameId)

    if (!game || game.status !== 'playable') {
      this.metrics?.incrementEvent?.('spin.game_unavailable')
      throw new CasinoError(404, 'GAME_UNAVAILABLE', 'Game is not available')
    }

    if (!this.gameRegistry.has(gameId)) {
      this.metrics?.incrementEvent?.('spin.game_adapter_missing')
      throw new CasinoError(503, 'GAME_ADAPTER_UNAVAILABLE', 'Game adapter is not available')
    }

    if (!Number.isFinite(bet) || !game.allowedBets?.includes(bet)) {
      this.metrics?.incrementEvent?.('spin.invalid_bet')
      throw new CasinoError(400, 'INVALID_BET', 'Bet is not allowed', {
        allowedBets: game.allowedBets || [],
      })
    }

    const normalizedIdempotencyKey = normalizeIdempotencyKey(idempotencyKey)
    const ownerId = session.accountId || session.id
    const requestFingerprint = spinFingerprint({ ownerId, gameId, bet })

    if (typeof this.sessionStore.getSpinReplay === 'function') {
      const replay = await this.sessionStore.getSpinReplay({
        ownerId,
        idempotencyKey: normalizedIdempotencyKey,
        requestFingerprint,
      })
      if (replay?.conflict) {
        this.metrics?.incrementEvent?.('spin.idempotency_conflict')
        throw new CasinoError(
          409,
          'IDEMPOTENCY_CONFLICT',
          'Idempotency key was already used for a different spin request',
          { roundId: replay.roundId },
        )
      }
      if (replay?.response) {
        this.metrics?.incrementEvent?.('spin.replayed')
        this.auditLog.record('spin.replayed', {
          requestId,
          roundId: replay.roundId,
          sessionRef: sessionRef(session.id),
          accountId: session.accountId || null,
          gameId,
          idempotencyRef: idempotencyRef(normalizedIdempotencyKey),
        })
        return replay.response
      }
    }

    if (session.balance < bet) {
      this.metrics?.incrementEvent?.('spin.insufficient_credits')
      throw new CasinoError(409, 'INSUFFICIENT_DEMO_CREDITS', 'Not enough demo credits')
    }

    let updatedSession
    let roundResponse = null

    if (this.gameRoundExecutor) {
      updatedSession = await this.gameRoundExecutor.execute({
        sessionId: session.id,
        bet,
        gameId,
        accountId,
        ownerId,
        idempotencyKey: normalizedIdempotencyKey,
        requestFingerprint,
        requestId,
        resolveResult: async () => {
          const rate = this.rateLimiter.consume(session.id)
          if (!rate.allowed) {
            this.metrics?.incrementEvent?.('spin.rate_limited')
            throw new CasinoError(429, 'RATE_LIMITED', 'Too many spins', {
              retryAfterMs: rate.retryAfterMs,
            })
          }
          return this.resolveGameResult({ game, bet, requestId })
        },
      })
    } else {
      const rate = this.rateLimiter.consume(session.id)
      if (!rate.allowed) {
        this.metrics?.incrementEvent?.('spin.rate_limited')
        throw new CasinoError(429, 'RATE_LIMITED', 'Too many spins', {
          retryAfterMs: rate.retryAfterMs,
        })
      }

      const result = await this.resolveGameResult({ game, bet, requestId })
      const spinId = randomUUID()
      roundResponse = {
        spinId,
        gameId,
        bet,
        ...result,
      }

      updatedSession = await this.sessionStore.applySpin(session.id, {
        bet,
        payout: result.totalWin,
        spinId,
        gameId,
        accountId,
        ownerId,
        idempotencyKey: normalizedIdempotencyKey,
        requestFingerprint,
        roundResponse,
        requestId,
      })
    }

    if (updatedSession?.idempotencyConflict) {
      this.metrics?.incrementEvent?.('spin.idempotency_conflict')
      throw new CasinoError(
        409,
        'IDEMPOTENCY_CONFLICT',
        'Idempotency key was already used for a different spin request',
        { roundId: updatedSession.roundId },
      )
    }

    if (updatedSession?.replayed && updatedSession.roundResponse) {
      this.metrics?.incrementEvent?.('spin.replayed')
      this.auditLog.record('spin.replayed', {
        requestId,
        roundId: updatedSession.roundId,
        sessionRef: sessionRef(session.id),
        accountId: session.accountId || null,
        gameId,
        idempotencyRef: idempotencyRef(normalizedIdempotencyKey),
      })
      return updatedSession.roundResponse
    }

    if (!updatedSession) {
      this.metrics?.incrementEvent?.('spin.insufficient_credits')
      throw new CasinoError(409, 'INSUFFICIENT_DEMO_CREDITS', 'Demo balance changed before settlement or session is not authorized')
    }

    const response = updatedSession.roundResponse || {
      ...roundResponse,
      balance: updatedSession.balance,
      spins: updatedSession.spins,
    }

    this.metrics?.incrementEvent?.('spin.resolved')
    this.metrics?.incrementEvent?.(response.totalWin > 0 ? 'spin.win' : 'spin.no_win')

    this.auditLog.record('spin.resolved', {
      requestId,
      spinId: response.spinId,
      sessionRef: sessionRef(session.id),
      accountId: updatedSession.accountId || session.accountId || null,
      gameId,
      bet,
      payout: response.totalWin,
      balance: response.balance,
      winLines: Array.isArray(response.wins) ? response.wins.map((win) => win.line) : [],
      idempotencyRef: idempotencyRef(normalizedIdempotencyKey),
    })

    return response
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

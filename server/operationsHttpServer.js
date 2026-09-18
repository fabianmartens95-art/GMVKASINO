import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { requireAccountCapability } from './authorization.js'
import { accessContext } from './accessControl.js'
import { CasinoError } from './casinoService.js'
import { createHttpServer } from './httpServer.js'
import { PlayerDirectory } from './playerDirectory.js'

function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; connect-src 'self'")
}

function requestIdFrom(req) {
  const raw = req.headers['x-request-id']
  const value = Array.isArray(raw) ? raw[0] : raw
  return typeof value === 'string' && /^[A-Za-z0-9._-]{8,80}$/.test(value)
    ? value
    : randomUUID()
}

function bearerToken(req) {
  const raw = req.headers.authorization
  const value = Array.isArray(raw) ? raw[0] : raw
  if (typeof value !== 'string' || !value.startsWith('Bearer ')) return ''
  return value.slice('Bearer '.length).trim()
}

function sendJson(res, status, payload) {
  setSecurityHeaders(res)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  res.end(JSON.stringify(payload))
}

function operationsRoute(req) {
  if (req.method !== 'GET') return null
  const url = new URL(req.url || '/', 'http://localhost')
  if (url.pathname === '/api/v1/ops/overview' || url.pathname === '/api/ops/overview') {
    return { type: 'overview', metricRoute: '/api/v1/ops/overview', url }
  }
  if (url.pathname === '/api/v1/ops/players' || url.pathname === '/api/ops/players') {
    return { type: 'players', metricRoute: '/api/v1/ops/players', url }
  }
  return null
}

function summarizeGames(games) {
  const list = Array.isArray(games) ? games : []
  return {
    total: list.length,
    playable: list.filter((game) => game?.status === 'playable').length,
    comingSoon: list.filter((game) => game?.status === 'coming-soon').length,
  }
}

export function createOperationsHttpServer({
  service,
  config,
  metrics = service?.metrics,
  authService = service?.authService,
  auditLog = service?.auditLog,
  paymentReconciler = service?.paymentReconciler,
  playerDirectory = service?.playerDirectory,
  log = console.log,
  ...baseOptions
} = {}) {
  if (!service) throw new Error('service is required')
  if (!config) throw new Error('config is required')

  const baseServer = createHttpServer({
    service,
    config,
    metrics,
    authService,
    auditLog,
    log,
    ...baseOptions,
  })
  const baseListener = baseServer.listeners('request')[0]
  baseServer.removeAllListeners('request')
  const directory = playerDirectory || (authService?.pool ? new PlayerDirectory({ pool: authService.pool }) : null)

  return createServer(async (req, res) => {
    const route = operationsRoute(req)
    if (!route) return baseListener(req, res)

    const startedAt = Date.now()
    const requestId = requestIdFrom(req)
    res.setHeader('X-Request-Id', requestId)
    res.once('finish', () => {
      const durationMs = Date.now() - startedAt
      metrics?.recordRequest?.({
        route: route.metricRoute,
        method: req.method,
        status: res.statusCode,
        durationMs,
      })
      log(JSON.stringify({
        scope: 'gmvkasino.http',
        requestId,
        method: req.method,
        path: route.metricRoute,
        status: res.statusCode,
        durationMs,
      }))
    })

    try {
      if (!authService) {
        throw new CasinoError(503, 'AUTH_UNAVAILABLE', 'Operations access requires PostgreSQL authentication')
      }

      const token = bearerToken(req)
      if (!token) {
        throw new CasinoError(401, 'AUTH_SESSION_REQUIRED', 'Authentication session is required')
      }

      const profile = await authService.profile(token)
      if (!profile) {
        throw new CasinoError(401, 'AUTH_SESSION_REQUIRED', 'Authentication session is missing or expired')
      }

      if (route.type === 'players') {
        requireAccountCapability(profile.account, 'player.read', { auditLog, requestId })
        if (!directory) {
          throw new CasinoError(503, 'PLAYER_DIRECTORY_UNAVAILABLE', 'Player directory requires PostgreSQL mode')
        }

        const players = await directory.search({
          query: route.url.searchParams.get('q'),
          limit: route.url.searchParams.get('limit'),
        })
        auditLog?.record?.('operations.player_lookup', {
          requestId,
          accountId: profile.account.id,
          resultCount: players.length,
        })
        sendJson(res, 200, {
          readOnly: true,
          players,
          requestId,
        })
        return
      }

      requireAccountCapability(profile.account, 'operations.read', { auditLog, requestId })

      const [readiness, paymentHealth] = await Promise.all([
        service.checkReadiness(),
        paymentReconciler?.sanitizedSummary?.() || Promise.resolve(null),
      ])
      const games = service.getGames()
      const metricsSnapshot = metrics?.snapshot?.() || null
      const overview = {
        mode: 'demo',
        readOnly: true,
        revision: config.deploymentRevision || null,
        persistence: readiness?.backend || 'unknown',
        games: summarizeGames(games),
        access: accessContext(profile.account),
        payments: paymentHealth,
        metrics: metricsSnapshot,
        generatedAt: new Date().toISOString(),
      }

      auditLog?.record?.('operations.overview_read', {
        requestId,
        accountId: profile.account.id,
        roles: profile.account.roles || [],
        paymentReconciliationOk: paymentHealth?.ok ?? null,
        paymentMismatchCount: paymentHealth?.mismatchCount ?? null,
      })

      sendJson(res, 200, { overview, requestId })
    } catch (error) {
      const status = Number.isInteger(error?.status) ? error.status : 500
      const code = typeof error?.code === 'string' ? error.code : 'INTERNAL_ERROR'
      const message = status !== 500 && typeof error?.message === 'string'
        ? error.message
        : 'Internal server error'

      sendJson(res, status, {
        error: {
          code,
          message,
          requestId,
          ...(error?.details ? { details: error.details } : {}),
        },
      })
    }
  })
}

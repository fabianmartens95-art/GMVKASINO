import { randomUUID, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CasinoError } from './casinoService.js'

const PROJECT_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const DEFAULT_STATIC_DIR = join(PROJECT_ROOT, 'dist')
const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
}

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

function sendJson(res, status, payload, extraHeaders = {}) {
  setSecurityHeaders(res)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders,
  })
  res.end(JSON.stringify(payload))
}

async function readJson(req, maxBodyBytes) {
  const chunks = []
  let size = 0

  for await (const chunk of req) {
    size += chunk.length
    if (size > maxBodyBytes) {
      throw new CasinoError(413, 'BODY_TOO_LARGE', 'Request body is too large')
    }
    chunks.push(chunk)
  }

  if (chunks.length === 0) return {}

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new CasinoError(400, 'INVALID_JSON', 'Request body must contain valid JSON')
  }
}

function sessionIdFrom(req) {
  const value = req.headers['x-demo-session']
  return Array.isArray(value) ? value[0] : value
}

function normalizeApiPath(pathname) {
  if (pathname === '/api/v1') return '/'
  if (pathname.startsWith('/api/v1/')) return pathname.slice('/api/v1'.length)
  if (pathname === '/api') return '/'
  if (pathname.startsWith('/api/')) return pathname.slice('/api'.length)
  return null
}

export function normalizeMetricRoute(apiPath) {
  if (apiPath === null) return '/frontend'
  if (apiPath === '/health' || apiPath === '/ready' || apiPath === '/health/ready') return '/api/v1/health/ready'

  const known = new Set([
    '/health/live',
    '/games',
    '/wallet',
    '/session',
    '/session/rotate',
    '/spin',
    '/auth/register',
    '/auth/login',
    '/auth/me',
    '/auth/logout',
    '/internal/metrics',
  ])
  return known.has(apiPath) ? `/api/v1${apiPath}` : '/api/v1/other'
}

function bearerToken(req) {
  const raw = req.headers.authorization
  const value = Array.isArray(raw) ? raw[0] : raw
  if (typeof value !== 'string' || !value.startsWith('Bearer ')) return ''
  return value.slice('Bearer '.length).trim()
}

function tokenMatches(provided, expected) {
  if (!provided || !expected) return false
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

function clientRateKey(req, scope) {
  return `${scope}:${req.socket?.remoteAddress || 'unknown'}`
}

function consumeAuthRateLimit(req, authRateLimiter) {
  if (!authRateLimiter) return
  const rate = authRateLimiter.consume(clientRateKey(req, 'auth'))
  if (!rate.allowed) {
    throw new CasinoError(429, 'AUTH_RATE_LIMITED', 'Too many authentication attempts', {
      retryAfterMs: rate.retryAfterMs,
    })
  }
}

async function optionalAuthAccount(req, authService) {
  const token = bearerToken(req)
  if (!token) return null
  if (!authService) {
    throw new CasinoError(503, 'AUTH_UNAVAILABLE', 'Account authentication requires PostgreSQL mode')
  }
  const authenticated = await authService.authenticate(token)
  if (!authenticated) {
    throw new CasinoError(401, 'AUTH_SESSION_REQUIRED', 'Authentication session is missing or expired')
  }
  return authenticated.account
}

async function requiredAuthProfile(req, authService) {
  if (!authService) {
    throw new CasinoError(503, 'AUTH_UNAVAILABLE', 'Account authentication requires PostgreSQL mode')
  }
  const token = bearerToken(req)
  if (!token) {
    throw new CasinoError(401, 'AUTH_SESSION_REQUIRED', 'Authentication session is required')
  }
  const profile = await authService.profile(token)
  if (!profile) {
    throw new CasinoError(401, 'AUTH_SESSION_REQUIRED', 'Authentication session is missing or expired')
  }
  return { token, profile }
}

export function isPathWithin(rootPath, targetPath) {
  const root = resolve(rootPath)
  const target = resolve(targetPath)
  const relativePath = relative(root, target)

  return relativePath === ''
    || (!isAbsolute(relativePath)
      && relativePath !== '..'
      && !relativePath.startsWith(`..${sep}`))
}

async function serveStatic(res, pathname, staticDir) {
  const requested = pathname === '/' ? '/index.html' : pathname
  const root = resolve(staticDir)
  const target = resolve(root, `.${requested}`)

  if (!isPathWithin(root, target)) {
    sendJson(res, 400, { error: { code: 'INVALID_PATH', message: 'Invalid path' } })
    return
  }

  try {
    const data = await readFile(target)
    setSecurityHeaders(res)
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[extname(target)] || 'application/octet-stream',
      'Cache-Control': target.endsWith('index.html') ? 'no-cache' : 'public, max-age=3600',
    })
    res.end(data)
  } catch {
    try {
      const index = await readFile(join(root, 'index.html'))
      setSecurityHeaders(res)
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache',
      })
      res.end(index)
    } catch {
      sendJson(res, 404, { error: { code: 'NOT_FOUND', message: 'Not found' } })
    }
  }
}

export function createHttpServer({
  service,
  config,
  staticDir = DEFAULT_STATIC_DIR,
  log = console.log,
  metrics = service?.metrics,
  authService = service?.authService,
  authRateLimiter = service?.authRateLimiter,
} = {}) {
  if (!service) throw new Error('service is required')
  if (!config) throw new Error('config is required')

  return createServer(async (req, res) => {
    const startedAt = Date.now()
    const requestId = requestIdFrom(req)
    const url = new URL(req.url || '/', 'http://localhost')
    const pathname = url.pathname
    const apiPath = normalizeApiPath(pathname)
    const metricRoute = normalizeMetricRoute(apiPath)

    res.setHeader('X-Request-Id', requestId)
    res.once('finish', () => {
      const durationMs = Date.now() - startedAt
      metrics?.recordRequest?.({
        route: metricRoute,
        method: req.method,
        status: res.statusCode,
        durationMs,
      })
      log(JSON.stringify({
        scope: 'gmvkasino.http',
        requestId,
        method: req.method,
        path: pathname,
        status: res.statusCode,
        durationMs,
      }))
    })

    try {
      if (apiPath === '/internal/metrics' && req.method === 'GET') {
        if (!config.metricsToken) {
          sendJson(res, 404, { error: { code: 'API_NOT_FOUND', message: 'API route not found', requestId } })
          return
        }
        if (!tokenMatches(bearerToken(req), config.metricsToken)) {
          sendJson(res, 401, { error: { code: 'METRICS_UNAUTHORIZED', message: 'Unauthorized', requestId } })
          return
        }
        sendJson(res, 200, { metrics: metrics?.snapshot?.() || null, requestId })
        return
      }

      if (apiPath === '/health/live' && req.method === 'GET') {
        sendJson(res, 200, {
          ok: true,
          status: 'live',
          mode: 'demo',
          milestone: 'M6',
          apiVersion: 'v1',
          requestId,
        })
        return
      }

      if ((apiPath === '/health/ready' || apiPath === '/health' || apiPath === '/ready') && req.method === 'GET') {
        try {
          const readiness = await service.checkReadiness()
          sendJson(res, 200, {
            ok: true,
            status: 'ready',
            mode: 'demo',
            milestone: 'M6',
            apiVersion: 'v1',
            persistence: readiness?.backend || 'unknown',
            requestId,
          })
        } catch {
          sendJson(res, 503, {
            ok: false,
            status: 'not_ready',
            mode: 'demo',
            milestone: 'M6',
            apiVersion: 'v1',
            requestId,
          })
        }
        return
      }

      if ((apiPath === '/auth/register' || apiPath === '/auth/login') && req.method === 'POST') {
        if (!authService) {
          throw new CasinoError(503, 'AUTH_UNAVAILABLE', 'Account authentication requires PostgreSQL mode')
        }
        consumeAuthRateLimit(req, authRateLimiter)
        const body = await readJson(req, config.maxBodyBytes)
        let authResult
        let session

        if (apiPath === '/auth/register') {
          const guestSessionId = sessionIdFrom(req)
          if (guestSessionId) {
            const guestSession = await service.getSession(guestSessionId)
            authResult = await authService.upgradeGuest({
              accountId: guestSession.accountId,
              sessionId: guestSession.id,
              ...body,
            })
            session = await service.getSession(guestSession.id, { accountId: authResult.account.id })
          } else {
            authResult = await authService.register(body)
            session = await service.openSession({ accountId: authResult.account.id })
          }
        } else {
          authResult = await authService.login(body)
          session = await service.openSession({ accountId: authResult.account.id })
        }

        const event = authResult.upgraded
          ? 'auth.guest_upgraded'
          : apiPath === '/auth/register'
            ? 'auth.registered'
            : 'auth.logged_in'
        metrics?.incrementEvent?.(event)
        sendJson(res, apiPath === '/auth/register' ? 201 : 200, {
          account: authResult.account,
          wallet: authResult.wallet,
          auth: authResult.auth,
          session,
          upgraded: Boolean(authResult.upgraded),
          requestId,
        })
        return
      }

      if (apiPath === '/auth/me' && req.method === 'GET') {
        const { profile } = await requiredAuthProfile(req, authService)
        sendJson(res, 200, { profile, requestId })
        return
      }

      if (apiPath === '/auth/logout' && req.method === 'POST') {
        const { token, profile } = await requiredAuthProfile(req, authService)
        const demoSessionId = sessionIdFrom(req)
        if (demoSessionId) {
          await service.invalidateSession(demoSessionId, { accountId: profile.account.id }).catch(() => {})
        }
        await authService.logout(token)
        metrics?.incrementEvent?.('auth.logged_out')
        sendJson(res, 200, { loggedOut: true, requestId })
        return
      }

      if (apiPath === '/games' && req.method === 'GET') {
        sendJson(res, 200, { games: service.getGames(), requestId })
        return
      }

      if (apiPath === '/wallet' && req.method === 'GET') {
        const account = await optionalAuthAccount(req, authService)
        const wallet = await service.getWallet(sessionIdFrom(req), { accountId: account?.id || null })
        sendJson(res, 200, { wallet, requestId })
        return
      }

      if (apiPath === '/session/rotate' && req.method === 'POST') {
        const account = await optionalAuthAccount(req, authService)
        const session = await service.rotateSession(sessionIdFrom(req), { accountId: account?.id || null })
        sendJson(res, 200, { session, requestId })
        return
      }

      if (apiPath === '/session' && req.method === 'DELETE') {
        const account = await optionalAuthAccount(req, authService)
        await service.invalidateSession(sessionIdFrom(req), { accountId: account?.id || null })
        sendJson(res, 200, { invalidated: true, requestId })
        return
      }

      if (apiPath === '/session' && req.method === 'POST') {
        const account = await optionalAuthAccount(req, authService)
        const body = await readJson(req, config.maxBodyBytes)
        const session = await service.openSession({
          sessionId: sessionIdFrom(req),
          player: body.player,
          accountId: account?.id || null,
        })
        sendJson(res, 200, { session, requestId })
        return
      }

      if (apiPath === '/session' && req.method === 'GET') {
        const account = await optionalAuthAccount(req, authService)
        const session = await service.getSession(sessionIdFrom(req), { accountId: account?.id || null })
        sendJson(res, 200, { session, requestId })
        return
      }

      if (apiPath === '/spin' && req.method === 'POST') {
        const account = await optionalAuthAccount(req, authService)
        const body = await readJson(req, config.maxBodyBytes)
        const result = await service.spin({
          sessionId: sessionIdFrom(req),
          gameId: body.gameId,
          bet: body.bet,
          accountId: account?.id || null,
        })
        sendJson(res, 200, { result, requestId })
        return
      }

      if (apiPath !== null) {
        sendJson(res, 404, { error: { code: 'API_NOT_FOUND', message: 'API route not found', requestId } })
        return
      }

      if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendJson(res, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed', requestId } })
        return
      }

      await serveStatic(res, pathname, staticDir)
    } catch (error) {
      const status = Number.isInteger(error?.status) ? error.status : 500
      const code = typeof error?.code === 'string' ? error.code : 'INTERNAL_ERROR'
      const message = status !== 500 && typeof error?.message === 'string'
        ? error.message
        : 'Internal server error'
      const headers = status === 429 && error.details?.retryAfterMs
        ? { 'Retry-After': String(Math.ceil(error.details.retryAfterMs / 1000)) }
        : {}

      sendJson(res, status, {
        error: {
          code,
          message,
          requestId,
          ...(error.details ? { details: error.details } : {}),
        },
      }, headers)
    }
  })
}

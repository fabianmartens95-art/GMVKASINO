import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'
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

async function serveStatic(res, pathname, staticDir) {
  const requested = pathname === '/' ? '/index.html' : pathname
  const target = resolve(staticDir, `.${requested}`)

  if (!target.startsWith(resolve(staticDir))) {
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
      const index = await readFile(join(staticDir, 'index.html'))
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

export function createHttpServer({ service, config, staticDir = DEFAULT_STATIC_DIR, log = console.log } = {}) {
  if (!service) throw new Error('service is required')
  if (!config) throw new Error('config is required')

  return createServer(async (req, res) => {
    const startedAt = Date.now()
    const requestId = requestIdFrom(req)
    const url = new URL(req.url || '/', 'http://localhost')
    const pathname = url.pathname
    const apiPath = normalizeApiPath(pathname)

    res.setHeader('X-Request-Id', requestId)
    res.once('finish', () => {
      log(JSON.stringify({
        scope: 'gmvkasino.http',
        requestId,
        method: req.method,
        path: pathname,
        status: res.statusCode,
        durationMs: Date.now() - startedAt,
      }))
    })

    try {
      if (apiPath === '/health' && req.method === 'GET') {
        sendJson(res, 200, { ok: true, mode: 'demo', milestone: 'M4', apiVersion: 'v1', requestId })
        return
      }

      if (apiPath === '/games' && req.method === 'GET') {
        sendJson(res, 200, { games: service.getGames(), requestId })
        return
      }

      if (apiPath === '/session' && req.method === 'POST') {
        const body = await readJson(req, config.maxBodyBytes)
        const session = service.openSession({
          sessionId: sessionIdFrom(req),
          player: body.player,
        })
        sendJson(res, 200, { session, requestId })
        return
      }

      if (apiPath === '/session' && req.method === 'GET') {
        const session = service.getSession(sessionIdFrom(req))
        sendJson(res, 200, { session, requestId })
        return
      }

      if (apiPath === '/spin' && req.method === 'POST') {
        const body = await readJson(req, config.maxBodyBytes)
        const result = service.spin({
          sessionId: sessionIdFrom(req),
          gameId: body.gameId,
          bet: body.bet,
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
      const status = error instanceof CasinoError ? error.status : 500
      const code = error instanceof CasinoError ? error.code : 'INTERNAL_ERROR'
      const message = error instanceof CasinoError ? error.message : 'Internal server error'
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

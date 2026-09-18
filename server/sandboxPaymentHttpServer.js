import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { requireAccountCapability } from './authorization.js'
import { CasinoError } from './casinoService.js'
import { createOperationsHttpServer } from './operationsHttpServer.js'
import { SandboxPaymentProviderAdapter } from './paymentProviderAdapter.js'
import { verifyPaymentWebhookEnvelope } from './paymentWebhookVerifier.js'

function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; connect-src 'self'")
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

async function readRawBody(req, maxBodyBytes) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > maxBodyBytes) throw new CasinoError(413, 'BODY_TOO_LARGE', 'Request body is too large')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

async function readJson(req, maxBodyBytes) {
  const rawBody = await readRawBody(req, maxBodyBytes)
  if (rawBody.length === 0) return {}
  try {
    return JSON.parse(rawBody.toString('utf8'))
  } catch {
    throw new CasinoError(400, 'INVALID_JSON', 'Request body must contain valid JSON')
  }
}

function headerValue(req, name) {
  const raw = req.headers[name]
  return Array.isArray(raw) ? raw[0] : raw
}

function paymentRoute(req) {
  const url = new URL(req.url || '/', 'http://localhost')
  const pathname = url.pathname
  if (
    pathname === '/api/v1/sandbox/providers/sandbox/webhook'
    || pathname === '/api/sandbox/providers/sandbox/webhook'
  ) {
    return { type: 'provider-webhook' }
  }
  if (pathname === '/api/v1/sandbox/payments/queue' || pathname === '/api/sandbox/payments/queue') {
    return { type: 'queue' }
  }
  if (pathname === '/api/v1/sandbox/payments' || pathname === '/api/sandbox/payments') {
    return { type: 'list' }
  }
  if (pathname === '/api/v1/sandbox/payments/deposits' || pathname === '/api/sandbox/payments/deposits') {
    return { type: 'create', kind: 'deposit' }
  }
  if (pathname === '/api/v1/sandbox/payments/withdrawals' || pathname === '/api/sandbox/payments/withdrawals') {
    return { type: 'create', kind: 'withdrawal' }
  }
  const match = pathname.match(/^\/api(?:\/v1)?\/sandbox\/payments\/([^/]+)\/transition$/)
  if (match) return { type: 'transition', operationId: decodeURIComponent(match[1]) }
  return null
}

async function requiredProfile(req, authService, capability, auditLog, requestId) {
  if (!authService) {
    throw new CasinoError(503, 'AUTH_UNAVAILABLE', 'Sandbox payments require PostgreSQL authentication')
  }
  const token = bearerToken(req)
  if (!token) throw new CasinoError(401, 'AUTH_SESSION_REQUIRED', 'Authentication session is required')
  const profile = await authService.profile(token)
  if (!profile) throw new CasinoError(401, 'AUTH_SESSION_REQUIRED', 'Authentication session is missing or expired')
  requireAccountCapability(profile.account, capability, { auditLog, requestId })
  return profile
}

export function createSandboxPaymentHttpServer({
  service,
  config,
  metrics = service?.metrics,
  authService = service?.authService,
  auditLog = service?.auditLog,
  paymentService = service?.paymentService,
  paymentQueue = service?.paymentQueue,
  log = console.log,
  ...baseOptions
} = {}) {
  if (!service) throw new Error('service is required')
  if (!config) throw new Error('config is required')

  const baseServer = createOperationsHttpServer({
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
  const sandboxProviderAdapter = new SandboxPaymentProviderAdapter({ provider: 'sandbox' })

  return createServer(async (req, res) => {
    const route = paymentRoute(req)
    if (!route) return baseListener(req, res)

    const startedAt = Date.now()
    const requestId = requestIdFrom(req)
    const metricRoute = route.type === 'provider-webhook'
      ? '/api/v1/sandbox/providers/sandbox/webhook'
      : route.type === 'transition'
        ? '/api/v1/sandbox/payments/:id/transition'
        : route.type === 'create'
        ? `/api/v1/sandbox/payments/${route.kind === 'deposit' ? 'deposits' : 'withdrawals'}`
        : route.type === 'queue'
          ? '/api/v1/sandbox/payments/queue'
          : '/api/v1/sandbox/payments'

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
        path: metricRoute,
        status: res.statusCode,
        durationMs,
      }))
    })

    try {
      if (route.type === 'provider-webhook' && !config.sandboxPaymentWebhookSecret) {
        sendJson(res, 404, {
          error: { code: 'API_NOT_FOUND', message: 'API route not found', requestId },
        })
        return
      }

      if (!paymentService) {
        throw new CasinoError(503, 'SANDBOX_PAYMENTS_UNAVAILABLE', 'Sandbox payments require PostgreSQL mode')
      }

      if (route.type === 'provider-webhook' && req.method === 'POST') {
        const rawBody = await readRawBody(req, config.maxBodyBytes)
        verifyPaymentWebhookEnvelope({
          secret: config.sandboxPaymentWebhookSecret,
          timestamp: headerValue(req, 'x-provider-timestamp'),
          signature: headerValue(req, 'x-provider-signature'),
          rawBody,
        })

        let payload
        try {
          payload = JSON.parse(rawBody.toString('utf8'))
        } catch {
          throw new CasinoError(400, 'INVALID_JSON', 'Request body must contain valid JSON')
        }

        const transition = sandboxProviderAdapter.toTransition(payload, {
          actorAccountId: null,
          requestId,
        })
        const operation = await paymentService.transition(transition)
        auditLog?.record?.('sandbox_payment.provider_webhook_accepted', {
          requestId,
          provider: transition.providerEvent.provider,
          paymentOperationId: transition.operationId,
          providerEventRef: transition.eventId,
        })
        sendJson(res, 200, {
          sandbox: true,
          mode: 'demo',
          accepted: true,
          operation: {
            id: operation.id,
            status: operation.status,
            replayed: Boolean(operation.replayed),
          },
          requestId,
        })
        return
      }

      if (route.type === 'queue' && req.method === 'GET') {
        const { account } = await requiredProfile(req, authService, 'payments.sandbox.manage', auditLog, requestId)
        if (!paymentQueue) throw new CasinoError(503, 'SANDBOX_PAYMENT_QUEUE_UNAVAILABLE', 'Sandbox payment queue requires PostgreSQL mode')
        const operations = await paymentQueue.list()
        auditLog?.record?.('sandbox_payment.queue_read', {
          requestId,
          accountId: account.id,
          operationCount: operations.length,
        })
        sendJson(res, 200, { sandbox: true, mode: 'demo', operations, requestId })
        return
      }

      if (route.type === 'list' && req.method === 'GET') {
        const { account } = await requiredProfile(req, authService, 'payments.sandbox.read', auditLog, requestId)
        const operations = await paymentService.listOperations({ accountId: account.id })
        sendJson(res, 200, { sandbox: true, mode: 'demo', operations, requestId })
        return
      }

      if (route.type === 'create' && req.method === 'POST') {
        const { account } = await requiredProfile(req, authService, 'payments.sandbox.create', auditLog, requestId)
        const body = await readJson(req, config.maxBodyBytes)
        const operation = await paymentService.createOperation({
          accountId: account.id,
          kind: route.kind,
          amount: body.amount,
          idempotencyKey: body.idempotencyKey,
          requestId,
        })
        sendJson(res, operation.replayed ? 200 : 201, {
          sandbox: true,
          mode: 'demo',
          operation,
          requestId,
        })
        return
      }

      if (route.type === 'transition' && req.method === 'POST') {
        const { account } = await requiredProfile(req, authService, 'payments.sandbox.manage', auditLog, requestId)
        const body = await readJson(req, config.maxBodyBytes)
        const operation = await paymentService.transition({
          operationId: route.operationId,
          action: body.action,
          eventId: body.eventId,
          actorAccountId: account.id,
          requestId,
        })
        sendJson(res, 200, {
          sandbox: true,
          mode: 'demo',
          operation,
          requestId,
        })
        return
      }

      sendJson(res, 405, {
        error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed', requestId },
      })
    } catch (error) {
      const status = Number.isInteger(error?.status) ? error.status : 500
      const code = typeof error?.code === 'string' ? error.code : 'INTERNAL_ERROR'
      const message = status !== 500 && typeof error?.message === 'string'
        ? error.message
        : 'Internal server error'
      const headers = status === 429 && error?.details?.retryAfterMs
        ? { 'Retry-After': String(Math.ceil(error.details.retryAfterMs / 1000)) }
        : {}
      sendJson(res, status, {
        error: {
          code,
          message,
          requestId,
          ...(error?.details ? { details: error.details } : {}),
        },
      }, headers)
    }
  })
}

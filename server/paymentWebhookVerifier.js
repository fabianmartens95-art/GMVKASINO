import { createHmac, timingSafeEqual } from 'node:crypto'

const DEFAULT_TOLERANCE_SECONDS = 300

export class PaymentWebhookVerificationError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'PaymentWebhookVerificationError'
    this.code = code
    this.status = 401
  }
}

function secretBuffer(secret) {
  const value = Buffer.isBuffer(secret) ? secret : Buffer.from(typeof secret === 'string' ? secret : '')
  if (value.length < 32 || value.length > 4096) {
    throw new PaymentWebhookVerificationError(
      'INVALID_WEBHOOK_SECRET',
      'Webhook secret must be between 32 and 4096 bytes',
    )
  }
  return value
}

function bodyBuffer(rawBody) {
  if (Buffer.isBuffer(rawBody)) return rawBody
  if (typeof rawBody === 'string') return Buffer.from(rawBody, 'utf8')
  throw new PaymentWebhookVerificationError(
    'INVALID_WEBHOOK_BODY',
    'Webhook verification requires the unmodified raw request body',
  )
}

function normalizeTimestamp(value) {
  const text = typeof value === 'number' ? String(value) : value
  if (typeof text !== 'string' || !/^\d{10,13}$/.test(text)) {
    throw new PaymentWebhookVerificationError('INVALID_WEBHOOK_TIMESTAMP', 'Webhook timestamp is invalid')
  }
  const numeric = Number(text)
  if (!Number.isSafeInteger(numeric)) {
    throw new PaymentWebhookVerificationError('INVALID_WEBHOOK_TIMESTAMP', 'Webhook timestamp is invalid')
  }
  return text.length === 13
    ? { canonical: text, timestampMs: numeric }
    : { canonical: text, timestampMs: numeric * 1000 }
}

function normalizeSignature(value) {
  if (typeof value !== 'string') {
    throw new PaymentWebhookVerificationError('INVALID_WEBHOOK_SIGNATURE', 'Webhook signature is invalid')
  }
  const match = value.trim().match(/^sha256=([a-fA-F0-9]{64})$/)
  if (!match) {
    throw new PaymentWebhookVerificationError('INVALID_WEBHOOK_SIGNATURE', 'Webhook signature is invalid')
  }
  return Buffer.from(match[1], 'hex')
}

function normalizeTolerance(value) {
  const seconds = value ?? DEFAULT_TOLERANCE_SECONDS
  if (!Number.isInteger(seconds) || seconds < 30 || seconds > 900) {
    throw new PaymentWebhookVerificationError(
      'INVALID_WEBHOOK_TOLERANCE',
      'Webhook tolerance must be an integer between 30 and 900 seconds',
    )
  }
  return seconds
}

export function signPaymentWebhookEnvelope({ secret, timestamp, rawBody } = {}) {
  const key = secretBuffer(secret)
  const body = bodyBuffer(rawBody)
  const normalizedTimestamp = normalizeTimestamp(timestamp)
  const canonical = Buffer.concat([
    Buffer.from(`${normalizedTimestamp.canonical}.`, 'utf8'),
    body,
  ])
  return `sha256=${createHmac('sha256', key).update(canonical).digest('hex')}`
}

export function verifyPaymentWebhookEnvelope({
  secret,
  timestamp,
  rawBody,
  signature,
  now = Date.now,
  toleranceSeconds = DEFAULT_TOLERANCE_SECONDS,
} = {}) {
  const key = secretBuffer(secret)
  const body = bodyBuffer(rawBody)
  const normalizedTimestamp = normalizeTimestamp(timestamp)
  const tolerance = normalizeTolerance(toleranceSeconds)
  const nowMs = typeof now === 'function' ? Number(now()) : Number(now)

  if (!Number.isFinite(nowMs)) {
    throw new PaymentWebhookVerificationError('INVALID_WEBHOOK_CLOCK', 'Webhook verification clock is invalid')
  }

  const driftMs = Math.abs(nowMs - normalizedTimestamp.timestampMs)
  if (driftMs > tolerance * 1000) {
    throw new PaymentWebhookVerificationError('WEBHOOK_TIMESTAMP_OUT_OF_RANGE', 'Webhook timestamp is outside the allowed window')
  }

  const supplied = normalizeSignature(signature)
  const canonical = Buffer.concat([
    Buffer.from(`${normalizedTimestamp.canonical}.`, 'utf8'),
    body,
  ])
  const expected = createHmac('sha256', key).update(canonical).digest()

  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw new PaymentWebhookVerificationError('WEBHOOK_SIGNATURE_MISMATCH', 'Webhook signature verification failed')
  }

  return Object.freeze({
    verified: true,
    timestampMs: normalizedTimestamp.timestampMs,
    ageMs: nowMs - normalizedTimestamp.timestampMs,
  })
}

const ALLOWED_ACTIONS = new Set(['approve', 'complete', 'fail', 'reject'])
const ALLOWED_KEYS = new Set([
  'provider',
  'eventId',
  'operationId',
  'action',
  'occurredAt',
  'reference',
])

export class PaymentProviderEventError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'PaymentProviderEventError'
    this.code = code
    this.status = 400
  }
}

function boundedString(value, field, { min = 1, max = 160 } = {}) {
  if (typeof value !== 'string') {
    throw new PaymentProviderEventError('INVALID_PROVIDER_EVENT', `${field} must be a string`)
  }
  const normalized = value.trim()
  if (normalized.length < min || normalized.length > max) {
    throw new PaymentProviderEventError(
      'INVALID_PROVIDER_EVENT',
      `${field} must be between ${min} and ${max} characters`,
    )
  }
  return normalized
}

function normalizeOccurredAt(value) {
  if (value === undefined || value === null || value === '') return null
  const timestamp = typeof value === 'number' ? value : Date.parse(value)
  if (!Number.isFinite(timestamp) || timestamp < 0) {
    throw new PaymentProviderEventError('INVALID_PROVIDER_EVENT', 'occurredAt must be a valid timestamp')
  }
  return new Date(timestamp).toISOString()
}

export function normalizePaymentProviderEvent(payload, { expectedProvider = null } = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new PaymentProviderEventError('INVALID_PROVIDER_EVENT', 'Provider event must be an object')
  }

  const unknownKeys = Object.keys(payload).filter((key) => !ALLOWED_KEYS.has(key))
  if (unknownKeys.length) {
    throw new PaymentProviderEventError(
      'INVALID_PROVIDER_EVENT',
      `Provider event contains unsupported fields: ${unknownKeys.sort().join(', ')}`,
    )
  }

  const provider = boundedString(payload.provider, 'provider', { max: 40 }).toLowerCase()
  if (expectedProvider && provider !== String(expectedProvider).trim().toLowerCase()) {
    throw new PaymentProviderEventError('PROVIDER_MISMATCH', 'Provider event came from an unexpected provider')
  }

  const eventId = boundedString(payload.eventId, 'eventId')
  const operationId = boundedString(payload.operationId, 'operationId')
  const action = boundedString(payload.action, 'action', { max: 32 }).toLowerCase()
  if (!ALLOWED_ACTIONS.has(action)) {
    throw new PaymentProviderEventError('UNSUPPORTED_PROVIDER_ACTION', `Unsupported provider action: ${action}`)
  }

  const reference = payload.reference === undefined || payload.reference === null || payload.reference === ''
    ? null
    : boundedString(payload.reference, 'reference', { max: 160 })

  return Object.freeze({
    provider,
    eventId,
    operationId,
    action,
    occurredAt: normalizeOccurredAt(payload.occurredAt),
    reference,
  })
}

export class SandboxPaymentProviderAdapter {
  constructor({ provider = 'sandbox' } = {}) {
    this.provider = boundedString(provider, 'provider', { max: 40 }).toLowerCase()
  }

  normalizeEvent(payload) {
    return normalizePaymentProviderEvent(payload, { expectedProvider: this.provider })
  }

  toTransition(payload, { actorAccountId = null, requestId = null } = {}) {
    const event = this.normalizeEvent(payload)
    return Object.freeze({
      operationId: event.operationId,
      action: event.action,
      eventId: `${event.provider}:${event.eventId}`,
      actorAccountId,
      requestId,
      providerEvent: event,
    })
  }
}

function hasValue(env, key) {
  const value = env[key]
  return value !== undefined && value !== null && String(value).trim() !== ''
}

function positiveNumber(env, key, fallback, { integer = false, max = Number.POSITIVE_INFINITY } = {}) {
  if (!hasValue(env, key)) return fallback

  const parsed = Number(env[key])
  const valid = Number.isFinite(parsed)
    && parsed > 0
    && parsed <= max
    && (!integer || Number.isInteger(parsed))

  if (!valid) {
    const constraints = [
      'a positive number',
      ...(integer ? ['integer'] : []),
      ...(Number.isFinite(max) ? [`<= ${max}`] : []),
    ].join(', ')
    throw new Error(`Invalid ${key}: expected ${constraints}`)
  }

  return parsed
}

function nonEmptyString(env, key, fallback) {
  if (!hasValue(env, key)) return fallback
  const value = String(env[key]).trim()
  if (!value) throw new Error(`Invalid ${key}: expected a non-empty string`)
  return value
}

export function loadServerConfig(env = process.env) {
  const sessionIdleTtlMs = hasValue(env, 'DEMO_SESSION_IDLE_TTL_MS')
    ? positiveNumber(env, 'DEMO_SESSION_IDLE_TTL_MS', 86_400_000, { integer: true })
    : positiveNumber(env, 'DEMO_SESSION_TTL_MS', 86_400_000, { integer: true })

  return Object.freeze({
    host: nonEmptyString(env, 'HOST', '0.0.0.0'),
    port: positiveNumber(env, 'PORT', 8787, { integer: true, max: 65_535 }),
    startingBalance: positiveNumber(env, 'DEMO_STARTING_BALANCE', 1000),
    sessionIdleTtlMs,
    sessionAbsoluteTtlMs: positiveNumber(env, 'DEMO_SESSION_ABSOLUTE_TTL_MS', 604_800_000, { integer: true }),
    sessionStorePath: nonEmptyString(env, 'DEMO_SESSION_STORE_PATH', '.data/demo-sessions.json'),
    rateLimitWindowMs: positiveNumber(env, 'SPIN_RATE_LIMIT_WINDOW_MS', 10_000, { integer: true }),
    rateLimitMaxSpins: positiveNumber(env, 'SPIN_RATE_LIMIT_MAX', 15, { integer: true }),
    maxBodyBytes: positiveNumber(env, 'MAX_JSON_BODY_BYTES', 16_384, { integer: true }),
    auditMaxEvents: positiveNumber(env, 'AUDIT_MAX_EVENTS', 1000, { integer: true }),
  })
}

export const SERVER_CONFIG = loadServerConfig()

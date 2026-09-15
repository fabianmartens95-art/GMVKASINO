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

function optionalSecret(env, key, { minLength = 24 } = {}) {
  if (!hasValue(env, key)) return ''
  const value = String(env[key]).trim()
  if (value.length < minLength) {
    throw new Error(`Invalid ${key}: expected at least ${minLength} characters`)
  }
  return value
}

function optionalGitRevision(env) {
  const key = hasValue(env, 'RAILWAY_GIT_COMMIT_SHA')
    ? 'RAILWAY_GIT_COMMIT_SHA'
    : hasValue(env, 'APP_REVISION')
      ? 'APP_REVISION'
      : null
  if (!key) return ''

  const value = String(env[key]).trim().toLowerCase()
  if (!/^[0-9a-f]{7,64}$/.test(value)) {
    throw new Error(`Invalid ${key}: expected a hexadecimal git revision`)
  }
  return value
}

function booleanValue(env, key, fallback = false) {
  if (!hasValue(env, key)) return fallback
  const value = String(env[key]).trim().toLowerCase()
  if (value === 'true') return true
  if (value === 'false') return false
  throw new Error(`Invalid ${key}: expected true or false`)
}

function multilineSecret(value) {
  return typeof value === 'string' ? value.replace(/\\n/g, '\n') : ''
}

export function loadServerConfig(env = process.env) {
  const sessionIdleTtlMs = hasValue(env, 'DEMO_SESSION_IDLE_TTL_MS')
    ? positiveNumber(env, 'DEMO_SESSION_IDLE_TTL_MS', 86_400_000, { integer: true })
    : positiveNumber(env, 'DEMO_SESSION_TTL_MS', 86_400_000, { integer: true })

  return Object.freeze({
    host: nonEmptyString(env, 'HOST', '0.0.0.0'),
    port: positiveNumber(env, 'PORT', 8787, { integer: true, max: 65_535 }),
    deploymentRevision: optionalGitRevision(env),
    startingBalance: positiveNumber(env, 'DEMO_STARTING_BALANCE', 1000),
    sessionIdleTtlMs,
    sessionAbsoluteTtlMs: positiveNumber(env, 'DEMO_SESSION_ABSOLUTE_TTL_MS', 604_800_000, { integer: true }),
    authSessionIdleTtlMs: positiveNumber(env, 'AUTH_SESSION_IDLE_TTL_MS', 86_400_000, { integer: true }),
    authSessionAbsoluteTtlMs: positiveNumber(env, 'AUTH_SESSION_ABSOLUTE_TTL_MS', 604_800_000, { integer: true }),
    authRateLimitWindowMs: positiveNumber(env, 'AUTH_RATE_LIMIT_WINDOW_MS', 60_000, { integer: true }),
    authRateLimitMaxAttempts: positiveNumber(env, 'AUTH_RATE_LIMIT_MAX', 10, { integer: true }),
    sessionStorePath: nonEmptyString(env, 'DEMO_SESSION_STORE_PATH', '.data/demo-sessions.json'),
    databaseUrl: hasValue(env, 'DATABASE_URL') ? String(env.DATABASE_URL).trim() : '',
    databaseSsl: booleanValue(env, 'DATABASE_SSL', false),
    databaseSslCa: multilineSecret(env.DATABASE_SSL_CA),
    metricsToken: optionalSecret(env, 'METRICS_TOKEN'),
    rateLimitWindowMs: positiveNumber(env, 'SPIN_RATE_LIMIT_WINDOW_MS', 10_000, { integer: true }),
    rateLimitMaxSpins: positiveNumber(env, 'SPIN_RATE_LIMIT_MAX', 15, { integer: true }),
    maxBodyBytes: positiveNumber(env, 'MAX_JSON_BODY_BYTES', 16_384, { integer: true }),
    auditMaxEvents: positiveNumber(env, 'AUDIT_MAX_EVENTS', 1000, { integer: true }),
  })
}

export const SERVER_CONFIG = loadServerConfig()

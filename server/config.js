function positiveNumber(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function multilineSecret(value) {
  return typeof value === 'string' ? value.replace(/\\n/g, '\n') : ''
}

export function loadServerConfig(env = process.env) {
  const legacySessionTtl = env.DEMO_SESSION_TTL_MS

  return Object.freeze({
    host: env.HOST || '0.0.0.0',
    port: positiveNumber(env.PORT, 8787),
    startingBalance: positiveNumber(env.DEMO_STARTING_BALANCE, 1000),
    sessionIdleTtlMs: positiveNumber(env.DEMO_SESSION_IDLE_TTL_MS ?? legacySessionTtl, 86_400_000),
    sessionAbsoluteTtlMs: positiveNumber(env.DEMO_SESSION_ABSOLUTE_TTL_MS, 604_800_000),
    sessionStorePath: env.DEMO_SESSION_STORE_PATH || '.data/demo-sessions.json',
    databaseUrl: env.DATABASE_URL || '',
    databaseSsl: env.DATABASE_SSL === 'true',
    databaseSslCa: multilineSecret(env.DATABASE_SSL_CA),
    rateLimitWindowMs: positiveNumber(env.SPIN_RATE_LIMIT_WINDOW_MS, 10_000),
    rateLimitMaxSpins: positiveNumber(env.SPIN_RATE_LIMIT_MAX, 15),
    maxBodyBytes: positiveNumber(env.MAX_JSON_BODY_BYTES, 16_384),
    auditMaxEvents: positiveNumber(env.AUDIT_MAX_EVENTS, 1000),
  })
}

export const SERVER_CONFIG = loadServerConfig()

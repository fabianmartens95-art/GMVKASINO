import pg from 'pg'
import { SERVER_CONFIG } from './config.js'
import { SessionStore } from './sessionStore.js'
import { JsonSessionPersistence } from './jsonSessionPersistence.js'
import { PostgresSessionStore } from './postgresSessionStore.js'
import { SlidingWindowRateLimiter } from './rateLimiter.js'
import { AuditLog } from './auditLog.js'
import { OperationalMetrics } from './operationalMetrics.js'
import { CasinoService } from './casinoService.js'
import { createHttpServer } from './httpServer.js'

const { Pool } = pg

export function createPostgresPoolConfig(config = SERVER_CONFIG) {
  return {
    connectionString: config.databaseUrl,
    ...(config.databaseSsl
      ? {
          ssl: {
            rejectUnauthorized: true,
            ...(config.databaseSslCa ? { ca: config.databaseSslCa } : {}),
          },
        }
      : {}),
  }
}

export async function createSessionStore(config = SERVER_CONFIG, { metrics = null } = {}) {
  if (config.databaseUrl) {
    const pool = new Pool(createPostgresPoolConfig(config))
    const store = new PostgresSessionStore({
      pool,
      startingBalance: config.startingBalance,
      idleTtlMs: config.sessionIdleTtlMs,
      absoluteTtlMs: config.sessionAbsoluteTtlMs,
      metrics,
    })
    await store.init()
    return store
  }

  return new SessionStore({
    startingBalance: config.startingBalance,
    idleTtlMs: config.sessionIdleTtlMs,
    absoluteTtlMs: config.sessionAbsoluteTtlMs,
    persistence: new JsonSessionPersistence({ filePath: config.sessionStorePath }),
    metrics,
  })
}

export async function createDefaultService(config = SERVER_CONFIG) {
  const metrics = new OperationalMetrics()
  return new CasinoService({
    sessionStore: await createSessionStore(config, { metrics }),
    rateLimiter: new SlidingWindowRateLimiter({
      limit: config.rateLimitMaxSpins,
      windowMs: config.rateLimitWindowMs,
    }),
    auditLog: new AuditLog({ maxEvents: config.auditMaxEvents }),
    metrics,
  })
}

export async function startServer(config = SERVER_CONFIG) {
  const service = await createDefaultService(config)
  const server = createHttpServer({ service, config, metrics: service.metrics })

  server.listen(config.port, config.host, () => {
    console.log(`GMVKASINO M6 server listening on http://${config.host}:${config.port}`)
  })

  let shuttingDown = false
  const shutdown = () => {
    if (shuttingDown) return
    shuttingDown = true
    server.close(async () => {
      await service.close()
      process.exit(0)
    })
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)

  return { server, service }
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  await startServer()
}

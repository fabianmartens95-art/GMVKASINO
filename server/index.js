import pg from 'pg'
import { SERVER_CONFIG } from './config.js'
import { SessionStore } from './sessionStore.js'
import { JsonSessionPersistence } from './jsonSessionPersistence.js'
import { PostgresSessionStore } from './postgresSessionStore.js'
import { SlidingWindowRateLimiter } from './rateLimiter.js'
import { AuditLog } from './auditLog.js'
import { CasinoService } from './casinoService.js'
import { createHttpServer } from './httpServer.js'

const { Pool } = pg

export async function createSessionStore(config = SERVER_CONFIG) {
  if (config.databaseUrl) {
    const pool = new Pool({
      connectionString: config.databaseUrl,
      ...(config.databaseSsl ? { ssl: { rejectUnauthorized: false } } : {}),
    })
    const store = new PostgresSessionStore({
      pool,
      startingBalance: config.startingBalance,
      ttlMs: config.sessionTtlMs,
    })
    await store.init()
    return store
  }

  return new SessionStore({
    startingBalance: config.startingBalance,
    ttlMs: config.sessionTtlMs,
    persistence: new JsonSessionPersistence({ filePath: config.sessionStorePath }),
  })
}

export async function createDefaultService(config = SERVER_CONFIG) {
  return new CasinoService({
    sessionStore: await createSessionStore(config),
    rateLimiter: new SlidingWindowRateLimiter({
      limit: config.rateLimitMaxSpins,
      windowMs: config.rateLimitWindowMs,
    }),
    auditLog: new AuditLog({ maxEvents: config.auditMaxEvents }),
  })
}

export async function startServer(config = SERVER_CONFIG) {
  const service = await createDefaultService(config)
  const server = createHttpServer({ service, config })

  server.listen(config.port, config.host, () => {
    console.log(`GMVKASINO M5 server listening on http://${config.host}:${config.port}`)
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

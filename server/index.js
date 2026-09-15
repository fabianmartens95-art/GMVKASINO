import { SERVER_CONFIG } from './config.js'
import { SessionStore } from './sessionStore.js'
import { JsonSessionPersistence } from './jsonSessionPersistence.js'
import { PostgresSessionRepository, createPostgresPool } from './postgresSessionRepository.js'
import { runMigrations } from './migrations.js'
import { SlidingWindowRateLimiter } from './rateLimiter.js'
import { AuditLog } from './auditLog.js'
import { CasinoService } from './casinoService.js'
import { createHttpServer } from './httpServer.js'

export async function createSessionRepository(config = SERVER_CONFIG) {
  if (config.databaseUrl) {
    const pool = createPostgresPool({ connectionString: config.databaseUrl })
    try {
      await runMigrations({ pool })
      return new PostgresSessionRepository({
        pool,
        startingBalance: config.startingBalance,
        idleTtlMs: config.sessionIdleTtlMs,
        absoluteTtlMs: config.sessionAbsoluteTtlMs,
      })
    } catch (error) {
      await pool.end().catch(() => {})
      throw error
    }
  }

  return new SessionStore({
    startingBalance: config.startingBalance,
    idleTtlMs: config.sessionIdleTtlMs,
    absoluteTtlMs: config.sessionAbsoluteTtlMs,
    persistence: new JsonSessionPersistence({ filePath: config.sessionStorePath }),
  })
}

export async function createDefaultService(config = SERVER_CONFIG) {
  const sessionRepository = await createSessionRepository(config)
  return new CasinoService({
    sessionRepository,
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
    console.log(`GMVKASINO M5 server listening on http://${config.host}:${config.port} (${config.persistenceBackend})`)
  })

  let shuttingDown = false
  const shutdown = () => {
    if (shuttingDown) return
    shuttingDown = true
    server.close(async () => {
      await service.close().catch(() => {})
      process.exit(0)
    })
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)

  return server
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  startServer().catch((error) => {
    console.error(`GMVKASINO startup failed: ${error.message}`)
    process.exit(1)
  })
}

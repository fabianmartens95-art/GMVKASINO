import { SERVER_CONFIG } from './config.js'
import { SessionStore } from './sessionStore.js'
import { SlidingWindowRateLimiter } from './rateLimiter.js'
import { AuditLog } from './auditLog.js'
import { CasinoService } from './casinoService.js'
import { createHttpServer } from './httpServer.js'

export function createDefaultService(config = SERVER_CONFIG) {
  return new CasinoService({
    sessionStore: new SessionStore({
      startingBalance: config.startingBalance,
      ttlMs: config.sessionTtlMs,
    }),
    rateLimiter: new SlidingWindowRateLimiter({
      limit: config.rateLimitMaxSpins,
      windowMs: config.rateLimitWindowMs,
    }),
    auditLog: new AuditLog({ maxEvents: config.auditMaxEvents }),
  })
}

export function startServer(config = SERVER_CONFIG) {
  const service = createDefaultService(config)
  const server = createHttpServer({ service, config })

  server.listen(config.port, config.host, () => {
    console.log(`GMVKASINO M3 server listening on http://${config.host}:${config.port}`)
  })

  const shutdown = () => server.close(() => process.exit(0))
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)

  return server
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  startServer()
}

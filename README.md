# GMVKASINO

GMVKASINO is an early playable casino-shell prototype. It is demo-only: credits have no monetary value and there are no deposits, withdrawals, crypto payments, real-money wagering, KYC, or production authentication.

## Milestones

### M1 — Playable Casino Shell ✅

Responsive casino lobby, classic slot-machine UI, playable `Golden Vault` 3x3 slot, five paylines, demo-credit wallet, mobile layout and initial CI.

### M2 — Demo Core ✅

Central game catalog, persistent player display name, routing, deterministic RNG test hooks and a client API boundary.

### M3 — Server Core ✅

Node HTTP server, server-owned demo sessions and balances, server-side spin settlement, validation, rate limiting, audit logging, API/static serving and smoke tests.

### M4 — Persistent & Deployable Demo Core ✅

Durable JSON persistence, hardened bearer sessions, API v1, request tracing, Docker deployment, Railway deployment guidance, production smoke checks and reproducible npm CI.

### M5 — Database-backed Demo Core 🚧

- separate liveness and readiness endpoints
- PostgreSQL repository selected through `DATABASE_URL`
- migration-driven schema bootstrap
- transactional/row-locked spin settlement
- JSON persistence retained as a local fallback
- PostgreSQL integration tests in CI
- operational metrics and recovery runbook still pending

## Development

Install the exact dependency graph from the committed lockfile:

```bash
npm ci
npm run dev:server
```

In a second terminal:

```bash
npm run dev
```

Vite proxies `/api` to `http://127.0.0.1:8787`.

Without `DATABASE_URL`, the server uses the local JSON repository at `.data/demo-sessions.json`. To use PostgreSQL, set `DATABASE_URL` and run migrations before starting the server:

```bash
DATABASE_URL=postgresql://user:password@127.0.0.1:5432/gmvkasino npm run db:migrate
DATABASE_URL=postgresql://user:password@127.0.0.1:5432/gmvkasino npm run dev:server
```

The server also applies pending migrations during PostgreSQL startup. `npm run db:migrate` exists for explicit deployment and operational workflows.

## Validation

```bash
npm test
npm run build
npm run smoke
docker build -t gmvkasino:local .
```

PostgreSQL integration coverage runs when `DATABASE_URL` is present. GitHub CI provisions PostgreSQL, applies migrations, runs all tests, builds the frontend, executes the production smoke check and validates the Docker image.

For an already deployed environment:

```bash
SMOKE_BASE_URL=https://<domain> npm run smoke
```

## API

Preferred M5 endpoints:

- `GET /api/v1/health/live` — process liveness only
- `GET /api/v1/health/ready` — persistence-aware readiness
- `GET /api/v1/health` — backward-compatible readiness alias
- `GET /api/v1/games`
- `POST /api/v1/session`
- `GET /api/v1/session`
- `POST /api/v1/session/rotate`
- `DELETE /api/v1/session`
- `POST /api/v1/spin`

Every HTTP response receives an `X-Request-Id`. The frontend uses `/api/v1`; prior unversioned `/api/*` routes remain temporary compatibility aliases.

## Environment

Key variables:

- `HOST`
- `PORT`
- `DATABASE_URL` — enables PostgreSQL when non-empty
- `DEMO_SESSION_STORE_PATH` — JSON fallback path when PostgreSQL is disabled
- `DEMO_STARTING_BALANCE`
- `DEMO_SESSION_IDLE_TTL_MS`
- `DEMO_SESSION_ABSOLUTE_TTL_MS`
- `SPIN_RATE_LIMIT_WINDOW_MS`
- `SPIN_RATE_LIMIT_MAX`
- `MAX_JSON_BODY_BYTES`
- `AUDIT_MAX_EVENTS`

The default idle TTL is 24 hours. Valid activity refreshes the idle timer. The default absolute TTL is seven days and is never extended by activity or token rotation. Explicit malformed numeric runtime values fail startup rather than silently falling back.

Never commit a real `DATABASE_URL` or other credentials. `.env.example` contains only non-secret examples/placeholders.

## Persistence

`SessionStore` + `JsonSessionPersistence` remain the lightweight local fallback. `PostgresSessionRepository` is the shared-database implementation for M5.

PostgreSQL session settlement uses a transaction and `SELECT ... FOR UPDATE` for the target session row. Balance and spin count are therefore updated atomically, and concurrent settlements cannot overwrite each other or overdraw the same demo balance.

Schema changes live under `server/migrations/` and are tracked in `schema_migrations`. Migration execution is protected with a PostgreSQL advisory lock so multiple startup processes do not apply the same migration concurrently.

## Deployment

Railway remains the supported demo hosting target. For PostgreSQL deployments, inject the platform-provided `DATABASE_URL`; no session JSON volume is required. Use `/api/v1/health/ready` as the deployment readiness check and `/api/v1/health/live` for process liveness.

The full deployment and rollback procedure is in [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

The JSON fallback remains single-replica only. PostgreSQL removes that storage constraint, but production identity, financial ledgering and real-money functionality remain explicitly out of scope.

## Architecture

```text
Dockerfile
scripts/
├── migrate.mjs
└── smoke.mjs

docs/
└── DEPLOYMENT.md

server/
├── auditLog.js
├── casinoService.js
├── config.js
├── httpServer.js
├── index.js
├── jsonSessionPersistence.js
├── migrations.js
├── migrations/
│   └── 001_demo_sessions.sql
├── postgresSessionRepository.js
├── rateLimiter.js
└── sessionStore.js

src/
├── api/casinoApi.js
├── components/
├── config/games.js
├── game/slotEngine.js
├── hooks/
├── App.jsx
└── main.jsx

tests/
├── casinoApi.test.js
├── clientSessionApi.test.js
├── config.test.js
├── httpServer.edge.test.js
├── httpServer.test.js
├── postgresSessionRepository.test.js
├── sessionPersistence.test.js
└── slotEngine.test.js
```

## Security boundary

The browser cannot settle spins or credit itself. A demo session ID is a bearer secret and must not be logged, placed in URLs, analytics, screenshots or source control. Audit records use a short non-reversible fingerprint instead of the raw token.

This remains a non-monetary demo architecture. Before any real-money functionality, a separate legal/compliance decision and production-grade identity, financial ledger/database design, RNG/game certification where applicable, geofencing, AML/KYC, responsible-gambling controls, monitoring, secrets management and infrastructure hardening would be required.

## Next work

After PostgreSQL is merged, M5 continues with bounded operational metrics/observability and the database backup, migration and recovery runbook. Real-money functionality remains out of scope.

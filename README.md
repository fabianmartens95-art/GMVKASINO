# GMVKASINO

GMVKASINO is an early playable casino-shell prototype. It is demo-only: credits have no monetary value and there are no deposits, withdrawals, crypto payments, real-money wagering, KYC, or production authentication.

## Milestones

### M1 — Playable Casino Shell ✅

Responsive casino lobby, classic slot-machine UI, playable `Golden Vault` 3x3 slot, five paylines, demo-credit wallet, mobile layout and initial CI.

### M2 — Demo Core ✅

Central game catalog, persistent player display name, routing, deterministic RNG test hooks and a client API boundary.

### M3 — Server Core ✅

Server-owned demo sessions/balances, server-side spin settlement, bet/funds validation, rate limiting, audit logging and HTTP smoke coverage.

### M4 — Persistent & Session Security Core ✅

- Durable JSON session persistence and 256-bit bearer tokens
- `/api/v1`, request IDs and structured HTTP logs
- Explicit session rotation and invalidation
- Separate idle and absolute session expiry limits
- Browser bearer tokens in `sessionStorage` with one-time legacy `localStorage` migration
- Automatic safe recovery from expired/invalid sessions
- Audit correlation via non-reversible session fingerprints instead of raw bearer tokens

### M5 — PostgreSQL & Operations

- Optional PostgreSQL-backed demo session store via `DATABASE_URL`
- JSON persistence retained as a local fallback when no database URL is configured
- Atomic conditional PostgreSQL settlement to prevent concurrent overspend
- PostgreSQL parity for rotation, invalidation, idle expiry and absolute expiry
- Real PostgreSQL integration tests in GitHub CI
- Verified PostgreSQL TLS when `DATABASE_SSL=true`, with optional private CA support
- Versioned PostgreSQL migrations tracked in `schema_migrations`
- Advisory-lock protection against concurrent migration execution
- Explicit `npm run db:migrate` command plus migration-on-start safety
- Explicit liveness (`/api/v1/health/live`) and persistence readiness (`/api/v1/health/ready`) endpoints
- Docker production-demo image and local `compose.yaml` PostgreSQL stack
- Local/remote production smoke check
- Graceful database pool shutdown

## Development

Install the exact committed dependency graph:

```bash
npm ci
npm run dev:server
```

Use `npm install` only when intentionally changing dependencies and commit the resulting `package-lock.json` together with `package.json`.

In a second terminal:

```bash
npm run dev
```

With PostgreSQL and the containerized app:

```bash
docker compose up --build
```

The demo is then served on port `8787`.

## Database migrations

Apply pending PostgreSQL migrations explicitly with:

```bash
DATABASE_URL=postgresql://... npm run db:migrate
```

The PostgreSQL startup path uses the same migration runner before serving traffic. Migration authoring and rollback rules are documented in [`docs/DATABASE_MIGRATIONS.md`](docs/DATABASE_MIGRATIONS.md).

## Validation

```bash
npm audit --audit-level=high
npm test
npm run build
npm run smoke
docker build -t gmvkasino:local .
```

GitHub CI runs on Node 22, restores the npm cache from the committed lockfile, installs with `npm ci`, starts PostgreSQL, applies migrations, runs database integration tests, builds the production frontend, executes the production smoke check and verifies that the Docker image builds successfully.

## API

- `GET /api/v1/health/live` — process liveness
- `GET /api/v1/health/ready` — storage readiness
- `GET /api/v1/health` — readiness compatibility alias
- `GET /api/v1/ready` — readiness compatibility alias
- `GET /api/v1/games`
- `POST /api/v1/session`
- `GET /api/v1/session`
- `POST /api/v1/session/rotate`
- `DELETE /api/v1/session`
- `POST /api/v1/spin`

Every HTTP response receives an `X-Request-Id`. `POST /api/v1/session/rotate` preserves demo state while replacing and invalidating the bearer token. `DELETE /api/v1/session` invalidates and removes the current durable demo session. Temporary legacy `/api/*` aliases remain available during migration.

## Environment

See `.env.example`. Key settings include:

- `HOST`
- `PORT`
- `DEMO_STARTING_BALANCE`
- `DEMO_SESSION_IDLE_TTL_MS`
- `DEMO_SESSION_ABSOLUTE_TTL_MS`
- `DEMO_SESSION_STORE_PATH`
- `DATABASE_URL`
- `DATABASE_SSL`
- `DATABASE_SSL_CA`
- `SPIN_RATE_LIMIT_WINDOW_MS`
- `SPIN_RATE_LIMIT_MAX`
- `MAX_JSON_BODY_BYTES`
- `AUDIT_MAX_EVENTS`

The default idle TTL is 24 hours and valid activity refreshes it. The default absolute TTL is seven days and is never extended by activity or token rotation. The legacy `DEMO_SESSION_TTL_MS` remains accepted as an idle-TTL fallback.

When `DATABASE_URL` is set, the server uses PostgreSQL. Otherwise it uses the JSON repository at `.data/demo-sessions.json`. If `DATABASE_SSL=true`, certificate verification remains enabled; `DATABASE_SSL_CA` can supply a private CA certificate, including escaped `\n` newlines in an environment variable.

## Architecture

```text
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
├── postgresSessionStore.js
├── rateLimiter.js
└── sessionStore.js

scripts/
├── migrate.mjs
└── smoke.mjs

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
├── httpServer.edge.test.js
├── httpServer.test.js
├── migrations.test.js
├── postgresSessionStore.test.js
├── serverConfig.test.js
├── sessionPersistence.test.js
└── slotEngine.test.js
```

## Security boundary

The browser cannot settle spins or credit itself. The server validates the demo session, game, allowed bet, current balance and rate limit. With PostgreSQL, balance settlement is conditional and atomic so concurrent requests cannot both spend the same remaining demo credit.

A demo session identifier is a bearer secret. It must not be placed in URLs, general request logs, analytics events, screenshots or source control. Browser storage uses `sessionStorage`; server audit events use a short SHA-256-derived fingerprint instead of the raw token.

This is still not a real-money architecture. Before any monetary functionality, the project would require a separate legal/compliance decision and production-grade identity, financial ledger design, certified game/RNG requirements where applicable, geofencing, AML/KYC, responsible-gambling controls, monitoring, secrets management and infrastructure hardening.

## Next milestone

M6 should focus on authenticated accounts, bounded metrics/alerts, backup/restore procedures and a staging deployment. Real-money functionality remains out of scope.

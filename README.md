# GMVKASINO

GMVKASINO is an early playable casino-shell prototype. It is demo-only: credits have no monetary value and there are no deposits, withdrawals, crypto payments, real-money wagering, KYC, or production authentication.

## Milestones

### M1 — Playable Casino Shell ✅

Responsive casino lobby, classic slot-machine UI, playable `Golden Vault` 3x3 slot, five paylines, demo-credit wallet, mobile layout and initial CI.

### M2 — Demo Core ✅

Central game catalog, persistent player display name, routing, deterministic RNG test hooks and a client API boundary.

### M3 — Server Core ✅

Server-owned demo sessions/balances, server-side spin settlement, bet/funds validation, rate limiting, audit logging and HTTP smoke coverage.

### M4 — Persistent Core ✅

Durable JSON session persistence, 256-bit demo session tokens, `/api/v1`, request IDs, structured HTTP logs and persistence/restart tests.

### M5 — PostgreSQL & Operations

- Optional PostgreSQL-backed demo session store via `DATABASE_URL`
- JSON persistence retained as a local fallback when no database URL is configured
- Atomic conditional PostgreSQL settlement to prevent concurrent overspend
- Async storage contract while keeping the casino service API stable
- Real PostgreSQL integration tests in GitHub CI
- Verified PostgreSQL TLS when `DATABASE_SSL=true`, with optional private CA support
- Separate liveness (`/api/v1/health`) and readiness (`/api/v1/ready`) endpoints
- Docker production-demo image
- Local `compose.yaml` stack with PostgreSQL health checks
- Graceful database pool shutdown

## Development

Without PostgreSQL, the local JSON persistence fallback still works:

```bash
npm install
npm run dev:server
```

In a second terminal:

```bash
npm run dev
```

With PostgreSQL and the containerized app:

```bash
docker compose up --build
```

The demo is then served on port `8787`.

## Validation

```bash
npm test
npm run build
```

GitHub CI starts PostgreSQL, runs the database integration tests, builds the production frontend and verifies that the Docker image builds successfully.

## API

- `GET /api/v1/health` — process liveness
- `GET /api/v1/ready` — storage readiness
- `GET /api/v1/games`
- `POST /api/v1/session`
- `GET /api/v1/session`
- `POST /api/v1/spin`

Every HTTP response receives an `X-Request-Id`. Temporary legacy `/api/*` aliases remain available during migration.

## Environment

See `.env.example`. Key settings include:

- `HOST`
- `PORT`
- `DEMO_STARTING_BALANCE`
- `DEMO_SESSION_TTL_MS`
- `DEMO_SESSION_STORE_PATH`
- `DATABASE_URL`
- `DATABASE_SSL`
- `DATABASE_SSL_CA`
- `SPIN_RATE_LIMIT_WINDOW_MS`
- `SPIN_RATE_LIMIT_MAX`
- `MAX_JSON_BODY_BYTES`
- `AUDIT_MAX_EVENTS`

When `DATABASE_URL` is set, the server initializes and uses PostgreSQL. Otherwise it uses the JSON repository at `.data/demo-sessions.json`. If `DATABASE_SSL=true`, certificate verification remains enabled; `DATABASE_SSL_CA` can supply a private CA certificate, including escaped `\n` newlines when stored in an environment variable.

## Architecture

```text
server/
├── auditLog.js
├── casinoService.js
├── config.js
├── httpServer.js
├── index.js
├── jsonSessionPersistence.js
├── postgresSessionStore.js
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
├── httpServer.edge.test.js
├── httpServer.test.js
├── postgresSessionStore.test.js
├── serverConfig.test.js
├── sessionPersistence.test.js
└── slotEngine.test.js
```

## Security boundary

The browser cannot settle spins or credit itself. The server validates the demo session, game, allowed bet, current balance and rate limit. With PostgreSQL, the balance update is conditional and atomic so concurrent requests cannot both spend the same remaining demo credit.

This is still not a real-money architecture. Before any monetary functionality, the project would require a separate legal/compliance decision and production-grade identity, financial ledger design, certified game/RNG requirements where applicable, geofencing, AML/KYC, responsible-gambling controls, monitoring, secrets management and infrastructure hardening.

## Next milestone

M6 should focus on authenticated accounts, session rotation/revocation, database migrations instead of runtime schema creation, metrics/alerts, backup/restore procedures and a staging deployment. Real-money functionality remains out of scope.

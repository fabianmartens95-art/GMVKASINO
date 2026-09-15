# GMVKASINO

GMVKASINO is an early playable casino-shell prototype. It is demo-only: credits have no monetary value and there are no deposits, withdrawals, crypto payments, real-money wagering, KYC, or production authentication.

## Milestones

### M1 — Playable Casino Shell ✅

Responsive casino lobby, classic slot-machine UI, playable `Golden Vault` 3x3 slot, five paylines, demo-credit wallet, mobile layout and initial CI.

### M2 — Demo Core ✅

Central game catalog, persistent player display name, routing, deterministic RNG test hooks and a client API boundary.

### M3 — Server Core ✅

- Node HTTP server
- Server-owned demo sessions and balances
- Server-side spin settlement
- Allowed-bet and insufficient-credit validation
- Per-session rate limiting
- Structured audit logging
- API endpoints and production static serving
- Service and HTTP smoke tests

### M4 — Persistent & Deployable Demo Core

- Durable session repository adapter with atomic JSON-file persistence
- Demo sessions and balances survive server restarts
- 256-bit random demo session tokens
- Explicit session rotation and invalidation endpoints
- Separate idle and absolute session expiry limits
- Browser bearer tokens stored in `sessionStorage`, with one-time migration away from legacy `localStorage`
- Automatic client recovery from an expired/invalid session on safe retry paths
- Versioned `/api/v1` contract
- Temporary legacy `/api/*` compatibility aliases
- `X-Request-Id` tracing on HTTP responses
- Structured HTTP request logs without session-token logging
- Audit events use non-reversible session fingerprints rather than raw bearer tokens
- Fail-fast validation for explicit runtime configuration
- Production-style multi-stage Docker image on Node.js 20
- Local/remote deployment smoke check
- Supported Railway demo deployment with one replica and persistent `/data` volume
- CI validates tests, frontend build, production smoke and Docker image build

The JSON repository is intentionally transitional. It establishes a storage abstraction without introducing a native database dependency yet. A later milestone can replace it with SQLite/Postgres while keeping the casino service contract stable.

## Development

Install the exact dependency graph from the committed lockfile:

```bash
npm ci
npm run dev:server
```

Use `npm install` only when intentionally changing dependencies and commit the resulting `package-lock.json` update together with `package.json`.

In a second terminal:

```bash
npm run dev
```

Vite proxies `/api` to `http://127.0.0.1:8787`.

## Validation

```bash
npm test
npm run build
npm run smoke
docker build -t gmvkasino:local .
```

`npm run smoke` starts the production-style Node server locally when `SMOKE_BASE_URL` is not set and verifies both `/api/v1/health` and the built frontend. For an already deployed environment, run:

```bash
SMOKE_BASE_URL=https://<domain> npm run smoke
```

GitHub CI runs on Node 20, installs with `npm ci`, executes the automated tests, builds the frontend, runs the production smoke check and verifies that the Docker image builds.

## Production-style local demo

Without Docker:

```bash
npm run build
npm start
```

With Docker:

```bash
docker build -t gmvkasino:local .
docker run --rm -p 8787:8787 -e PORT=8787 gmvkasino:local
```

The Node server serves both the built frontend and API from the same origin.

## API

Preferred M4 endpoints:

- `GET /api/v1/health`
- `GET /api/v1/games`
- `POST /api/v1/session`
- `GET /api/v1/session`
- `POST /api/v1/session/rotate`
- `DELETE /api/v1/session`
- `POST /api/v1/spin`

Every HTTP response receives an `X-Request-Id`. The frontend uses `/api/v1`; the prior unversioned routes remain temporary aliases.

`POST /api/v1/session/rotate` preserves the current demo-session state while replacing the bearer token and invalidating the previous token. `DELETE /api/v1/session` invalidates the current token and removes the durable demo session.

## Environment

The server reads environment variables directly. `.env.example` documents the available values, including:

- `HOST`
- `PORT`
- `DEMO_STARTING_BALANCE`
- `DEMO_SESSION_IDLE_TTL_MS`
- `DEMO_SESSION_ABSOLUTE_TTL_MS`
- `DEMO_SESSION_STORE_PATH`
- `SPIN_RATE_LIMIT_WINDOW_MS`
- `SPIN_RATE_LIMIT_MAX`
- `MAX_JSON_BODY_BYTES`
- `AUDIT_MAX_EVENTS`

The default idle TTL is 24 hours. Valid activity refreshes the idle timer. The default absolute TTL is seven days and is never extended by activity or token rotation. The legacy `DEMO_SESSION_TTL_MS` variable is still accepted as an idle-TTL fallback for compatibility.

Explicit malformed numeric runtime values fail startup instead of silently falling back. Local durable demo state defaults to `.data/demo-sessions.json` and is gitignored.

## Deployment

Railway is the supported hosting target for the current demo deployment. The JSON-backed build must run as **one replica** with a persistent Railway Volume mounted at `/data` and:

```text
DEMO_SESSION_STORE_PATH=/data/demo-sessions.json
```

Use `/api/v1/health` as the deployment healthcheck. After deployment, run the remote smoke check before considering the release verified.

The full deployment, volume, rollback and secret-handling procedure is documented in [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

This deployment model is not a production gambling architecture and is not intended for horizontal scaling. Replace the JSON persistence layer with a real shared database before multiple replicas or production identity are introduced.

## Architecture

```text
Dockerfile
scripts/
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
├── httpServer.test.js
├── sessionPersistence.test.js
└── slotEngine.test.js
```

## Security boundary

The browser cannot settle spins or credit itself. It submits a game ID and allowed bet; the server validates the demo session, balance, game configuration and rate limit, resolves the spin, persists the resulting demo balance, records audit data and returns the authoritative result.

A demo session identifier is a **bearer secret**: possession of the token is sufficient to act as that demo session. It must not be placed in URLs, general request logs, analytics events, screenshots or source control. The browser stores it in `sessionStorage` rather than durable `localStorage`; a legacy local-storage token is migrated once and removed. Server audit records use a short SHA-256-derived session fingerprint for correlation instead of logging the token itself.

This is still not a real-money architecture. Before any monetary functionality, the project would require a separate legal/compliance decision and production-grade identity, database/ledger design, certified game/RNG requirements where applicable, geofencing, AML/KYC, responsible-gambling controls, monitoring, secrets management and infrastructure hardening.

## Next milestone

M5 should replace transitional JSON persistence with a real database adapter, add production authentication/identity, separate liveness/readiness semantics, metrics and alerting, strengthen secret management, and define database migration/backup/recovery procedures. Real-money functionality remains out of scope.

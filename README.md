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

### M4 — Persistent Core

- Durable session repository adapter with atomic JSON-file persistence
- Demo sessions and balances survive server restarts
- 256-bit random demo session tokens
- Versioned `/api/v1` contract
- Temporary legacy `/api/*` compatibility aliases
- `X-Request-Id` tracing on HTTP responses
- Structured HTTP request logs without session-token logging
- Persistence restart/expiry tests
- API v1 request-tracing tests

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
```

GitHub CI runs on Node 20, restores the npm cache from the lockfile, installs with `npm ci`, then runs tests and the production build for pushes to `main` and pull requests.

## Production-style local demo

```bash
npm run build
npm start
```

The Node server serves both the built frontend and API from the same origin.

## API

Preferred M4 endpoints:

- `GET /api/v1/health`
- `GET /api/v1/games`
- `POST /api/v1/session`
- `GET /api/v1/session`
- `POST /api/v1/spin`

Every HTTP response receives an `X-Request-Id`. The frontend uses `/api/v1`; the prior unversioned routes remain temporary aliases.

## Environment

The server reads environment variables directly. `.env.example` documents the available values, including:

- `HOST`
- `PORT`
- `DEMO_STARTING_BALANCE`
- `DEMO_SESSION_TTL_MS`
- `DEMO_SESSION_STORE_PATH`
- `SPIN_RATE_LIMIT_WINDOW_MS`
- `SPIN_RATE_LIMIT_MAX`
- `MAX_JSON_BODY_BYTES`
- `AUDIT_MAX_EVENTS`

Local durable demo state defaults to `.data/demo-sessions.json` and is gitignored.

## Architecture

```text
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
├── httpServer.test.js
├── sessionPersistence.test.js
└── slotEngine.test.js
```

## Security boundary

The browser cannot settle spins or credit itself. It submits a game ID and allowed bet; the server validates the demo session, balance, game configuration and rate limit, resolves the spin, persists the resulting demo balance, records audit data and returns the authoritative result.

This is still not a real-money architecture. Before any monetary functionality, the project would require a separate legal/compliance decision and production-grade identity, database/ledger design, certified game/RNG requirements where applicable, geofencing, AML/KYC, responsible-gambling controls, monitoring, secrets management and infrastructure hardening.

## Next milestone

M5 should introduce a real database adapter behind the existing repository boundary, stronger authentication/session lifecycle controls, deployment/container configuration, health/readiness separation, metrics, and operational recovery procedures. Real-money functionality remains out of scope.

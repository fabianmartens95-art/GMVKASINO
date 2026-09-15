# GMVKASINO

GMVKASINO is currently an early playable casino-shell prototype. It is a demo-only project: credits have no monetary value and there are no deposits, withdrawals, crypto payments, real-money wagering, KYC, or production authentication.

## Milestones

### M1 — Playable Casino Shell ✅

- Responsive casino lobby
- Classic slot-machine visual direction
- Playable `Golden Vault` 3x3 slot demo
- Five fixed paylines
- Weighted demo RNG
- Demo-credit wallet with adjustable bet sizes
- Local login/profile mock
- Mobile layout
- Automated tests and GitHub CI

### M2 — Demo Core ✅

- Central game catalog/configuration
- Persistent player name and client session token
- Hash-based lobby/game routing
- Injectable RNG for deterministic engine testing
- Client API boundary
- Expanded test coverage

### M3 — Server Core

- Node HTTP server with no additional backend framework
- Server-owned demo sessions and balances
- Server-side spin settlement
- Allowed-bet validation and insufficient-credit protection
- Per-session sliding-window spin rate limiting
- Structured in-memory audit events with JSON log output
- `/api/health`, `/api/games`, `/api/session`, and `/api/spin`
- Production static-file serving from `dist/`
- Vite development proxy for `/api`
- Environment-based server configuration
- Service-level and HTTP smoke tests

## Development

Install dependencies:

```bash
npm install
```

Start the API server in one terminal:

```bash
npm run dev:server
```

Start Vite in a second terminal:

```bash
npm run dev
```

Vite proxies `/api` requests to `http://127.0.0.1:8787`.

## Validation

```bash
npm test
npm run build
```

GitHub CI runs both commands on pushes to `main` and pull requests.

## Production-style local run

```bash
npm run build
npm start
```

The Node server serves the built frontend and API from the same origin.

## Environment

Copy `.env.example` values into your deployment environment as needed. The current server reads environment variables directly; it does not load `.env` files by itself.

Key settings include:

- `HOST`
- `PORT`
- `DEMO_STARTING_BALANCE`
- `DEMO_SESSION_TTL_MS`
- `SPIN_RATE_LIMIT_WINDOW_MS`
- `SPIN_RATE_LIMIT_MAX`
- `MAX_JSON_BODY_BYTES`
- `AUDIT_MAX_EVENTS`

## Architecture

```text
server/
├── auditLog.js
├── casinoService.js
├── config.js
├── httpServer.js
├── index.js
├── rateLimiter.js
└── sessionStore.js

src/
├── api/
│   └── casinoApi.js
├── components/
├── config/
│   └── games.js
├── game/
│   └── slotEngine.js
├── hooks/
├── App.jsx
└── main.jsx

tests/
├── casinoApi.test.js
├── httpServer.test.js
└── slotEngine.test.js
```

## Security boundary

The browser no longer settles spins or credits itself. It submits a game ID and allowed bet to the demo server; the server validates the session, available balance, rate limit and game configuration, resolves the spin, settles the balance, records an audit event, and returns the authoritative result.

This is still not a real-money architecture. Before any monetary functionality, the project would require a separate legal/compliance decision, production-grade identity/authentication, persistent storage, certified game/RNG requirements where applicable, financial ledger design, geofencing, AML/KYC controls, responsible-gambling controls, monitoring, secrets management and infrastructure hardening.

## Next milestone

M4 should replace in-memory state with a persistent database-backed repository layer, add explicit API versioning and request IDs, introduce authentication/session hardening, improve observability, and prepare a repeatable deployment environment. Real-money functionality remains out of scope.

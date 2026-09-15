# GMVKASINO

GMVKASINO is an early playable casino-shell prototype. It is demo-only: credits have no monetary value and there are no deposits, withdrawals, crypto payments, real-money wagering, KYC, or production identity verification.

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
- Automatic safe recovery from expired/invalid guest sessions
- Audit correlation via non-reversible session fingerprints instead of raw bearer tokens

### M5 — PostgreSQL & Operations ✅

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
- Bounded operational metrics and protected internal metrics endpoint
- Database recovery, observability and staging-promotion runbooks

### M6 — Account, Ledger & Auth Foundation

- Persistent account identity separated from game-session bearer tokens
- Generic asset registry with explicit decimal precision and asset type
- `DEMO` is the only enabled asset; no cryptocurrency is activated
- Exact atomic-unit amount conversion without JavaScript floating-point settlement
- Per-account available wallets backed by PostgreSQL
- Double-entry ledger transactions and signed ledger entries
- Deferred database constraint rejects unbalanced or mixed-asset ledger transactions
- System issuance and house ledger accounts
- Initial demo credit issued as a balanced ledger transaction
- Game bet/win settlement recorded as one atomic database transaction
- User wallet balances cannot become negative
- Session rotation, expiry and invalidation preserve account and ledger history
- Existing PostgreSQL demo sessions are migrated into account + wallet records
- PostgreSQL-only demo account registration/login using `scrypt` with per-password salt
- 256-bit authentication tokens stored only as SHA-256 hashes in PostgreSQL
- Separate idle and absolute authentication-session expiry
- Authenticated game sessions bound to the same persistent account/wallet
- Active guest sessions can be upgraded in place to registered accounts without replacing their account, wallet, session, balance or ledger history
- Guest upgrades never issue a second `INITIAL_CREDIT` transaction
- Auth request rate limiting and explicit logout/revocation
- Browser auth and game tokens stored separately in `sessionStorage`
- `GET /api/v1/wallet` exposes the current DEMO wallet through the session/account authorization boundary
- Read-only ledger reconciliation compares cached balances with posting history, transaction balance/asset integrity and per-asset conservation
- `npm run ledger:reconcile` exits non-zero on any accounting mismatch and is enforced as a CI gate
- PostgreSQL `demo_sessions` stores no balance column; `ledger_accounts` is the sole PostgreSQL balance source
- CI performs an actual PostgreSQL logical dump → isolated restore → migration/count/reconciliation verification cycle

Historical migration `002_accounts_ledger.sql` uses the old session balance only to bootstrap pre-ledger installations. Migration `004_remove_session_balance.sql` removes that compatibility column after the ledger has been populated. Runtime PostgreSQL session code no longer reads or writes a duplicate balance.

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

## Database migrations and recovery verification

Apply pending PostgreSQL migrations explicitly with:

```bash
DATABASE_URL=postgresql://... npm run db:migrate
```

The PostgreSQL startup path uses the same migration runner before serving traffic. Migration authoring and rollback rules are documented in [`docs/DATABASE_MIGRATIONS.md`](docs/DATABASE_MIGRATIONS.md). Recovery and observability procedures are documented in [`docs/DATABASE_RECOVERY.md`](docs/DATABASE_RECOVERY.md) and [`docs/OBSERVABILITY.md`](docs/OBSERVABILITY.md). Ledger reconciliation is documented in [`docs/LEDGER_RECONCILIATION.md`](docs/LEDGER_RECONCILIATION.md). Staging release/promotion rules are documented in [`docs/STAGING.md`](docs/STAGING.md).

`npm run db:restore:verify` verifies an already-restored scratch database against its source using aggregate row counts, migration state and ledger reconciliation. It requires both `DATABASE_URL` and `RESTORE_DATABASE_URL`; it does not create or retain a backup itself. GitHub CI owns the synthetic dump/restore lifecycle around that verifier.

## Validation

```bash
npm audit --audit-level=high
npm test
DATABASE_URL=postgresql://... LEDGER_RECONCILE_ASSET=DEMO npm run ledger:reconcile
npm run build
npm run smoke
docker build -t gmvkasino:local .
```

GitHub CI runs on Node 22, restores the npm cache from the committed lockfile, installs with `npm ci`, starts PostgreSQL, applies migrations, runs database integration tests, reconciles the source DEMO ledger, creates a PostgreSQL 16 custom-format logical dump, restores it into an isolated scratch database, verifies migration completeness/aggregate row-count parity/restored-ledger integrity, destroys the scratch recovery artifacts, builds the production frontend, executes the production smoke check and verifies that the Docker image builds successfully.

The CI restore drill uses synthetic CI data. It does not prove that hosted Railway scheduled backups or PITR are enabled; those remain deployment/operations gates in the recovery runbook.

## API

- `GET /api/v1/health/live` — process liveness
- `GET /api/v1/health/ready` — storage readiness
- `GET /api/v1/health` — readiness compatibility alias
- `GET /api/v1/ready` — readiness compatibility alias
- `POST /api/v1/auth/register` — create a PostgreSQL-backed demo account or upgrade the supplied active guest session in place
- `POST /api/v1/auth/login` — authenticate a demo account
- `GET /api/v1/auth/me` — return the authenticated account and DEMO wallet
- `POST /api/v1/auth/logout` — revoke the current auth token and optionally current game session
- `GET /api/v1/games`
- `GET /api/v1/wallet`
- `POST /api/v1/session`
- `GET /api/v1/session`
- `POST /api/v1/session/rotate`
- `DELETE /api/v1/session`
- `POST /api/v1/spin`
- `GET /api/v1/internal/metrics` — protected operational metrics when configured

Every HTTP response receives an `X-Request-Id`. Registered-account game sessions are marked `authRequired` and require both the game-session bearer and a valid account auth bearer for account-bound operations. Guest demo sessions continue to work without account auth. `DELETE /api/v1/session` invalidates the current game session but deliberately preserves account and ledger history. Temporary legacy `/api/*` aliases remain available during migration.

## Asset and ledger model

M6 stores value as integer atomic units in `NUMERIC(78,0)` rather than floating-point currency amounts. Each asset defines its own decimal precision. `DEMO` currently uses two decimals, so `1000.00 DEMO` is stored as `100000` atomic units.

The model is deliberately capable of representing future asset definitions with different precision, but only the non-monetary `DEMO` asset is enabled. No blockchain address, deposit watcher, withdrawal pipeline, custody integration, or crypto payment adapter exists in M6.

Every game ledger transaction must balance to zero. A demo wager of `5.00` and win of `12.00`, for example, produces postings between the user's DEMO wallet and the DEMO house ledger account; cached wallet balances are updated inside the same PostgreSQL transaction.

PostgreSQL session records contain session/account metadata only. Session responses fetch the current balance from the ledger-backed wallet, so multiple sessions for the same account cannot maintain independent balance copies.

`npm run ledger:reconcile` is a read-only integrity check. It verifies that every cached ledger-account balance equals the sum of its entries, every transaction remains balanced and single-asset, and the aggregate balance across each asset is zero. It never auto-repairs a mismatch. See [`docs/LEDGER_RECONCILIATION.md`](docs/LEDGER_RECONCILIATION.md).

## Account authentication

Account authentication is available only when `DATABASE_URL` is configured. If registration starts without an active guest session, it creates a durable account and DEMO wallet. If an active guest session is supplied, registration instead attaches credentials to that existing account, preserves its current wallet and ledger history, and converts the same game session to `authRequired = true` in the credential transaction. The upgrade does not create another wallet or another `INITIAL_CREDIT` transaction.

Passwords are derived with Node's `scrypt` using a random per-account salt; raw passwords are never stored. Authentication sessions use random 256-bit bearer tokens, while PostgreSQL stores only their SHA-256 hashes.

Account auth tokens and game-session tokens are separate secrets. Browser code stores both in `sessionStorage`, not persistent `localStorage`. An expired account-auth token does not silently downgrade a registered player into a guest session.

This remains demo authentication, not a production identity/KYC system. There is no email verification, password reset, MFA, recovery flow, identity proofing or compliance onboarding yet.

## Environment

See `.env.example`. Key settings include:

- `HOST`
- `PORT`
- `DEMO_STARTING_BALANCE`
- `DEMO_SESSION_IDLE_TTL_MS`
- `DEMO_SESSION_ABSOLUTE_TTL_MS`
- `AUTH_SESSION_IDLE_TTL_MS`
- `AUTH_SESSION_ABSOLUTE_TTL_MS`
- `AUTH_RATE_LIMIT_WINDOW_MS`
- `AUTH_RATE_LIMIT_MAX`
- `DEMO_SESSION_STORE_PATH`
- `DATABASE_URL`
- `DATABASE_SSL`
- `DATABASE_SSL_CA`
- `SPIN_RATE_LIMIT_WINDOW_MS`
- `SPIN_RATE_LIMIT_MAX`
- `MAX_JSON_BODY_BYTES`
- `AUDIT_MAX_EVENTS`
- `METRICS_TOKEN`

The default demo-session and auth-session idle TTL is 24 hours. The default absolute TTL is seven days and is never extended by activity. The legacy `DEMO_SESSION_TTL_MS` remains accepted as a demo-session idle-TTL fallback.

When `DATABASE_URL` is set, the server uses PostgreSQL and M6 ledger/auth-backed sessions. Otherwise it uses the JSON repository at `.data/demo-sessions.json` as a local guest-demo compatibility fallback; account registration/login returns `AUTH_UNAVAILABLE` in that mode. If `DATABASE_SSL=true`, certificate verification remains enabled; `DATABASE_SSL_CA` can supply a private CA certificate, including escaped `\n` newlines in an environment variable.

## Architecture

```text
server/
├── accountAuthService.js
├── amounts.js
├── auditLog.js
├── casinoService.js
├── config.js
├── httpServer.js
├── index.js
├── jsonSessionPersistence.js
├── ledgerReconciliation.js
├── migrations.js
├── migrations/
│   ├── 001_demo_sessions.sql
│   ├── 002_accounts_ledger.sql
│   ├── 003_account_auth.sql
│   └── 004_remove_session_balance.sql
├── operationalMetrics.js
├── postgresLedger.js
├── postgresSessionStore.js
├── rateLimiter.js
└── sessionStore.js

scripts/
├── migrate.mjs
├── reconcile-ledger.mjs
├── smoke.mjs
├── validateStagingTarget.mjs
└── verify-restore.mjs

src/
├── api/casinoApi.js
├── components/
├── config/games.js
├── game/slotEngine.js
├── hooks/
├── App.jsx
└── main.jsx

tests/
├── accountAuthService.test.js
├── amounts.test.js
├── authHttp.test.js
├── casinoApi.test.js
├── clientAuthApi.test.js
├── clientSessionApi.test.js
├── guestAccountUpgrade.test.js
├── httpServer.edge.test.js
├── httpServer.test.js
├── ledgerReconciliation.test.js
├── metricsEndpoint.test.js
├── migrations.test.js
├── operationalMetrics.test.js
├── postgresSessionStore.test.js
├── serverConfig.test.js
├── sessionPersistence.test.js
├── stagingTarget.test.js
└── slotEngine.test.js
```

## Security boundary

The browser cannot settle spins or credit itself. The server validates the game session, optional account-auth context, game, allowed bet, current wallet balance and rate limit. With PostgreSQL, each spin locks the session, conditionally updates the user wallet and records balanced ledger entries inside a single database transaction.

Demo-session and auth-session identifiers are bearer secrets. They must not be placed in URLs, general request logs, analytics events, screenshots or source control. Browser storage uses `sessionStorage`; raw account auth tokens are not stored in PostgreSQL; server audit events use non-reversible session fingerprints instead of raw demo-session tokens.

This is still not a real-money architecture. Before any monetary or cryptocurrency functionality, the project would require a separate legal/compliance decision and production-grade identity, custody/payment architecture, deposit and withdrawal state machines, financial reconciliation, certified game/RNG requirements where applicable, geofencing, AML/KYC, sanctions controls, responsible-gambling controls, monitoring, secrets management and infrastructure hardening.

## Next milestone

Finish M6 with account recovery/MFA planning and hosted staging verification of the authenticated, guest-upgrade, reconciliation and recovery flows. Real-money and cryptocurrency movement remain out of scope.

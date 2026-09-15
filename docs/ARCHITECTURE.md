# Architecture Snapshot

Current milestone: M5 PostgreSQL & Operations Core.

The frontend is a React/Vite demo shell. The browser stores only a demo session token and player display name. Game balance and spin settlement remain server-authoritative.

`CasinoService` now treats its session store as an async boundary. The default local mode still uses the durable JSON-backed `SessionStore`; when `DATABASE_URL` is configured, startup selects `PostgresSessionStore` instead.

The PostgreSQL store owns session creation/resume, TTL checks and atomic balance settlement. A spin settlement updates balance, spin count and last-seen timestamp in one conditional SQL statement requiring `balance >= bet`. This reduces race risk when multiple requests target the same demo session.

The HTTP contract remains `/api/v1`. `/health` reports process liveness and `/ready` checks the active storage backend. Request IDs and structured HTTP logs remain enabled without session-token logging.

GitHub CI starts an ephemeral PostgreSQL service and executes integration tests against it. Docker/Compose provide a repeatable app + database environment for local/staging-style validation.

Production identity, financial ledgers, money movement, compliance controls, certified gaming infrastructure, and real-money operation are intentionally not implemented.

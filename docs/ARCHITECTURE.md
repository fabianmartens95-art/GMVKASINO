# Architecture Snapshot

Current milestone: M6 Account & Ledger Foundation.

The frontend remains a React/Vite demo shell. The browser stores only a demo session bearer token and player display name. Game outcomes and value settlement remain server-authoritative.

## Storage modes

`CasinoService` treats its session store as an async boundary. Local compatibility mode uses the durable JSON-backed `SessionStore`. When `DATABASE_URL` is configured, startup selects `PostgresSessionStore`, applies versioned migrations and uses the M6 account/ledger model.

JSON mode intentionally remains simpler and demo-only. The PostgreSQL path is the architecture that future account, wallet and asset work should extend.

## Account and session separation

In PostgreSQL mode, a session is no longer the durable identity. `accounts` stores persistent account identity while `demo_sessions` remains a revocable bearer-session layer. Rotating, expiring or invalidating a session preserves its account, wallet and ledger history.

This separation is required before introducing real authentication because multiple future sessions can be attached to one durable account without making a session token the financial identity.

## Asset model

`assets` defines asset code, decimal precision, kind and enabled state. Only `DEMO` is enabled in M6. `DEMO` has two decimal places and no monetary value.

Amounts used by the ledger are integer atomic units stored as PostgreSQL `NUMERIC(78,0)`. Application conversion helpers parse decimal strings into atomic units without floating-point settlement math. This provides a precision model that can represent assets with different decimal scales later without changing ledger semantics.

The schema permits `crypto` and `fiat` asset kinds as data-model categories only. M6 does not activate cryptocurrency, blockchain addresses, deposits, withdrawals or custody.

## Ledger model

`ledger_accounts` contains user and system accounts. User available wallets cannot go negative. System issuance/house accounts can go negative where required by demo accounting semantics.

`ledger_transactions` describes business events such as `INITIAL_CREDIT` and `GAME_SETTLEMENT`. `ledger_entries` contains signed postings. A deferred PostgreSQL constraint trigger rejects transactions whose entries do not sum to zero and rejects entries whose ledger-account asset differs from the transaction asset.

For new PostgreSQL demo accounts, the initial credit is posted between the user's DEMO wallet and the DEMO issuance system account. Game settlement posts wager and payout movements between the user's DEMO wallet and the DEMO house system account.

The wallet row maintains `balance_atomic` as a transactional cached balance. Ledger entries remain the accounting history. The current `demo_sessions.balance` column is also updated inside the same transaction as a temporary M5 compatibility mirror; reads in PostgreSQL mode are hydrated from the wallet rather than trusting that mirror.

## Atomic game settlement

A PostgreSQL spin follows this order:

1. validate the bearer session and game request in `CasinoService`;
2. generate a server-side `spinId` before settlement;
3. lock the session row with `FOR UPDATE`;
4. conditionally update the user's DEMO wallet only when it can cover the wager;
5. update the DEMO house ledger account;
6. insert the `GAME_SETTLEMENT` transaction and balanced entries using `spinId` as the settlement idempotency key;
7. increment session spin count and update the compatibility balance mirror;
8. commit all changes together.

A concurrent request therefore cannot spend the same final DEMO units twice. If any ledger write or constraint fails, the whole settlement transaction rolls back.

## HTTP and observability

The API remains versioned under `/api/v1`.

- `/health/live` is process liveness.
- `/health/ready` is persistence readiness.
- `/wallet` returns the current session's DEMO wallet.
- `/spin` resolves and settles a server-authoritative demo spin.
- `/internal/metrics` remains protected by the configured metrics bearer token.

Request IDs, bounded operational metrics and structured HTTP logs remain enabled. `/wallet` is normalized to a fixed metric route, and raw bearer session tokens are not written to audit events or metrics.

## Operations

GitHub CI starts an ephemeral PostgreSQL service, applies migrations and executes integration tests against the real database. The M6 tests verify exact amount conversion, account/session separation, double-entry balancing, concurrent overspend protection, expiry metrics and database rejection of an intentionally unbalanced transaction.

Existing database recovery, observability, migration and deployment runbooks remain part of the M6 operational baseline. Docker/Compose continue to provide a repeatable app + PostgreSQL environment for local/staging-style validation.

## Explicit non-goals

M6 is not a real-money or cryptocurrency implementation. It does not include production authentication credentials, deposits, withdrawals, blockchain monitoring, hot/cold wallets, custody, KYC/AML, sanctions controls, geofencing, certified RNG/game infrastructure or financial operations. Those require separate architecture and legal/compliance gates before activation.

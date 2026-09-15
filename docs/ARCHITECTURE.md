# Architecture Snapshot

Current milestone: M6 Account, Ledger & Auth Foundation.

The frontend remains a React/Vite demo shell. Game outcomes and value settlement remain server-authoritative. PostgreSQL mode separates durable account identity, revocable account-auth sessions, revocable game sessions, DEMO wallets and ledger history.

## Storage modes

`CasinoService` treats its session store as an async boundary. Local compatibility mode uses the durable JSON-backed `SessionStore` and supports guest demo sessions only. When `DATABASE_URL` is configured, startup selects `PostgresSessionStore`, applies versioned migrations and enables the M6 account/ledger/auth model.

JSON mode intentionally remains simpler and demo-only. Account registration/login is unavailable there.

## Account, auth and game-session separation

`accounts` is the durable identity record. `auth_sessions` contains revocable account-auth sessions and stores only SHA-256 hashes of random 256-bit bearer tokens. Passwords are derived with `scrypt` using an independent random salt per account; raw passwords are never persisted.

`demo_sessions` remains the game-session bearer layer. Guest sessions have `auth_required = FALSE`. Registered-account sessions have `auth_required = TRUE` and are bound to the same `account_id` as the account's wallet. Account-bound game operations require both the game-session bearer and a valid account-auth bearer resolving to the same account.

An active guest session can be converted in place during registration. The server locks the guest account, verifies that it has no credentials, flips the existing game session to `auth_required = TRUE`, attaches credentials to the same account, reads the existing wallet and creates an auth session inside one PostgreSQL transaction. The guest account id, wallet id, game-session id, balance and prior ledger entries therefore survive registration unchanged. No second `INITIAL_CREDIT` transaction is created.

Rotating, expiring, logging out of or invalidating a session preserves the durable account, wallet and ledger history. Multiple authenticated game sessions can share one wallet. PostgreSQL `demo_sessions` no longer stores a balance column; session responses hydrate balance exclusively from the account's ledger-backed wallet.

## Asset model

`assets` defines asset code, decimal precision, kind and enabled state. Only `DEMO` is enabled in M6. `DEMO` has two decimal places and no monetary value.

Amounts used by the ledger are integer atomic units stored as PostgreSQL `NUMERIC(78,0)`. Application conversion helpers parse decimal strings into atomic units without floating-point settlement math. The schema permits `crypto` and `fiat` asset kinds as data-model categories only; no cryptocurrency is activated.

## Ledger model

`ledger_accounts` contains user and system accounts. User available wallets cannot go negative. System issuance/house accounts can go negative where required by demo accounting semantics.

`ledger_transactions` describes business events such as `INITIAL_CREDIT` and `GAME_SETTLEMENT`. `ledger_entries` contains signed postings. A deferred database constraint trigger rejects transactions whose entries do not sum to zero and rejects entries whose ledger-account asset differs from the transaction asset.

`ledger_accounts.balance_atomic` is the transactional cached balance used for fast wallet reads, while `ledger_entries` remains the accounting history. Migration `004_remove_session_balance.sql` removes the former `demo_sessions.balance` compatibility mirror after the account/ledger bootstrap has completed. PostgreSQL session records therefore contain identity/session metadata only and cannot diverge from the wallet through a second balance field.

## Ledger reconciliation

`LedgerReconciler` provides a read-only integrity check over the PostgreSQL ledger. It compares each cached `ledger_accounts.balance_atomic` value with the exact sum of its ledger entries, verifies that ledger transactions have at least two entries with a zero signed sum and a single matching asset, and verifies that cached balances across all accounts for each asset conserve to zero.

All reconciliation math uses integer atomic units. The command never rewrites balances or entries. `npm run ledger:reconcile` prints a structured report and returns a non-zero process status when any invariant fails. CI runs this check after the complete database-backed test suite and before accepting the build/smoke/container gates.

A mismatch is treated as an operational incident rather than auto-repaired. The expected response is to preserve evidence, identify the affected account/transaction and apply an explicit reviewed recovery or corrective-ledger procedure.

## Atomic game settlement

A PostgreSQL spin follows this order:

1. validate the game-session bearer and, for account-bound sessions, the matching auth account;
2. validate the game and wager in `CasinoService`;
3. generate a server-side `spinId` before settlement;
4. lock the game-session row with `FOR UPDATE`;
5. conditionally update the user's DEMO wallet only when it can cover the wager;
6. update the DEMO house ledger account;
7. insert the `GAME_SETTLEMENT` transaction and balanced entries using `spinId` as the idempotency key;
8. increment the session spin count and refresh `last_seen_at`;
9. commit all changes together.

A concurrent request therefore cannot spend the same final DEMO units twice. Different authenticated sessions for one account still converge on the same wallet row, which is the only PostgreSQL balance source.

## Authentication flow

Registration is PostgreSQL-only. Without an active guest session, it creates one durable account, one DEMO wallet, one auth session and an account-bound game session. With an active guest session, it upgrades that existing account and session in place and preserves the current DEMO wallet and ledger history. Login creates fresh auth and game sessions for the existing account and existing wallet; it does not issue a new wallet balance.

Auth session activity refreshes only idle expiry. Absolute expiry is fixed at creation. Logout revokes the auth token and, when the current game-session bearer is supplied, invalidates that game session as well. Auth endpoints are protected by a separate sliding-window rate limiter.

The browser stores account-auth and game-session tokens separately in `sessionStorage`. Registration deliberately sends an existing guest game-session token so the server can perform an in-place upgrade, while it omits account auth from the registration request. An expired auth token is surfaced to the client and does not silently downgrade a registered player to a guest session.

## HTTP and observability

The API remains versioned under `/api/v1`.

- `/health/live` is process liveness.
- `/health/ready` is persistence readiness.
- `/auth/register` creates a demo account or upgrades the supplied active guest session in place.
- `/auth/login` authenticates a demo account.
- `/auth/me` returns account + current DEMO wallet.
- `/auth/logout` revokes the current auth session.
- `/wallet` returns the current game session's DEMO wallet.
- `/spin` resolves and settles a server-authoritative demo spin.
- `/internal/metrics` remains protected by the configured metrics bearer token.

Request IDs, bounded operational metrics and structured HTTP logs remain enabled. Auth routes are normalized to fixed metric-route names. Raw auth/game bearer tokens are not written to audit events or metrics. Guest upgrades increment the bounded `auth.guest_upgraded` event counter.

## Operations

GitHub CI starts an ephemeral PostgreSQL service, applies migrations and executes integration tests against the real database. M6 tests cover amount precision, migrations, credential hashing, token hashing, auth expiry, logout/revocation, authenticated gameplay, cross-account isolation, guest-to-account balance/ledger continuity, removal of the legacy session-balance column, double-entry balancing, reconciliation drift detection and concurrent overspend protection.

The CI workflow also runs the read-only DEMO ledger reconciliation after the tests. Existing database recovery, observability, migration, deployment and staging-promotion runbooks remain part of the operational baseline. Reconciliation procedures are documented in `docs/LEDGER_RECONCILIATION.md`.

## Explicit non-goals

M6 is not a real-money or cryptocurrency implementation. It does not include email verification, password reset, MFA, KYC/identity proofing, deposits, withdrawals, blockchain monitoring, hot/cold wallets, custody, sanctions controls, geofencing, certified RNG/game infrastructure or financial operations. Those require separate architecture and legal/compliance gates before activation.

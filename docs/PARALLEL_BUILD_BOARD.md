# GMVKASINO Parallel Build Board V1

Status: Binding delivery model  
Effective: 2026-09-18  
Tracking issue: #69  
Architecture standard: `docs/PRODUCTION_CORE_STANDARD.md`

## Purpose

GMVKASINO may be developed across multiple concurrent engineering streams, but it must remain one transaction-critical system. Parallelism is used to increase throughput, not to create competing implementations of identity, authorization, wallet state, settlement, payments or operations.

The binding architecture order remains:

`Identity -> Authorization/Capabilities -> server-authoritative Business Logic -> Event/Audit Trail -> Idempotency -> Database -> Observability -> Recovery`

## Workstreams

| Stream | Tracking | Owns | Must not own |
| --- | --- | --- | --- |
| Identity & Security | #62 | auth, sessions, recovery, staff step-up/MFA architecture, capability primitives | financial rules, game settlement |
| Wallet & Ledger | #63 | postings, invariants, reconciliation, financial reference model | provider UI, client balances |
| Game Core | #64 | round lifecycle, game/provider contract, normalized result handling | direct wallet mutation |
| Player Frontend | #65 | lobby, account, cashier/history UX, resilient client states | authoritative balances/outcomes/payment status |
| Admin / Operations | #66 | staff UI, review workflows, sanitized operational views | self-elevation or bypass authorization |
| Payments | #67 | payment state machines, provider adapters, event normalization | treating provider state as wallet truth |
| Platform / DevOps | #68 | CI, staging, monitoring, backup/restore, promotion/rollback | weakening application invariants to pass deployment |

## Current parallel first wave

The following work is intentionally safe to run in parallel:

1. Identity: account recovery/email verification and staff step-up/MFA-ready architecture.
2. Ledger: financial mutation/invariant matrix and reusable integrity test harness.
3. Game: provider-neutral adapter and normalized durable round contract.
4. Player: route/account/history UX built against stable API contracts.
5. Ops: least-privilege navigation and sanitized support/finance views.
6. Payments: sandbox provider adapter, event normalization, dedupe and out-of-order tests.
7. DevOps: close #25 and #26; progress #27 and #28 in isolated staging.

## Branch naming

Every implementation branch belongs to a primary stream:

- `stream/identity-<slug>`
- `stream/ledger-<slug>`
- `stream/game-<slug>`
- `stream/player-<slug>`
- `stream/ops-<slug>`
- `stream/payments-<slug>`
- `stream/devops-<slug>`

One PR has one primary stream. A PR may touch another stream only when the cross-stream contract change is explicit in the PR body and its tests.

## Shared contracts

### Identity contract

Identity and capability primitives are centralized. No client or feature domain may create an alternate role system, broad `is_admin` bypass, independent session truth or client-authoritative permission check.

### Financial contract

The ledger is the source of truth for money-like state. No domain may mutate an authoritative wallet balance outside balanced ledger postings. Every retryable financial effect requires stable idempotency semantics and a traceable reference.

### Game contract

A game/provider returns a normalized result into the server-authoritative Game Round flow. Providers and browser clients never settle wallets directly. A replay must not regenerate a result or post a second settlement.

### Payment contract

External/provider state is untrusted input. It is normalized, deduplicated and translated into authoritative internal state transitions. Ledger effects occur exactly once and reconciliation must detect divergence.

### Operations contract

Privileged actions are default-deny and capability-protected. Staff UI never grants roles or capabilities by itself. Sensitive actions must have audit correlation and, where appropriate, step-up-auth hooks.

### Release contract

A visual browser check is not a release gate. CI, exact-revision staging verification, reconciliation, smoke, backup/restore evidence and rollback criteria remain authoritative.

## Merge gate

Every PR must satisfy:

- current `main` integrated before final merge
- standard CI green
- contract tests for changed behavior
- no unresolved P0 security or integrity regression
- migration compatibility where schema changes
- no secret/PII leakage in logs, fixtures or operational responses

A PR that introduces or changes a critical mutation must additionally satisfy:

- stable idempotency key or replay contract
- duplicate/concurrent-delivery safety
- request ID + durable audit correlation
- capability enforcement when privileged
- ledger/reconciliation coverage when financial
- explicit failure semantics; partial financial state is not accepted

## Integration gates

### Gate A — Foundation

The shared identity/capability, ledger, audit and idempotency primitives remain green. Streams may use mocks at their own API boundary, but not substitute alternate production logic.

### Gate B — Demo money loop

The complete sandbox loop passes against one integrated revision:

`sandbox deposit -> wallet -> bet -> game settlement -> ledger -> sandbox withdrawal`

Ledger and payment reconciliation must both finish cleanly.

### Gate C — Production readiness

Production/real-money activation remains fail-closed until evidence exists for:

- staging exact-revision verification
- monitoring and actionable alerts
- hosted backup/PITR and restore drill
- rollback procedure
- concurrency/load validation
- identity/session security
- capability matrix
- financial reconciliation
- applicable jurisdiction/licensing/compliance controls

## Open operational dependencies

- #25 Verify Railway backups, PITR and first restore drill
- #26 Staging release and promotion gate
- #27 Export retained metrics and define alert thresholds
- #28 Load and concurrency regression tests

These belong to the DevOps stream and remain cross-stream launch dependencies.

## Parallel-work rule

The system may have many branches and PRs in flight at once, but only one authoritative implementation for each shared primitive. If two streams need the same primitive, they extend the shared contract once and both consume it.

Do not create:
- a second authentication/session model
- a second permission model
- a second wallet/balance truth
- a second settlement path
- a provider-owned payment truth
- a client-authoritative critical mutation

## Real-money / crypto boundary

The existing payment domain remains sandbox/demo only. Provider abstractions may be built and tested with fake/sandbox adapters, but real money, real crypto assets, custody, addresses or production payment credentials are not activated merely because the software path exists.

Activation remains subordinate to Gate C and the selected jurisdiction/licensing/compliance architecture.

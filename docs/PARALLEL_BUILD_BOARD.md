# GMVKASINO Parallel Build Board V1

Status: Binding delivery model  
Effective: 2026-09-18  
Tracking issue: #69  
Architecture standard: `docs/PRODUCTION_CORE_STANDARD.md`  
Game parallelization extension: `docs/MULTI_GAME_PARALLEL_STANDARD.md`

## Purpose

GMVKASINO may be developed across multiple concurrent engineering streams, but it must remain one transaction-critical system. Parallelism is used to increase throughput, not to create competing implementations of identity, authorization, wallet state, settlement, payments or operations.

The binding architecture order remains:

`Identity -> Authorization/Capabilities -> server-authoritative Business Logic -> Event/Audit Trail -> Idempotency -> Database -> Observability -> Recovery`

## Autonomous Parallel Build Loop

GMVKASINO adopts the GMVGANG `Autonomous Parallel Build Loop V1` as its default execution model, extended by the stricter financial/security controls in this document.

Every implementation stream follows:

`Scope -> Branch -> Implementation -> Tests -> Self-Review -> optional AI Second Review -> PR -> CI -> Merge Gate -> Smoke Test -> Documentation`

### Operating rules

- Keep at most 3-5 top-level platform/core implementation streams actively changing shared product code at the same time, even though seven workstreams exist. Isolated per-game branches governed by `docs/MULTI_GAME_PARALLEL_STANDARD.md` are additional substreams and do not count against this guideline.
- Prefer independent files/modules/contracts so active streams do not compete for the same shared core.
- Shared-core changes are serialized: merge the foundation change first, then update/rebase dependent streams.
- Every task must have explicit scope, acceptance criteria, dependencies, owned files/contracts and a clear done condition.
- ChatGPT acts as orchestration/execution layer: decomposes approved work, coordinates branches/PRs/tests/reviews, detects conflicts and prepares the next executable work.
- Founder involvement is reserved primarily for product/pricing choices, irreversible decisions, external-provider commitments, legal/compliance decisions and production/real-money gates.
- Routine implementation, testing, review, documentation and non-irreversible technical decisions should proceed without unnecessary founder interruption.

### Casino critical-mutation extension

Any work that can change money-like state, game settlement, payment state, account privilege or compliance state must additionally pass:

`Idempotency/Replay -> Concurrency Safety -> Capability Enforcement -> Audit/Request Correlation -> Ledger Integrity -> Reconciliation`

A stream is not considered complete merely because the UI works or a happy-path test passes.

### Scheduling rule

Seven top-level platform/core workstreams may remain open, but only 3-5 should normally be in active implementation simultaneously. Blocked or review-only platform/core streams do not consume an implementation slot. Independent per-game branches are governed separately by the Multi-Game Parallel Development Standard and do not consume these top-level slots.

When a stream is blocked on a shared primitive, it should either:
1. switch to contract-safe frontend/test/documentation work, or
2. yield its active slot to the next Ready stream.

This is the default execution policy for future GMVKASINO development unless explicitly overridden for a specific task.

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

Multiple games may be developed concurrently only through the shared Game Registry/adapter contract defined in `docs/MULTI_GAME_PARALLEL_STANDARD.md`. Shared Game Platform changes are serialized; individual game branches may proceed in parallel after that contract is green.

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

The system may have many branches and PRs in flight at once, including multiple isolated game branches, but only one authoritative implementation for each shared primitive. If two streams need the same primitive, they extend the shared contract once and both consume it.

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


## Integration record — Wave 1 (2026-09-18)

First autonomous parallel wave:

- #78 Identity security readiness state
- #79 Financial integrity matrix
- #80 Player account/security surface
- #81 Provider-neutral sandbox payment event adapter
- #82 Synthetic load/concurrency harness

Each stream passed its isolated PR CI gate before merge. This integration record PR exists to run the complete CI/reconciliation/recovery/build/smoke pipeline once more against the combined `main` state.


## Integration record — Wave 2 (2026-09-18)

Second autonomous parallel wave:

- #94 Neon Fruits isolated DEMO game module
- #95 Capability-aware Staff Operations workspace
- #96 Step-up authentication policy foundation
- #97 Payment event-history reconciliation
- #98 Load baseline threshold evaluator

All feature streams passed isolated PR CI before merge. This integration record PR runs the complete CI/reconciliation/recovery/build/smoke pipeline against the combined `main` state.

Neon Fruits remains `coming-soon` and DEMO-only. Step-up policy is a foundation only; no MFA/verification bypass or false production-readiness claim is introduced. Real-money/crypto activation remains blocked by Gate C.


## Integration record — Wave 3 (2026-09-18)

Third autonomous parallel wave and concurrent Game Core substreams:

- #104 Diamond Rush isolated DEMO game
- #105 Lucky 777 isolated DEMO game
- #106 serialized shared Game Registry/catalog integration
- #107 authenticated DEMO transaction history
- #108 sanitized staff player directory
- #109 single-use account recovery token foundation
- #110 signed provider webhook envelope verifier

All merged feature streams passed isolated PR CI before integration. This integration record PR runs the complete test/reconciliation/recovery/build/smoke pipeline against the combined current `main`.

Diamond Rush and Lucky 777 remain `coming-soon` and DEMO-only. Account recovery still has no public reset endpoint. Webhook verification authenticates raw provider input only and does not mutate payment or ledger state. Real-money/crypto activation remains blocked by Gate C.

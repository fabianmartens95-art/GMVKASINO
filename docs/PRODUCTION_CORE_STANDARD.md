# GMVKASINO Production Core Standard

Status: Binding engineering standard
Effective: 2026-09-17
Scope: GMVKASINO only

## 1. Purpose

GMVKASINO is treated as a transaction-critical platform, not as a slot website with accounts and payments attached later.

The implementation order is:

Identity -> Authorization/Capabilities -> server-authoritative Business Logic -> Event/Audit Trail -> Idempotency -> Database -> Observability -> Recovery.

GMVGANG and GMVKASINO remain separate products, repositories, data domains and security boundaries. Only generic engineering patterns are transferred.

## 2. Non-negotiable invariants

1. The client is never authoritative for balances, bets, payouts, bonuses, deposits, withdrawals, account status or game settlement.
2. Every money-like mutation must be traceable to an immutable transaction/event record.
3. Critical mutations must be idempotent. A retry must not create a second financial effect.
4. Game rounds must be server-authoritative and replay-safe.
5. Wallet state must be ledger-backed. A mutable balance field alone is not a source of truth.
6. Staff access must be capability-based. A broad `is_admin` flag is insufficient for production.
7. Every critical request must be correlatable through a request ID and audit/event trail.
8. Production releases must pass a defined promotion gate and have an operational rollback/recovery path.
9. Compliance requirements are a parallel launch track and depend on the selected jurisdiction/licence model.
10. Real-money operation is blocked until the Production Gate is explicitly satisfied.

## 3. Role and capability model

Base account roles:

- `player`
- `support`
- `compliance`
- `finance`
- `admin`
- provider/integration identities where required

Capabilities are the authorization primitive. Roles are only bundles of capabilities.

Examples:

- `casino.play`
- `wallet.read`
- `player.read`
- `session.read`
- `risk.review`
- `ledger.read`
- `reconciliation.read`
- `audit.read`
- future write capabilities such as withdrawal review, account restriction, manual adjustment and provider operations must be explicit and narrowly scoped

## 4. Wallet and ledger standard

The ledger is the financial source of truth.

Transaction classes must support at least:

- initial/demo credit
- deposit
- wager/bet
- game payout
- bonus credit/debit
- adjustment
- refund/reversal
- withdrawal
- fee where applicable

Every transaction must have a stable transaction ID, asset/currency, type, reference, timestamps and an idempotency key when mutation can be retried.

Amounts are stored in atomic units / exact numeric representation. Floating-point values must not be the persistence source of truth for real balances.

## 5. Game round lifecycle

Target lifecycle:

REQUESTED -> AUTHORIZED -> RESULT_CREATED -> SETTLED -> AUDITED

A round must have a stable round ID and idempotency key. The request fingerprint must bind at least account/session context, game, bet and relevant asset.

A repeated request with the same idempotency key and same fingerprint returns the previously stored round response. It must not execute RNG again, increment the spin count again or post another ledger transaction.

A repeated idempotency key with a different fingerprint must fail with an explicit conflict response.

Game outcome creation and wallet settlement must be coordinated so that a partial financial state cannot be committed.

## 6. Audit and request correlation

All critical operations must include a request/correlation ID in structured logs and audit data.

Minimum audited domains:

- authentication and session lifecycle
- account status and access changes
- role/capability changes
- game rounds
- ledger-affecting actions
- deposits and withdrawals
- bonuses and manual adjustments
- compliance/risk actions
- privileged staff operations

Audit history must not depend on application console logs alone.

## 7. Client separation

GMVKASINO uses a shared backend/API/auth/business-logic layer with separate clients.

Initial clients:

- Player web application
- Admin / Operations Console

Future PWA/native clients must consume the same server-authoritative APIs. Business rules must not be duplicated into clients.

## 8. Observability and recovery

Production readiness requires:

- liveness and readiness probes
- structured application logs
- request IDs
- operational metrics
- error monitoring/alerting
- ledger reconciliation
- database backups
- restore verification
- documented rollback/recovery procedure

A backup that has never been restore-tested does not satisfy the recovery requirement.

## 9. Release flow

Development -> Staging -> Automated Tests -> E2E Money Flow -> Security Checks -> Promotion Gate -> Production -> Smoke Test -> Monitoring -> Recovery/Rollback if needed.

No visual completion signal or manual browser check replaces the gate.

## 10. Compliance track

The following are launch dependencies for any real-money operation and must be designed against the selected jurisdiction/licence regime:

- KYC / identity verification
- age verification
- AML controls and transaction monitoring
- responsible-gaming controls and limits
- self-exclusion / account restrictions where required
- privacy/data-retention requirements
- payment and withdrawal controls
- game/provider/RNG requirements where applicable

This document is an engineering standard, not a legal conclusion about which controls are sufficient in a specific jurisdiction.

## 11. Current repository assessment (2026-09-17)

Already present in the repository:

- server-authoritative spin endpoint and game engine call
- account authentication and sessions
- role/capability model
- PostgreSQL-backed ledger with balanced entries
- unique ledger idempotency-key field
- ledger reconciliation
- audit-event persistence
- request IDs in HTTP handling
- health/readiness endpoints
- operational metrics
- migrations
- staging/revision verification
- database recovery documentation and restore verification
- CI and smoke-test foundations

Important remaining P0 gaps:

- durable idempotent game-round replay contract at the API/service level
- stored game-round response/fingerprint so retries do not re-run RNG
- explicit capability enforcement at every privileged endpoint
- production-grade event/audit schema coverage for all future financial/admin mutations
- real-money payment/deposit/withdrawal domain is not yet implemented
- jurisdiction-specific compliance controls are not yet implemented
- production promotion gate is not yet a complete real-money launch gate

## 12. Delivery order

### P0 Core

1. Auth and capability enforcement
2. Wallet/ledger invariants
3. Durable idempotent Game Round model
4. Request fingerprinting + replay/conflict semantics
5. Audit/event correlation for critical mutations

### P0 Production

1. Database/security hardening
2. Admin / Operations Console foundation
3. Monitoring and alerting
4. Backup and restore verification
5. Staging E2E financial-flow tests
6. Promotion/rollback gate

### P1 Product

1. Casino lobby
2. Slot/player UX
3. Provider abstraction/integration
4. Payment domain after licensing/compliance architecture is defined
5. Promotion/bonus engine

### Parallel Compliance

Jurisdiction/licence -> KYC/AML -> age verification -> responsible gaming -> privacy/data retention -> payment/withdrawal requirements -> provider/game certification requirements.

## 13. Production Gate

Real-money launch remains blocked until all applicable items below are verified with evidence:

- Identity/auth/session security verified
- Authorization/capability tests verified
- Ledger invariants and reconciliation verified
- Idempotent game-round retry tests verified
- Concurrent mutation tests verified
- Deposit/withdrawal idempotency verified when implemented
- Audit coverage verified
- Staging E2E money flow verified
- Monitoring/alerts verified
- Backup restore drill verified
- Rollback procedure verified
- Required compliance/licensing controls verified for the target jurisdiction
- No unresolved P0 security or financial-integrity defect

The launch date is subordinate to this gate.

# GMVKASINO Product & Delivery Operating System V1

Status: Binding governance and product delivery standard  
Effective: 2026-09-18  
Tracking issue: #181  
Parent technical delivery model: `docs/PARALLEL_BUILD_BOARD.md`  
Game parallelization: `docs/MULTI_GAME_PARALLEL_STANDARD.md`  
Documentation sync: `docs/DOCUMENTATION_SYNC_GATE.md`  
Competitive benchmark: `docs/COMPETITIVE_PRODUCT_MATRIX.md`

## Purpose

GMVKASINO uses one product/delivery operating model above the existing engineering streams. The goal is to increase shipping speed without weakening security, money integrity, operational readiness or Founder control over irreversible decisions.

The product layer does not replace technical Integration Waves or Game Waves. To avoid collisions, Casino Product Waves use the prefix **CPW**.

## Source-of-truth split

- GitHub is authoritative for code, issues, PRs, tests, CI, migrations, release evidence and exact implementation status.
- Notion Casino OS is authoritative for product roadmap, operating standards, decisions, governance summaries and executive navigation.
- When both systems contain the same item, GitHub implementation evidence wins for code status; Notion must be synchronized after the merge/gate.
- No second project-management database is introduced.

## Operating loop

Every approved product slice follows:

`Scope -> Product Wave -> Notion Impact -> Issue -> Branch -> Implementation -> Tests -> Self-Review -> optional AI Second Review -> PR -> CI -> Merge Gate -> Smoke/Integration Evidence -> Notion Sync -> Cross-Project Learning Check`

For critical mutations, the existing stricter gate remains mandatory:

`Idempotency/Replay -> Concurrency Safety -> Capability Enforcement -> Audit/Request Correlation -> Ledger Integrity -> Reconciliation`

## Founder decision boundary

Founder approval is normally reserved for:
- product positioning, monetization and pricing
- irreversible architecture or vendor lock-in
- external provider commitments and material recurring cost
- jurisdiction, licensing, legal and compliance decisions
- production/real-money/crypto activation
- material changes to player-safety policy
- destructive data changes or high-risk production migration

Routine implementation, testing, documentation, reversible refactors and contract-safe technical decisions should proceed without unnecessary Founder interruption.

## Architecture boundary

Player App and Operations Console are clients of one authoritative backend/API layer.

Clients may render state and request actions, but they do not own:
- identity/session truth
- capability/permission truth
- wallet/balance truth
- ledger postings
- game outcome authority
- settlement
- payment truth
- audit evidence

The canonical platform order remains:

`Identity -> Authorization/Capabilities -> Server-authoritative Business Logic -> Event/Audit Trail -> Idempotency -> Database -> Observability -> Recovery`

## Product principle: Next Best Action

Dashboards should not be passive data dumps. Where a safe, deterministic action is available, the UI should expose the next relevant action.

Player examples:
- complete account/security setup
- continue a playable DEMO game
- review a pending sandbox transaction
- inspect transaction/spin history after a failed or replayed action

Operations examples:
- investigate a reconciliation mismatch
- review a risk/support queue item
- inspect a security/session event
- resolve a launch-readiness blocker

Next Best Action must never bypass authorization, compliance, responsible-gaming controls or authoritative backend state.

## Observability and recovery are product capabilities

A feature is not launch-ready merely because the UI works. Product readiness includes:
- request/audit correlation
- retained metrics
- actionable alerts
- reconciliation
- exact-revision staging evidence
- backup/PITR and restore proof
- rollback criteria
- incident diagnostics

## Casino Product Waves

### CPW1 — Production Foundation & Security
Tracking: #182

Scope: identity/session hardening, capabilities, audit/correlation, retained monitoring, staging exact-revision verification, backup/PITR, restore, rollback and concurrency/load evidence.

Exit gate:
- no known P0 auth/capability/integrity regression
- exact-revision staging verification green
- actionable monitoring/alerts available
- restore drill and rollback procedure evidenced
- critical mutation suites green
- real-money/crypto disabled

### CPW2 — Demo Money Loop & Player Trust
Tracking: #183

Scope: `deposit -> wallet -> bet -> settlement -> ledger -> withdrawal`, transaction/spin history, pending/failed/replayed states and reconciliation evidence.

Exit gate:
- Gate B loop passes on one integrated revision
- player-visible state does not contradict ledger/payment truth
- duplicate/concurrent requests cannot duplicate financial effects
- ledger/payment reconciliation clean
- failure states explicit and recoverable

### CPW3 — Casino Lobby & Player UX
Tracking: #184

Scope: lobby/navigation, discovery/detail/play routes, account/security UX, responsive/mobile quality, accessibility baseline and Player Next Best Action.

Exit gate:
- complete signed-in DEMO journey works end to end
- every playable game uses shared catalog/adapter platform
- no client-authoritative critical state
- responsive smoke and accessibility checks green

### CPW4 — Payments & Cashier Readiness (Sandbox)
Tracking: #185

Scope: provider-neutral sandbox payment state machines, signed webhooks, exactly-once ingestion, pending/failure UX, adapter contracts and reconciliation.

Exit gate:
- duplicate and out-of-order events safe
- provider state never becomes wallet truth
- payment/ledger reconciliation green
- audit/operational diagnostics available
- production credentials and real-money/crypto activation disabled

### CPW5 — Operations, Risk & Responsible Gaming
Tracking: #186

Scope: least-privilege Support/Risk/Finance workflows, audit/reconciliation evidence, review queues, player-safety control architecture and Ops Next Best Action.

Exit gate:
- default-deny capability enforcement
- no UI self-elevation
- sensitive actions audited and step-up-ready
- operational views sanitize secrets/PII
- required jurisdiction-specific safety/compliance controls mapped before production

### CPW6 — Game Factory & Content Expansion
Tracking: #187

Scope: reusable game families, isolated game branches, simulation/certification, catalog activation and game-quality evidence.

Exit gate:
- every playable game passes mandatory certification
- shared Game Platform changes serialized
- game branches remain isolated
- no game mutates wallet/ledger directly
- replay/concurrency/wallet-consistency suites green

### CPW7 — Beta & Launch Readiness
Tracking: #188

Scope: release checklist, production E2E, incident/rollback/recovery runbooks, support readiness, security evidence, compliance/licensing evidence, provider readiness and launch metrics.

Exit gate:
- Production Readiness Gate C evidence complete
- exact staging revision passes E2E/smoke/reconciliation
- monitoring, incident response and recovery drill verified
- current security/capability matrices
- jurisdiction/licensing/compliance approvals explicitly documented
- production/real-money activation requires explicit Founder Decision

## Active wave policy

Only one Casino Product Wave is the primary product gate at a time, while technical implementation may continue in parallel underneath it.

Current default active wave: **CPW1 — Production Foundation & Security**.

CPW6 isolated game production may continue in parallel under the Multi-Game standard provided it does not weaken or bypass the active product gate.

## Competitive Product Matrix

The Competitive Product Matrix is maintained as a product benchmark, not as a cloning checklist. New material player/operations features should be compared across:
- onboarding/account security
- lobby/discovery/search/filtering
- game detail/play experience
- cashier/payment states
- transaction/history transparency
- bonuses/promotions/VIP only where legally appropriate
- responsible gaming/player protection
- support/help
- mobile/responsive UX
- staff operations/risk/reconciliation
- observability and incident handling

Each benchmark item is classified as:
- Adopt
- Adapt
- Reject
- Defer

A benchmark creates implementation work only when a concrete GMVKASINO gap exists.

## Cross-project learning gate

After material builds, incidents, security findings, architecture changes or product-wave exits, run:

`Extract -> Classify -> Compare -> Decide -> Execute -> Verify -> Sync`

Potential GMVGANG learnings may be reused only as generic engineering/governance patterns. GMVGANG and GMVKASINO domain logic, repositories and production data remain separate.

## Release discipline

Technical Integration Waves, Game Certification and Product Waves all gate different risk dimensions:
- Integration Wave: can multiple isolated changes coexist safely?
- Game Certification: is an individual playable game contract-safe and integrity-safe?
- Product Wave: is the product capability mature enough to advance?

Passing one does not imply passing the others.

## Real-money / crypto boundary

Nothing in this operating system activates real-money gambling, crypto custody, production payment credentials or a regulated launch. These remain fail-closed behind Gate C plus explicit jurisdiction/licensing/compliance and Founder decisions.

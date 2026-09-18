# GMVKASINO Multi-Game Parallel Development Standard V1

Status: Binding Game Core extension  
Effective: 2026-09-18  
Tracking: #83  
Parent stream: #64  
Parent delivery model: `docs/PARALLEL_BUILD_BOARD.md`

## Purpose

GMVKASINO may develop multiple games concurrently, but every game must consume the same authoritative platform primitives. A game is a domain module, not a separate casino backend.

The required flow remains:

`Player -> Game Adapter -> Authoritative Round -> Settlement -> Ledger -> Wallet Projection`

No game may create an alternate wallet, balance, settlement, payment, identity, authorization, audit or idempotency truth.

## Platform boundary

Shared platform ownership remains centralized for:

- identity and sessions
- capabilities and privileged authorization
- DEMO wallet and ledger
- durable game-round idempotency
- settlement and reconciliation
- payments
- request/audit correlation
- observability and recovery

Individual games own only:

- game rules/math
- game-specific state machine
- game-specific assets and presentation
- game-specific normalized outcome payload
- deterministic/simulation fixtures and tests

## Game adapter contract

Every playable game must register one server-side adapter with a stable game id.

The adapter receives server-provided context such as the validated bet, approved RNG source and immutable game metadata. It returns a JSON-serializable normalized game result.

The adapter must never return or control authoritative fields such as:

- round/spin id
- game id
- bet amount
- wallet balance
- session spin counter
- account id
- request/idempotency identifiers
- settlement reference

Those values are assigned by the authoritative platform after game resolution.

A normalized result must contain a finite non-negative `totalWin` that fits the DEMO asset's two-decimal precision exactly; excess precision fails closed and is never silently rounded. Additional game-specific fields are allowed when JSON-serializable.

## Reference implementation

`golden-vault` is the reference game.

Its existing slot engine is now consumed through the shared Game Registry. The authoritative PostgreSQL Game Round executor remains the settlement boundary and continues to provide:

- account-scoped idempotency serialization
- replay without re-running RNG
- wallet locking
- exactly-once ledger settlement
- durable response persistence
- request correlation

Golden Vault behavior is therefore migrated behind the contract without creating a second settlement path.

## Parallel game branches

Once the shared Game Platform contract is merged, individual games use isolated branches:

- `stream/game-neon-fruits-<slug>`
- `stream/game-diamond-rush-<slug>`
- `stream/game-lucky-777-<slug>`
- future: `stream/game-<game-id>-<slug>`

A game branch must not modify shared settlement/ledger/auth/payment primitives. Shared contract changes are proposed as a separate `stream/game-platform-*` change and merged before dependent game branches rebase.

## Game build loop

Each game follows:

`Spec -> Math/Rules -> Adapter -> State Machine -> UI/Assets -> Unit Tests -> Simulation Tests -> Contract Tests -> E2E -> Self Review -> PR -> CI -> Game Certification Gate`

## Game Certification Gate

A game is not considered playable/production-ready until all applicable checks pass:

- stable unique game id
- registered server-side adapter
- server-authoritative outcome resolution
- valid normalized result contract
- approved bet validation
- deterministic fixtures/simulation coverage
- replay does not re-run resolution
- duplicate/concurrent requests cannot double-settle
- ledger settlement remains exactly once
- no direct wallet/balance mutation
- request/audit correlation present
- client cannot provide authoritative payout/outcome
- failure paths fail closed
- standard CI green
- integration smoke test against current platform revision
- staging money-flow certification must execute replay, concurrent-duplicate and wallet-consistency checks for every game marked `playable`; testing only the first available game is insufficient

## Parallelism policy

The repository-wide guideline of 3-5 active implementation streams applies to top-level platform/core workstreams. It does **not** cap isolated per-game development branches.

Individual games may therefore be developed in additional parallel branches when their ownership is isolated and they consume the stable shared Game Platform contract. The practical concurrency limit is CI/review capacity and conflict risk, not the 3-5 platform-stream guideline.

Within Game Core:

1. Shared Game Platform/core changes are serialized.
2. Independent per-game branches do not count against the 3-5 top-level platform/core stream guideline.
3. Multiple independent games may be implemented concurrently after the shared contract is green.
4. Game branches must not edit the same shared core modules concurrently.
5. If a game requires a shared contract extension, that extension is extracted into a separate `stream/game-platform-*` foundation PR first.
6. Games consume wallet/ledger/settlement through the existing authoritative platform only.
7. A game branch stops being an isolated game stream and becomes a shared-core change the moment it modifies common settlement, registry contract, wallet, ledger, auth, payments or other platform primitives.

## Initial game queue

Reference:
- Golden Vault — playable reference implementation

Parallel candidates after #83:
- Neon Fruits
- Diamond Rush
- Lucky 777

These begin as isolated game implementations and remain `coming-soon` until their individual Game Certification Gate is green.

## Real-money boundary

This standard does not activate real money, crypto, custody or external payment rails. All current financial behavior remains DEMO/sandbox only. Any future activation remains subordinate to the Production Readiness Gate, licensing/compliance decisions and provider due diligence.


## Mandatory CI certification

Every pull request and every push to `main` now runs:

```bash
GAME_CERTIFICATION_SAMPLES=250 npm run games:certify
```

This step is part of the required `test-and-build` job. Registry/catalog mismatches, adapter contract failures, invalid DEMO payout precision, non-finite or negative payouts, and exposure of reserved server-authoritative result fields fail the normal merge gate.

Certification is read-only. It never changes a game status and never promotes a deployment.

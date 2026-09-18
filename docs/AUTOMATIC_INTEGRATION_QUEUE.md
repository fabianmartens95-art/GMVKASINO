# GMVKASINO Automatic Integration Queue V1

Status: active engineering standard after merge  
Effective: 2026-09-18  
Parent standard: `docs/PARALLEL_BUILD_BOARD.md`

## Purpose

Remove manual merge and branch-refresh latency from the parallel build board while keeping casino integrity gates fail-closed.

The optimized loop is:

`Ready stream -> isolated branch -> implementation -> full CI -> queue -> exact-head merge/update -> full CI -> next stream`

## Eligibility

Automatic integration is opt-in. A PR must explicitly declare:

- `Auto merge: yes`
- `Production gate: no`
- `Founder decision: no`

It must also target `main`, be non-draft, originate from this repository, have a trusted repository association, have all declared dependencies satisfied, have no active changes-requested review, and have no blocking queue/gate label.

The queue requires the complete `test-and-build` CI job to succeed. That preserves the existing security audit, migrations, test suite, ledger reconciliation, payment reconciliation, restore drill, frontend build, smoke check and container build.

## Queue behavior

The worker performs at most one repository mutation per run.

1. Merge one fully green/current PR using its exact verified head SHA.
2. Otherwise update one fully green but behind PR onto current `main`.
3. Fresh CI then triggers the next worker.

Conflicts, pending/failing checks, requested changes, unresolved dependencies, founder gates and production gates remain open for intervention.

## Critical-mutation rule

Financial, settlement, account-privilege, payment or compliance changes are not automatically eligible merely because CI is green. Their task owner must deliberately set `Auto merge: yes` only when the applicable Parallel Build Board critical-mutation extension is satisfied.

Real-money/crypto activation remains outside this queue and continues to require the existing production/compliance gates.

## Trust boundary

The queue never checks out PR-head code and never executes code supplied by a pull request. It runs the trusted queue policy from `main` and reads GitHub metadata/check results.

## Next step

After V1 is stable, compatible independent streams can move to an Integration Wave V2 that creates a temporary combined revision and runs cross-stream E2E before promotion.

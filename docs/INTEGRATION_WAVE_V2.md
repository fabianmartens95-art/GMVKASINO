# Integration Wave V2

Status: active engineering standard after merge  
Effective: 2026-09-18

## Purpose

Integration Wave V2 batches compatible, explicitly opted-in pull requests on one temporary integration revision before promotion to `main`.

The flow is:

`individual PR CI -> compatibility gate -> temporary integration branch -> combined PR CI -> up-to-date check -> merge promotion`

## Routing

- `Auto merge: yes` + `Integration wave: no` uses Automatic Integration Queue V1.
- `Auto merge: yes` + `Integration wave: yes` uses Integration Wave V2.
- Production gates, Founder Decisions, drafts, untrusted forks, requested changes and unresolved dependencies are never wave-eligible.

## Casino safety extension

The first V2 rollout excludes Auth/Authorization, migrations, ledger/reconciliation, payment state, CasinoService/settlement, HTTP composition, Game Registry and package-lock/shared tooling paths from automatic batching. Those remain serialized until later evidence supports widening the policy.

Every combined revision still passes the complete `test-and-build` gate: security audit, migrations, tests, game certification, ledger reconciliation, payment reconciliation, restore verification, frontend build, smoke and container build.

## Compatibility and promotion

The control plane rejects large PRs, overlapping files and protected/shared-core paths. At least two compatible source PRs are required. Source heads are merged into a temporary `integration/wave-v2-*` branch through GitHub's merge API; the privileged workflow never checks out source PR code.

The generated integration PR receives normal CI. Promotion requires current `main`, exact green combined head and all current checks green. A source-head change, eligibility drift, invalid metadata or integration conflict invalidates the wave and forces a rebuild.

The integration PR uses a merge commit so source commit ancestry remains traceable.

## Real-money boundary

Integration Wave V2 does not activate real-money or crypto capabilities and does not weaken Production Gate C, compliance, recovery or financial-integrity requirements.

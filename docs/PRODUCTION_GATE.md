# GMVKASINO Real-Money Production Gate

Status: P0 release control. Default decision is **BLOCK**.

This gate composes the repository's existing CI, staging verification, ledger/recovery foundations, idempotent game-round behavior and operational evidence into one fail-closed launch control. It does not activate real-money mode by itself.

## Core rule

A production deployment may exist in **demo mode** before the gate passes. Real-money activation remains blocked until every active technical check and every required external/manual evidence item passes for the exact deployed revision.

## Machine-readable policy

`config/production-gate.json` defines the required statuses, evidence and conditional payment checks. `npm run gate:evaluate` evaluates that policy and exits non-zero whenever a required check is missing or failed.

The policy is deliberately fail-closed: missing evidence is a failure, not a warning.

## Automated evidence

The `Real-Money Production Gate` workflow requires:

1. The workflow runs from `main`.
2. The exact `GITHUB_SHA` has a successful `ci.yml` run.
3. No open production blocker exists.
4. Staging is a distinct HTTPS target.
5. Staging reports the exact requested revision and remains in `demo` mode.
6. Remote staging smoke checks pass.
7. The staging demo money-flow E2E passes: session -> wallet -> spin -> identical retry -> concurrent duplicate -> wallet consistency.
8. The exact revision is deployed to production while production still reports `mode: demo`.
9. Remote production smoke checks pass against that promoted revision.

Existing `ci.yml` already executes the repository's security audit, migrations, test suite, demo-ledger reconciliation, PostgreSQL dump/restore verification, frontend build, local smoke check and container build. The production gate verifies successful CI evidence for the exact revision rather than silently substituting a different commit.

## Production blockers

Any open issue with either of these markers blocks the gate:

- title contains `[PROD-BLOCKER]`
- label `production-blocker`

Use this marker for unresolved P0 defects that can affect security, financial integrity, authorization, ledger correctness, idempotency, recovery, or other release-critical invariants. The gate queries GitHub at runtime and fails when one is open.

The blocker convention is an operational control. A newly discovered release-critical defect must be marked immediately rather than left as an unclassified issue.

## Manual/external evidence

The final gate requires explicit references for:

- security / financial-integrity P0 review
- production monitoring and alert verification
- rollback verification
- jurisdiction / licensing / compliance approval

The workflow treats these as external evidence because CI cannot establish legal readiness or independently verify operational approvals.

A compliance approval input without a non-empty evidence reference fails the gate.

## Payments

The current platform remains demo-only and does not yet introduce a deposit/withdrawal domain. `GATE_PAYMENT_DOMAIN_INTRODUCED=false` therefore leaves deposit/withdrawal idempotency checks inactive.

As soon as deposits or withdrawals are introduced, set the flag to `true`. The gate then requires both:

- deposit idempotency status = `passed`
- withdrawal idempotency status = `passed`

A payment-domain implementation must not bypass or remove these conditional checks.

## Promotion and activation

Passing the workflow means that the configured technical and external evidence checks passed for that exact revision. It does **not** automatically switch the application into real-money mode and it does not perform a deployment.

Activation, if and when legally and operationally permitted, must be a separate explicit change with its own reviewed configuration and rollback path. Until then, `/api/v1/health/live` is expected to report `mode: demo`.

## Required GitHub environment configuration

Before the gate can pass, configure:

- `staging` environment secret: `STAGING_BASE_URL`
- `staging` environment secret: `PRIMARY_BASE_URL`
- `production` environment secret: `PRODUCTION_BASE_URL`
- `real-money-production-gate` environment: use required reviewers/approval controls appropriate to the project

The production gate should be dispatched only after the exact revision has passed CI, been deployed to staging, passed staging verification, and been promoted to the production environment in demo mode.

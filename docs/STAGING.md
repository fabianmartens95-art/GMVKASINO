# Staging and promotion gate

GMVKASINO uses staging as a separate validation environment before a primary hosted-demo promotion. Staging must not share its PostgreSQL database, persistent volume or mutable runtime state with the primary demo.

## Required external setup

Create a distinct Railway staging environment/service with its own PostgreSQL database. The application configuration must use the staging database connection string only.

Create a GitHub Environment named `staging` and add:

- `STAGING_BASE_URL` — required HTTPS URL for the deployed staging application
- `PRIMARY_BASE_URL` — recommended; used only to reject an accidental identical staging/primary target

Do not store either URL in source when the deployment address is intended to remain environment-specific. Database credentials remain only in Railway/GitHub secret mechanisms and are never passed to the staging smoke workflow.

The GitHub workflow can verify that staging and primary URLs differ, but GitHub code alone cannot prove that Railway has isolated the databases. Database isolation must be checked in Railway before this gate is considered fully operational.

## Exact deployed-revision contract

A successful remote smoke test is not sufficient evidence that staging contains the revision being reviewed. Railway automatically injects `RAILWAY_GIT_COMMIT_SHA` for GitHub-triggered deployments. GMVKASINO validates that value at server startup and exposes it as the non-secret `revision` field on both `/api/v1/health/live` and `/api/v1/health/ready`.

For non-Railway deployments, `APP_REVISION` can provide the same hexadecimal Git revision explicitly. When both variables exist, Railway's deployment SHA is authoritative.

The staging verification workflow sends the current GitHub `GITHUB_SHA` as `EXPECTED_REVISION` and requires `/api/v1/health/live` to return an exact 40-character SHA match. A stale deployment, wrong branch, missing revision or non-GMVKASINO target therefore fails verification before the normal smoke test runs.

The revision is safe operational metadata; health responses never expose database URLs, bearer tokens or credentials.

## Verification workflow

Run `.github/workflows/staging-verify.yml` with `workflow_dispatch` against the revision intended for promotion.

The workflow:

1. checks out the exact workflow revision,
2. installs the committed dependency graph with `npm ci`,
3. requires a valid HTTPS deployment origin in `STAGING_BASE_URL`,
4. rejects embedded credentials, URL paths, query strings and fragments,
5. rejects the same normalized origin as `PRIMARY_BASE_URL` when configured,
6. calls staging liveness and requires `revision === GITHUB_SHA`,
7. runs the existing remote `npm run smoke` against staging,
8. records the tested commit SHA, exact-revision match and result in the GitHub Actions step summary.

The workflow performs verification only. It does not deploy or promote automatically.

## Promotion eligibility

A revision is eligible for promotion only when:

- normal CI is green for that revision,
- required PostgreSQL migrations are already validated,
- the staging environment is known to use isolated persistence,
- the deployed health revision exactly matches the revision being promoted,
- Staging Verification passes for that exact revision,
- there is no unresolved P0 operational blocker,
- any migration-specific backup/recovery requirements are satisfied.

Promotion remains an explicit deployment decision. Passing staging does not trigger automatic primary deployment.

## Post-promotion verification

After promotion to the primary hosted demo:

1. confirm `/api/v1/health/live`,
2. confirm `/api/v1/health/ready`,
3. confirm the exposed `revision` is the intended promoted commit,
4. run `SMOKE_BASE_URL=<primary-url> npm run smoke` from a trusted operator environment or equivalent deployment check,
5. inspect protected metrics for abnormal 5xx/latency changes,
6. roll back if readiness/smoke/revision validation fails or a material regression is observed.

## Rollback trigger

Rollback to the previous known-good application revision when the promoted revision causes any of the following and cannot be corrected safely in place:

- readiness remains failed,
- deployed revision is not the intended commit,
- remote smoke fails,
- sustained new 5xx failures appear,
- a migration/application compatibility issue is detected,
- data integrity is in doubt.

Application rollback does not automatically roll back database state. Follow `DATABASE_RECOVERY.md` for database recovery and `DATABASE_MIGRATIONS.md` for schema compatibility rules.

## Evidence

A staging-verification run should preserve only non-secret operational evidence:

- commit SHA,
- exact deployed-revision match,
- GitHub Actions run result,
- verification timestamp,
- staging environment name,
- pass/fail outcome.

Do not record database URLs, session bearer tokens, player names, `METRICS_TOKEN` or other credentials in workflow summaries/issues.

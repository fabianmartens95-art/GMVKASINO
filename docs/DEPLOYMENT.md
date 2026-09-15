# GMVKASINO Demo Deployment

This document applies only to the non-monetary GMVKASINO demo. It does not make the project suitable for real-money gambling.

## Deployment contract

The current deployment expects:

- repository-root `Dockerfile`
- Node.js 22 runtime
- `GET /api/v1/health/live` for process liveness
- `GET /api/v1/health/ready` for persistence readiness and deployment health checks
- compatibility readiness aliases at `GET /api/v1/health` and `GET /api/v1/ready`
- `npm run smoke` for local or remote post-deploy verification
- PostgreSQL as the preferred persistent store when `DATABASE_URL` is configured
- JSON persistence only as a single-instance fallback
- versioned PostgreSQL schema migrations under `server/migrations/`
- backup/recovery procedures in [`DATABASE_RECOVERY.md`](DATABASE_RECOVERY.md)
- staging/promotion rules in [`STAGING.md`](STAGING.md)

## Pre-deploy gate

```bash
npm ci
npm audit --audit-level=high
npm test
npm run build
npm run smoke
docker build -t gmvkasino:local .
```

CI runs the same core gates and additionally executes PostgreSQL integration tests against an ephemeral PostgreSQL service.

Before a destructive, incompatible or data-transforming migration, the pre-migration backup checklist in `DATABASE_RECOVERY.md` is an additional mandatory gate.

## Staging and promotion gate

A revision is not eligible for primary hosted-demo promotion solely because normal CI is green. The target revision must also pass the manual `Staging Verification` workflow against an isolated staging deployment.

Required release sequence:

1. normal CI passes for the exact revision,
2. pending migrations are validated,
3. staging uses separate persistence from the primary demo,
4. `.github/workflows/staging-verify.yml` passes for the exact revision,
5. backup/recovery requirements for the change are satisfied,
6. promotion is performed as an explicit deployment decision,
7. liveness, readiness and remote smoke are re-verified on the primary deployment,
8. roll back to the previous known-good application revision on material regression.

The staging workflow never deploys or promotes automatically. Environment-specific URLs are supplied through the GitHub Environment named `staging`; source control must not contain staging or primary credentials.

The complete setup, verification evidence, promotion criteria and rollback triggers are documented in [`STAGING.md`](STAGING.md).

## PostgreSQL deployment

Configure at minimum:

```text
DATABASE_URL=<postgres connection string>
DATABASE_SSL=true|false
DEMO_SESSION_IDLE_TTL_MS=86400000
DEMO_SESSION_ABSOLUTE_TTL_MS=604800000
SPIN_RATE_LIMIT_WINDOW_MS=10000
SPIN_RATE_LIMIT_MAX=15
MAX_JSON_BODY_BYTES=16384
AUDIT_MAX_EVENTS=1000
```

If the database uses a private CA, provide `DATABASE_SSL_CA`. When `DATABASE_SSL=true`, certificate verification remains enabled.

Before a controlled application rollout, apply pending migrations explicitly:

```bash
DATABASE_URL=<postgres connection string> npm run db:migrate
```

The application startup path also invokes the same migration runner before serving traffic, so migrations remain idempotent across repeated starts. Applied migration names are recorded in `schema_migrations`, and migration execution is protected by a PostgreSQL advisory lock.

Migration authoring, compatibility and rollback rules are documented in [`DATABASE_MIGRATIONS.md`](DATABASE_MIGRATIONS.md). Backup ownership, retention, restore drills and incident recovery are documented in [`DATABASE_RECOVERY.md`](DATABASE_RECOVERY.md).

## JSON fallback

Without `DATABASE_URL`, the server uses `DEMO_SESSION_STORE_PATH`, defaulting to `.data/demo-sessions.json`.

For a hosted JSON-backed demo, mount persistent storage and use an absolute path. Keep exactly one application replica. Do not horizontally scale the JSON-backed mode.

## Health and verification

Liveness answers whether the Node process and HTTP server are alive. It intentionally does not depend on persistence:

```text
GET /api/v1/health/live
```

Readiness answers whether the active persistence backend is usable:

```text
GET /api/v1/health/ready
```

The compatibility endpoints `GET /api/v1/health` and `GET /api/v1/ready` currently use the same readiness semantics. New deployment configuration should use the explicit `/health/ready` path.

A service can therefore be live but not ready. In that state, inspect PostgreSQL or JSON persistence availability before assuming that a process restart is the correct recovery action.

Remote smoke check after deployment:

```bash
SMOKE_BASE_URL=https://<deployment-domain> npm run smoke
```

The smoke check requires liveness, persistence readiness and the built frontend shell to respond successfully.

## Rollback

If a deployment fails liveness, readiness, tests or the remote smoke check, do not promote it. Roll back to the most recent known-good image/revision, verify `/api/v1/health/live` and `/api/v1/health/ready`, then rerun the remote smoke check.

Application rollback does not automatically roll back PostgreSQL data. Do not delete `schema_migrations` rows or reverse migration SQL ad hoc. Prefer additive/backward-compatible migrations; follow [`DATABASE_RECOVERY.md`](DATABASE_RECOVERY.md) for restore/cutover procedures and any future incompatible change.

## Secrets

Do not commit database URLs, CA material, tokens or deployment credentials. Inject them through the hosting platform's secret/environment-variable mechanism. Never place bearer session tokens or secrets in URLs, frontend code, Docker build arguments, logs or documentation.

## Exit criteria before higher-risk operation

A separate architecture and legal/compliance decision is required before introducing production user identity tied to money, financial ledgers, deposits, withdrawals, real-money wagering, production KYC/AML or multi-region operation.

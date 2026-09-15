# GMVKASINO Demo Deployment

This document applies only to the non-monetary GMVKASINO demo. It does not make the project suitable for real-money gambling.

## Deployment contract

The current M5 deployment expects:

- repository-root `Dockerfile`
- Node.js 22 runtime
- `GET /api/v1/health` for process liveness
- `GET /api/v1/ready` for storage readiness
- `npm run smoke` for local or remote post-deploy verification
- PostgreSQL as the preferred persistent store when `DATABASE_URL` is configured
- JSON persistence only as a single-instance fallback

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

The current PostgreSQL store creates its demo-session table and indexes during startup. M6 should replace runtime schema creation with explicit versioned migrations before staging is treated as release-grade.

## JSON fallback

Without `DATABASE_URL`, the server uses `DEMO_SESSION_STORE_PATH`, defaulting to `.data/demo-sessions.json`.

For a hosted JSON-backed demo, mount persistent storage and use an absolute path. Keep exactly one application replica. Do not horizontally scale the JSON-backed mode.

## Health and verification

Liveness:

```text
GET /api/v1/health
```

Readiness:

```text
GET /api/v1/ready
```

Remote smoke check after deployment:

```bash
SMOKE_BASE_URL=https://<deployment-domain> npm run smoke
```

The smoke check requires both the versioned health endpoint and the built frontend shell to respond successfully.

## Rollback

If a deployment fails health, readiness, tests or the remote smoke check, do not promote it. Roll back to the most recent known-good image/revision, verify `/api/v1/health` and `/api/v1/ready`, then rerun the remote smoke check.

Application rollback does not automatically roll back PostgreSQL data. Before future schema migrations, define backup, migration and rollback procedures explicitly.

## Secrets

Do not commit database URLs, CA material, tokens or deployment credentials. Inject them through the hosting platform's secret/environment-variable mechanism. Never place bearer session tokens or secrets in URLs, frontend code, Docker build arguments, logs or documentation.

## Exit criteria before higher-risk operation

A separate architecture and legal/compliance decision is required before introducing production user identity tied to money, financial ledgers, deposits, withdrawals, real-money wagering, production KYC/AML or multi-region operation.

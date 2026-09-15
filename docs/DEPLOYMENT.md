# GMVKASINO Demo Deployment — Railway

Railway is the supported deployment target for the current GMVKASINO demo. This document applies only to the non-monetary demo architecture. It does not make the project suitable for real-money gambling.

## Deployment contract

Preferred M5 deployment:

- source: GitHub `main`
- build/runtime: repository-root `Dockerfile`
- runtime: Node.js 20 container
- persistence: Railway PostgreSQL exposed to the app through `DATABASE_URL`
- migrations: `npm run db:migrate` / automatic startup migration
- liveness: `GET /api/v1/health/live`
- readiness/deployment healthcheck: `GET /api/v1/health/ready`
- compatibility alias: `GET /api/v1/health`
- post-deploy verification: `SMOKE_BASE_URL=https://<domain> npm run smoke`

The JSON repository remains available as a local/single-replica fallback. Do not horizontally scale the JSON-backed mode.

## PostgreSQL deployment

1. Create a Railway project and add the GMVKASINO GitHub service.
2. Add a PostgreSQL database in the same project.
3. Inject the database connection string into the application service as `DATABASE_URL` through Railway Variables.
4. Keep `DATABASE_URL` server-side only. Never expose it to frontend build variables, logs or source control.
5. Configure the application healthcheck path as `/api/v1/health/ready`.
6. Deploy. The application applies pending migrations before it starts listening.
7. Confirm both `/api/v1/health/live` and `/api/v1/health/ready`.
8. Run the remote smoke check:

```bash
SMOKE_BASE_URL=https://<railway-domain> npm run smoke
```

For controlled migration workflows, run the same committed image/code with `npm run db:migrate` before application rollout. Migrations are tracked in `schema_migrations` and protected by a PostgreSQL advisory lock.

## JSON fallback deployment

If PostgreSQL is intentionally not configured, the server uses the JSON repository.

For Railway JSON fallback:

- attach a persistent Volume at `/data`
- set `DEMO_SESSION_STORE_PATH=/data/demo-sessions.json`
- keep exactly one application replica

The JSON mode is transitional and should not be used for horizontal scaling.

## Runtime variables

Railway supplies `PORT`. The server defaults to `HOST=0.0.0.0`.

Recommended values:

```text
DATABASE_URL=<injected PostgreSQL connection string>
DEMO_SESSION_IDLE_TTL_MS=86400000
DEMO_SESSION_ABSOLUTE_TTL_MS=604800000
SPIN_RATE_LIMIT_WINDOW_MS=10000
SPIN_RATE_LIMIT_MAX=15
MAX_JSON_BODY_BYTES=16384
AUDIT_MAX_EVENTS=1000
```

`DEMO_STARTING_BALANCE` is optional. `DEMO_SESSION_STORE_PATH` matters only when `DATABASE_URL` is absent.

Malformed explicit numeric configuration fails startup instead of silently falling back.

## Persistence guarantees

### PostgreSQL

- schema changes are migration-driven
- session rows are durable across application restarts
- session rotation and invalidation persist centrally
- spin settlement uses a database transaction and a row lock
- balance and spin count update atomically
- concurrent settlements cannot overwrite each other or overdraw the same demo balance
- readiness uses `SELECT 1` and does not expose connection details

### JSON fallback

- single-process/single-replica only
- atomic file replacement for persisted state
- requires persistent runtime storage outside ephemeral container filesystems
- application rollback does not roll back persisted JSON data

## Health semantics

`GET /api/v1/health/live` checks only that the Node process/HTTP server is alive.

`GET /api/v1/health/ready` checks the configured persistence dependency. A PostgreSQL deployment is not ready when the database is unavailable; the response does not reveal the connection string or database error details.

`GET /api/v1/health` remains a backward-compatible readiness alias.

A service can therefore be live but not ready. Investigate the persistence dependency before assuming a process restart is the correct recovery action.

## Validation

Local JSON validation:

```bash
npm ci
npm test
npm run build
npm run smoke
docker build -t gmvkasino:local .
```

PostgreSQL validation requires a test database:

```bash
DATABASE_URL=postgresql://user:password@127.0.0.1:5432/gmvkasino npm run db:migrate
DATABASE_URL=postgresql://user:password@127.0.0.1:5432/gmvkasino npm test
```

GitHub CI provisions PostgreSQL, applies migrations, runs all tests including concurrency settlement coverage, builds the frontend, executes the production smoke check and validates the Docker image.

Remote verification:

```bash
SMOKE_BASE_URL=https://<railway-domain> npm run smoke
```

## Rollback procedure

If readiness fails during rollout, do not consider the release healthy.

For application rollback:

1. Select the most recent known-good application deployment.
2. Roll back/redeploy that application version.
3. Confirm liveness and readiness.
4. Run the remote smoke check.
5. Review logs and open a GitHub issue before retrying the failed release.

A code rollback is not automatically a database rollback. Before any incompatible schema change, define backward compatibility and recovery in the database runbook. Do not manually reverse a migration unless the migration/recovery plan explicitly calls for it.

## Secrets

`DATABASE_URL` is a secret. Inject it through Railway Variables or the selected secret-management layer. Never place a real connection string in:

- `.env.example`
- GitHub source files
- Docker build arguments
- frontend code
- issue/PR text
- general logs
- analytics

## M5 recovery dependency

Before PostgreSQL becomes operationally critical, issue #19 defines the required backup, migration and recovery runbook. That runbook must specify backup ownership, retention, pre-migration backup rules and isolated restore verification.

## Scope boundary

PostgreSQL makes the demo persistence safer and horizontally shareable. It does **not** make this a production real-money gambling platform. Deposits, withdrawals, monetary wagering, production identity/KYC/AML, financial ledgering and regulated gaming controls remain out of scope and require a separate legal/compliance and architecture decision.

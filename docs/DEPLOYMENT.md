# GMVKASINO Demo Deployment — Railway

Railway is the supported deployment target for the current GMVKASINO demo. This document applies only to the non-monetary demo architecture. It does not make the project suitable for real-money gambling.

## Deployment contract

The supported deployment has these properties:

- source: GitHub `main` branch
- build/runtime: repository-root `Dockerfile`
- runtime: Node.js 20 container
- process: one web-service replica
- persistence: one Railway Volume mounted at `/data`
- demo session store: `/data/demo-sessions.json`
- liveness endpoint: `GET /api/v1/health/live`
- readiness/deployment healthcheck: `GET /api/v1/health/ready`
- compatibility health alias: `GET /api/v1/health` (same readiness semantics)
- post-deploy verification: `SMOKE_BASE_URL=https://<domain> npm run smoke`

Do not horizontally scale this JSON-backed version. The current repository layer is a transitional single-process persistence mechanism. Multi-replica deployment requires a real shared database adapter first.

## First deployment

1. Create a Railway project and add a service from the GMVKASINO GitHub repository.
2. Select the `main` branch. Railway should detect the root `Dockerfile` automatically.
3. Add a persistent Volume to the service and mount it at `/data`.
4. Set `DEMO_SESSION_STORE_PATH=/data/demo-sessions.json`.
5. Keep one service replica while the JSON repository is in use.
6. Generate a public domain for the service.
7. Configure the Railway deployment healthcheck path as `/api/v1/health/ready`.
8. Deploy and wait for the readiness healthcheck to succeed.
9. From a trusted machine, run the remote smoke check:

```bash
SMOKE_BASE_URL=https://<railway-domain> npm run smoke
```

The smoke check requires liveness, persistence readiness and the built frontend shell to respond successfully.

## Runtime variables

Railway supplies `PORT` to the running service. The application defaults to `HOST=0.0.0.0` and reads the injected port.

Recommended explicit variables for the demo:

```text
DEMO_SESSION_STORE_PATH=/data/demo-sessions.json
DEMO_SESSION_IDLE_TTL_MS=86400000
DEMO_SESSION_ABSOLUTE_TTL_MS=604800000
SPIN_RATE_LIMIT_WINDOW_MS=10000
SPIN_RATE_LIMIT_MAX=15
MAX_JSON_BODY_BYTES=16384
AUDIT_MAX_EVENTS=1000
```

`DEMO_STARTING_BALANCE` may be set if a different demo-credit starting balance is needed.

The server validates configured numeric values at startup and exits on malformed values rather than silently replacing them with defaults.

## Persistence and volume rules

- The Railway Volume is runtime storage. It is not available during the Docker image build.
- Never commit `.data`, `.env`, tokens, or Railway secrets to GitHub.
- Mount the volume at `/data` and use the absolute session-store path above.
- Keep one replica until the JSON repository is replaced by a database.
- A code rollback does not roll back the contents of the mounted volume.
- Before any future persistence-schema migration, take a volume backup and define a migration/rollback procedure first.

Because an attached volume cannot be mounted by old and new deployments simultaneously, redeploys can involve a short service interruption. Do not describe this demo deployment as zero-downtime.

## Health semantics

`GET /api/v1/health/live` answers whether the Node process and HTTP server are alive. It intentionally does not depend on the persistence layer.

`GET /api/v1/health/ready` answers whether the service can safely serve requests that depend on persistence. The current JSON adapter checks that its existing state is readable and structurally valid and that the backing location is writable. It does not create or modify player state during the readiness probe.

The compatibility endpoint `GET /api/v1/health` currently has the same readiness semantics. New deployment configuration should use the explicit `/health/ready` path.

A service can therefore be **live but not ready**. In that condition, restart loops are not automatically assumed to be the right recovery action; inspect persistence/volume availability first.

## Health and verification

Local production-style validation:

```bash
npm ci
npm test
npm run build
npm run smoke
docker build -t gmvkasino:local .
```

Remote validation after a Railway deployment:

```bash
SMOKE_BASE_URL=https://<railway-domain> npm run smoke
```

Expected liveness payload characteristics:

- HTTP 2xx
- `ok: true`
- `status: "live"`
- `mode: "demo"`
- `apiVersion: "v1"`

Expected readiness payload characteristics:

- HTTP 2xx when ready, HTTP 503 when not ready
- `ok: true` and `status: "ready"` when persistence is available
- `ok: false` and `status: "not_ready"` when persistence is unavailable/corrupt
- no connection strings, file contents or secret values in the response

The frontend root `/` must return the built HTML application shell.

## Rollback procedure

If a deployment fails the Railway readiness healthcheck, do not promote it.

If a bad deployment is already active:

1. Open the service deployment history.
2. Select the most recent known-good deployment.
3. Use Railway's rollback action.
4. Confirm `/api/v1/health/live` and `/api/v1/health/ready`.
5. Run the remote smoke check against the public domain.
6. Review logs and open a GitHub issue describing the failed deployment before retrying.

Remember that the persistent Volume remains current during an application rollback. If a future release changes persisted data, application rollback alone may be insufficient.

## Secrets

No secrets are required by the current demo server. If secrets are introduced later, inject them through Railway Variables or the selected secret-management layer. Do not place secret values in `.env.example`, GitHub, Docker build arguments, frontend code, logs, or documentation.

## Exit criteria for this deployment model

Move away from the single-replica JSON deployment before any of the following:

- multi-replica or multi-region scaling
- production user accounts
- financial ledger or money movement
- deposits or withdrawals
- real-money wagering
- production KYC/AML controls

Those changes require a database-backed architecture and a separate legal/compliance decision.

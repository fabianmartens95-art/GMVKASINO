# Database backup and recovery runbook

This runbook defines the required PostgreSQL recovery posture for the non-monetary GMVKASINO demo. It is an operational contract, not evidence that every provider-side backup switch is already enabled. Verify the Railway project configuration before treating an environment as release-grade.

## Ownership and recovery targets

Until a dedicated operations/on-call role exists, the service operator is the backup owner. The owner is responsible for confirming schedules, recording restore drills and approving destructive database recovery actions.

Current demo targets:

- maximum recovery point objective (RPO): 24 hours for ordinary incidents
- target recovery time objective (RTO): 4 hours for the demo
- pre-migration recovery point: immediately before any migration that could affect existing data

If the demo becomes business-critical, these targets must be reviewed rather than silently treated as production SLOs.

## Required backup layers

Use independent layers so one failure mode does not remove every recovery path.

### 1. Railway scheduled volume backups

For the Railway PostgreSQL volume, enable all supported recurring schedules:

- daily backups — Railway currently retains them for 6 days
- weekly backups — Railway currently retains them for 27 days
- monthly backups — Railway currently retains them for 89 days

Also take a manual provider backup before a high-risk migration or data repair when practical.

Provider retention/settings can change. Recheck the Railway Backups page and current documentation during quarterly recovery review.

### 2. Point-in-time recovery (PITR)

Enable Railway PITR for the PostgreSQL service before the hosted demo is treated as release-grade. PITR is the preferred recovery path for a bad migration or accidental destructive query when the exact incident time is known.

Railway currently documents a restore window of roughly four weeks once PITR has established its base backups. PITR restores to a separate sibling PostgreSQL service, allowing validation before cutover.

### 3. Portable logical dumps

Take a provider-independent custom-format `pg_dump` at least weekly and before any potentially incompatible migration.

Required retention for GMVKASINO logical dumps:

- weekly dumps: 8 weeks
- pre-migration dumps: 30 days minimum, or until the migration is proven stable and the next verified recovery point exists

Store logical dumps outside the application repository and outside the same single failure boundary as the source database. Use encrypted access-controlled storage. Do not attach dumps to GitHub issues, PRs or chat messages.

Example from a trusted operator environment with PostgreSQL client tools installed:

```bash
STAMP=$(date -u +%Y%m%d-%H%M%S)
pg_dump "$DATABASE_URL" \
  --format=custom \
  --no-owner \
  --file="gmvkasino-${STAMP}.dump"
```

Never print the connection string into logs or shell history intentionally. Prefer a secure environment variable or provider tunnel rather than embedding credentials in commands/scripts.

## Mandatory pre-migration checklist

Before an incompatible, destructive or data-transforming migration:

1. Confirm current `/api/v1/health/ready` is healthy.
2. Confirm a recent scheduled/PITR recovery point exists.
3. Create a fresh logical dump or manual provider backup immediately before the migration.
4. Record the backup timestamp and migration commit SHA in the deployment record; never record database credentials.
5. Verify the application version being deployed remains compatible with the pre- and post-migration schema for the planned rollout window.
6. Run `npm run db:migrate` against staging/test first.
7. Run the normal test/build/smoke gates.
8. Only then apply the migration to the target hosted demo.

Purely additive migrations may have lower operational risk, but they still follow the versioned migration rules in `DATABASE_MIGRATIONS.md`.

## Forward migration and application rollback rules

Application rollback and database rollback are different operations.

Default rule: prefer forward-compatible, additive migrations so both the old and new application revisions can operate during the deployment window. If the new application must be rolled back, leave a compatible newer schema in place rather than manually undoing schema state.

Do not delete rows from `schema_migrations`, manually reverse SQL or restore an older database merely because the application was rolled back.

For a migration that cannot remain backward compatible, its pull request must include an explicit recovery plan before merge. That plan must identify the last compatible application revision and the exact backup/PITR point to restore if rollback is required.

## Restore verification drill

A backup is not considered verified until it has been restored successfully outside the active database.

Run a restore drill at least monthly while the hosted demo is actively maintained, and after materially changing backup/storage configuration.

Use an isolated scratch database/service. Never overwrite the active source database for a drill.

Example logical restore:

```bash
pg_restore \
  --dbname="$RESTORE_DATABASE_URL" \
  --no-owner \
  --exit-on-error \
  gmvkasino-YYYYMMDD-HHMMSS.dump
```

Verification checklist:

1. Run the committed migrations against the restored database; they should be idempotent/up-to-date.
2. Confirm expected tables and migration records exist.
3. Compare aggregate row counts for relevant demo tables with the recorded source snapshot where available.
4. Start a GMVKASINO instance pointed only at the isolated restored database.
5. Confirm liveness and readiness.
6. Run the remote/local smoke check against that isolated instance.
7. Record restore duration, backup age and pass/fail result.
8. Destroy the scratch environment after verification.

Do not copy player names, session bearer tokens, database URLs or other live secrets into test fixtures, GitHub issues, screenshots or recovery notes. Use aggregate counts and synthetic verification data.

## Database outage checklist

When the application is live but not ready:

1. Confirm `/api/v1/health/live` and `/api/v1/health/ready` separately.
2. Check the protected metrics surface for request `5xx`/latency changes without exposing secrets.
3. Inspect PostgreSQL service health, deployment events and connectivity.
4. Do not repeatedly restart a healthy application process when the dependency is the failing component.
5. If the database service recovers, verify readiness and run the smoke check.
6. If recovery requires a restore, prefer a new restored service/fork where possible, validate it, then change the application connection after approval.
7. Record incident time, suspected start time, selected recovery point and validation result.

## Suspected corruption or destructive data change

If data corruption, accidental deletion or a bad migration is suspected:

1. Stop further destructive maintenance/migrations.
2. Record the approximate last-known-good timestamp.
3. Preserve the current source; do not run ad-hoc repair commands first.
4. Prefer PITR to a separate restored service when an incident timestamp is known.
5. Otherwise restore a suitable provider backup or logical dump into an isolated target.
6. Validate schema, aggregate data and application smoke checks on the restored target.
7. Cut over only after validation.
8. Keep the old source available until the recovery is confirmed and the incident record is complete.

Avoid `pg_resetwal` or similar destructive recovery shortcuts when a valid backup/PITR path exists. Such tools can cause data loss and belong only in an exceptional, explicitly reviewed recovery procedure.

## Backup loss and deletion hazards

Provider backups are not the only backup layer. A project/volume deletion or provider-level failure can invalidate same-provider recovery paths. The offsite logical dump is the portability layer for those cases.

Never store the only logical backup on the same database volume it protects.

## Quarterly recovery review

Once per quarter while the hosted demo is active, the backup owner should verify:

- scheduled Railway backup settings and actual recent backup timestamps
- PITR status and available recovery window
- existence and age of offsite logical dumps
- most recent restore-drill result
- current RPO/RTO suitability
- current migration/recovery docs still match the deployed architecture

Any failed/missing layer becomes a P0 operational task before a risky schema migration.

## Current Railway references

Operational details in this runbook were aligned with Railway's current backup/restore documentation on 2026-09-15. Recheck provider documentation before relying on retention windows or provider-specific restore behavior:

- Railway guide: Back Up and Restore Postgres
- Railway docs: Backups
- Railway docs: Point-in-Time Recovery

Provider documentation is authoritative for current platform behavior; this repository remains authoritative for GMVKASINO's required operating policy.

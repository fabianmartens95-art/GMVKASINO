# Database migrations

GMVKASINO uses ordered SQL migrations for PostgreSQL schema changes. Runtime code must not introduce new schema DDL outside this migration path.

## Layout

Migration files live in `server/migrations/` and use the format:

```text
NNN_descriptive_name.sql
```

Applied files are recorded in the `schema_migrations` table. `runMigrations()` takes a PostgreSQL advisory lock before checking/applying migrations so concurrent application starts cannot apply the same migration twice.

## Commands

Apply pending migrations explicitly:

```bash
DATABASE_URL=postgresql://... npm run db:migrate
```

The PostgreSQL session store also calls the same migration runner during initialization. Explicit migration execution is still preferred before a controlled deployment because it separates schema validation from application traffic.

## Baseline migration

`001_demo_sessions.sql` represents the schema already used by the M5 PostgreSQL session store. It uses `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS`, so an existing M5 database can adopt migration tracking without dropping or rewriting current demo sessions.

After the first migration run, `schema_migrations` records `001_demo_sessions.sql`; subsequent runs are idempotent.

## Rules for future migrations

- Never edit an already-applied migration after it has reached `main`.
- Add a new numbered migration for every schema change.
- Prefer additive/backward-compatible changes when application rollback may be required.
- Do not drop/rename columns in the same release that stops old application code from working unless the rollout plan explicitly handles the compatibility window.
- Take the required pre-migration backup once the database recovery runbook is in force.
- Keep secrets, connection strings and production data out of migration files and test fixtures.
- Migration SQL must be deterministic and safe to execute inside a transaction unless explicitly documented otherwise.

## CI contract

GitHub CI starts PostgreSQL, runs `npm run db:migrate`, then executes the test suite. Integration coverage verifies that migrations are tracked and a second migration pass applies nothing.

A change is not migration-complete until:

1. migration SQL exists,
2. `npm run db:migrate` succeeds against the CI PostgreSQL service,
3. integration tests pass,
4. application build/smoke/container gates pass,
5. deployment/recovery implications are documented.

## Rollback

Application rollback and database rollback are separate operations. Do not delete rows from `schema_migrations` or manually reverse SQL as an ad-hoc rollback mechanism.

For additive compatible migrations, roll the application back while leaving the newer schema in place. For an incompatible future migration, follow the database recovery runbook and the migration-specific rollback/restore plan.

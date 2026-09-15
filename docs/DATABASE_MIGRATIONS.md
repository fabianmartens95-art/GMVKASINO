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

## M6 balance-source migration

`002_accounts_ledger.sql` converts any pre-ledger PostgreSQL demo-session balance into account, wallet and balanced `INITIAL_CREDIT` ledger records. `003_account_auth.sql` adds account credentials/auth-session support.

`004_remove_session_balance.sql` is deliberately destructive at the schema level: it drops the legacy `demo_sessions.balance` compatibility mirror only after the ledger bootstrap migrations have run. From this point onward, `ledger_accounts` is the only PostgreSQL balance source and `PostgresSessionStore` hydrates session balance from the wallet.

Before applying `004` to a hosted database, create and verify a recovery point according to [`DATABASE_RECOVERY.md`](DATABASE_RECOVERY.md). Old application revisions that still read or write `demo_sessions.balance` are not compatible with the post-`004` schema. Therefore an application rollback to pre-`004` code also requires an explicit schema/data recovery plan rather than a code-only rollback.

## Rules for future migrations

- Never edit an already-applied migration after it has reached `main`.
- Add a new numbered migration for every schema change.
- Prefer additive/backward-compatible changes when application rollback may be required.
- Do not drop/rename columns in the same release that stops old application code from working unless the rollout plan explicitly handles the compatibility window.
- Follow the mandatory pre-migration backup checklist in [`DATABASE_RECOVERY.md`](DATABASE_RECOVERY.md) for incompatible, destructive or data-transforming changes.
- Keep secrets, connection strings and production data out of migration files and test fixtures.
- Migration SQL must be deterministic and safe to execute inside a transaction unless explicitly documented otherwise.

## CI contract

GitHub CI starts PostgreSQL, runs `npm run db:migrate`, then executes the test suite. Integration coverage verifies that migrations are tracked, `demo_sessions.balance` is absent after `004`, and a second migration pass applies nothing.

A change is not migration-complete until:

1. migration SQL exists,
2. `npm run db:migrate` succeeds against the CI PostgreSQL service,
3. integration tests pass,
4. application build/smoke/container gates pass,
5. deployment/recovery implications are documented,
6. any required pre-migration recovery point is confirmed before hosted rollout.

## Rollback

Application rollback and database rollback are separate operations. Do not delete rows from `schema_migrations` or manually reverse SQL as an ad-hoc rollback mechanism.

For additive compatible migrations, roll the application back while leaving the newer schema in place. For incompatible migrations such as `004_remove_session_balance.sql`, follow [`DATABASE_RECOVERY.md`](DATABASE_RECOVERY.md) and the migration-specific rollback/restore plan. The recovery runbook requires restoring into an isolated target and validating it before cutover rather than overwriting the active database during a drill.

import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations')
const MIGRATION_LOCK_KEY = 714205

export async function runMigrations({ pool, migrationsDir = DEFAULT_MIGRATIONS_DIR } = {}) {
  if (!pool) throw new Error('pool is required')
  const client = await pool.connect()

  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY])
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)

    const files = (await readdir(migrationsDir))
      .filter((name) => /^\d+_.+\.sql$/.test(name))
      .sort()

    const appliedResult = await client.query('SELECT name FROM schema_migrations')
    const applied = new Set(appliedResult.rows.map((row) => row.name))
    const newlyApplied = []

    for (const name of files) {
      if (applied.has(name)) continue
      const sql = await readFile(join(migrationsDir, name), 'utf8')

      await client.query('BEGIN')
      try {
        await client.query(sql)
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name])
        await client.query('COMMIT')
        newlyApplied.push(name)
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      }
    }

    return newlyApplied
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]).catch(() => {})
    client.release()
  }
}

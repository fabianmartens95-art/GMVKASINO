import test from 'node:test'
import assert from 'node:assert/strict'
import pg from 'pg'
import { runMigrations } from '../server/migrations.js'

const { Pool } = pg
const databaseUrl = process.env.TEST_DATABASE_URL || ''

function integrationTest(name, fn) {
  test(name, { skip: !databaseUrl }, fn)
}

integrationTest('database migrations are tracked and idempotent', async () => {
  const pool = new Pool({ connectionString: databaseUrl })

  try {
    await runMigrations({ pool })
    const secondPass = await runMigrations({ pool })
    assert.deepEqual(secondPass, [])

    const result = await pool.query(
      `SELECT name
       FROM schema_migrations
       WHERE name IN (
         '001_demo_sessions.sql',
         '002_accounts_ledger.sql',
         '003_account_auth.sql',
         '004_remove_session_balance.sql'
       )
       ORDER BY name`,
    )
    assert.deepEqual(
      result.rows.map((row) => row.name),
      [
        '001_demo_sessions.sql',
        '002_accounts_ledger.sql',
        '003_account_auth.sql',
        '004_remove_session_balance.sql',
      ],
    )

    const legacyBalanceColumn = await pool.query(
      `SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'demo_sessions'
         AND column_name = 'balance'`,
    )
    assert.equal(legacyBalanceColumn.rowCount, 0)
  } finally {
    await pool.end()
  }
})

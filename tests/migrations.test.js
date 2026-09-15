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
      "SELECT name FROM schema_migrations WHERE name = '001_demo_sessions.sql'",
    )
    assert.equal(result.rows.length, 1)
  } finally {
    await pool.end()
  }
})

import test from 'node:test'
import assert from 'node:assert/strict'
import pg from 'pg'
import { PostgresSessionStore } from '../server/postgresSessionStore.js'

const { Pool } = pg
const databaseUrl = process.env.TEST_DATABASE_URL || ''

function integrationTest(name, fn) {
  test(name, { skip: !databaseUrl }, fn)
}

integrationTest('PostgreSQL sessions persist and settle demo balance atomically', async () => {
  const pool = new Pool({ connectionString: databaseUrl })
  const store = new PostgresSessionStore({ pool, startingBalance: 1000 })

  try {
    await store.init()
    await pool.query('TRUNCATE TABLE demo_sessions')

    const session = await store.create({ player: 'DB QA' })
    const settled = await store.applySpin(session.id, { bet: 25, payout: 7 })
    const restored = await store.get(session.id)

    assert.equal(settled.balance, 982)
    assert.equal(settled.spins, 1)
    assert.equal(restored.player, 'DB QA')
    assert.equal(restored.balance, 982)
  } finally {
    await pool.query('TRUNCATE TABLE demo_sessions').catch(() => {})
    await pool.end()
  }
})

integrationTest('PostgreSQL conditional settlement prevents concurrent overspend', async () => {
  const pool = new Pool({ connectionString: databaseUrl })
  const store = new PostgresSessionStore({ pool, startingBalance: 1 })

  try {
    await store.init()
    await pool.query('TRUNCATE TABLE demo_sessions')
    const session = await store.create()

    const settlements = await Promise.all([
      store.applySpin(session.id, { bet: 1, payout: 0 }),
      store.applySpin(session.id, { bet: 1, payout: 0 }),
    ])

    assert.equal(settlements.filter(Boolean).length, 1)
    const final = await store.get(session.id)
    assert.equal(final.balance, 0)
    assert.equal(final.spins, 1)
  } finally {
    await pool.query('TRUNCATE TABLE demo_sessions').catch(() => {})
    await pool.end()
  }
})

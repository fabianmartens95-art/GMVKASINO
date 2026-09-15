import test from 'node:test'
import assert from 'node:assert/strict'
import pg from 'pg'
import { PostgresSessionStore } from '../server/postgresSessionStore.js'
import { OperationalMetrics } from '../server/operationalMetrics.js'

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

integrationTest('PostgreSQL rotation invalidates the old token and explicit invalidation removes the replacement', async () => {
  const pool = new Pool({ connectionString: databaseUrl })
  const store = new PostgresSessionStore({ pool, startingBalance: 1000 })

  try {
    await store.init()
    await pool.query('TRUNCATE TABLE demo_sessions')
    const session = await store.create({ player: 'Rotate DB QA' })
    await store.applySpin(session.id, { bet: 10, payout: 4 })

    const rotated = await store.rotate(session.id)
    assert.notEqual(rotated.id, session.id)
    assert.equal(rotated.balance, 994)
    assert.equal(rotated.createdAt, session.createdAt)
    assert.equal(await store.get(session.id), null)
    assert.equal((await store.get(rotated.id)).balance, 994)

    assert.equal(await store.invalidate(rotated.id), true)
    assert.equal(await store.invalidate(rotated.id), false)
    assert.equal(await store.get(rotated.id), null)
  } finally {
    await pool.query('TRUNCATE TABLE demo_sessions').catch(() => {})
    await pool.end()
  }
})

integrationTest('PostgreSQL activity extends idle expiry but not absolute expiry and records expiry', async () => {
  const pool = new Pool({ connectionString: databaseUrl })
  let now = 1_000
  const metrics = new OperationalMetrics({ now: () => now })
  const store = new PostgresSessionStore({
    pool,
    idleTtlMs: 100,
    absoluteTtlMs: 150,
    now: () => now,
    metrics,
  })

  try {
    await store.init()
    await pool.query('TRUNCATE TABLE demo_sessions')
    const session = await store.create()

    now = 1_050
    assert.equal((await store.get(session.id))?.id, session.id)

    now = 1_120
    assert.equal((await store.get(session.id))?.id, session.id)

    now = 1_151
    assert.equal(await store.get(session.id), null)
    assert.equal(metrics.snapshot().events['session.expired'], 1)
  } finally {
    await pool.query('TRUNCATE TABLE demo_sessions').catch(() => {})
    await pool.end()
  }
})

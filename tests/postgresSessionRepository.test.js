import test, { before, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { createPostgresPool, PostgresSessionRepository } from '../server/postgresSessionRepository.js'
import { runMigrations } from '../server/migrations.js'

const connectionString = process.env.DATABASE_URL?.trim()
const integration = connectionString ? test : test.skip
let pool

before(async () => {
  if (!connectionString) return
  pool = createPostgresPool({ connectionString, max: 12 })
  await runMigrations({ pool })
})

beforeEach(async () => {
  if (!pool) return
  await pool.query('TRUNCATE TABLE demo_sessions')
})

after(async () => {
  await pool?.end()
})

integration('PostgreSQL migrations are idempotent and readiness succeeds', async () => {
  const secondPass = await runMigrations({ pool })
  assert.deepEqual(secondPass, [])

  const repository = new PostgresSessionRepository({ pool })
  assert.deepEqual(await repository.checkReadiness(), { ok: true, backend: 'postgres' })
})

integration('demo sessions survive repository recreation with lifecycle semantics intact', async () => {
  let now = 1_000
  const firstRepository = new PostgresSessionRepository({
    pool,
    startingBalance: 1000,
    idleTtlMs: 100,
    absoluteTtlMs: 500,
    now: () => now,
  })

  const created = await firstRepository.create({ player: 'Postgres QA' })
  const settlement = await firstRepository.settleSpin(created.id, { bet: 25, payout: 7 })
  assert.equal(settlement.status, 'ok')
  assert.equal(settlement.session.balance, 982)
  assert.equal(settlement.session.spins, 1)

  now = 1_050
  const restartedRepository = new PostgresSessionRepository({
    pool,
    startingBalance: 1000,
    idleTtlMs: 100,
    absoluteTtlMs: 500,
    now: () => now,
  })
  const resumed = await restartedRepository.get(created.id)
  assert.equal(resumed.player, 'Postgres QA')
  assert.equal(resumed.balance, 982)
  assert.equal(resumed.spins, 1)

  const rotated = await restartedRepository.rotate(created.id)
  assert.ok(rotated)
  assert.notEqual(rotated.id, created.id)
  assert.equal(await restartedRepository.get(created.id), null)
  assert.equal((await restartedRepository.get(rotated.id)).balance, 982)

  assert.equal(await restartedRepository.invalidate(rotated.id), true)
  assert.equal(await restartedRepository.get(rotated.id), null)
})

integration('expired PostgreSQL sessions are rejected and pruned', async () => {
  let now = 10_000
  const repository = new PostgresSessionRepository({
    pool,
    idleTtlMs: 100,
    absoluteTtlMs: 1_000,
    now: () => now,
  })
  const created = await repository.create()

  now = 10_101
  assert.equal(await repository.get(created.id), null)
  const count = await pool.query('SELECT COUNT(*)::int AS count FROM demo_sessions WHERE id = $1', [created.id])
  assert.equal(count.rows[0].count, 0)
})

integration('concurrent spin settlement is serialized without lost updates', async () => {
  const repository = new PostgresSessionRepository({
    pool,
    startingBalance: 10,
    idleTtlMs: 60_000,
    absoluteTtlMs: 60_000,
  })
  const created = await repository.create({ player: 'Concurrency QA' })

  const results = await Promise.all(
    Array.from({ length: 8 }, () => repository.settleSpin(created.id, { bet: 1, payout: 0 })),
  )

  assert.equal(results.filter((result) => result.status === 'ok').length, 8)
  const finalSession = await repository.get(created.id)
  assert.equal(finalSession.balance, 2)
  assert.equal(finalSession.spins, 8)
})

integration('concurrent settlements cannot overdraw a demo balance', async () => {
  const repository = new PostgresSessionRepository({
    pool,
    startingBalance: 1,
    idleTtlMs: 60_000,
    absoluteTtlMs: 60_000,
  })
  const created = await repository.create()

  const results = await Promise.all([
    repository.settleSpin(created.id, { bet: 1, payout: 0 }),
    repository.settleSpin(created.id, { bet: 1, payout: 0 }),
  ])

  assert.equal(results.filter((result) => result.status === 'ok').length, 1)
  assert.equal(results.filter((result) => result.status === 'insufficient').length, 1)
  const finalSession = await repository.get(created.id)
  assert.equal(finalSession.balance, 0)
  assert.equal(finalSession.spins, 1)
})

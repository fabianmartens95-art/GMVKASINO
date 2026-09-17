import test from 'node:test'
import assert from 'node:assert/strict'
import pg from 'pg'
import { PostgresSessionStore } from '../server/postgresSessionStore.js'
import { PostgresGameRoundStore } from '../server/postgresGameRoundStore.js'
import { createGameRoundFingerprint } from '../server/gameRound.js'

const { Pool } = pg
const databaseUrl = process.env.TEST_DATABASE_URL || ''

function integrationTest(name, fn) {
  test(name, { skip: !databaseUrl }, fn)
}

integrationTest('PostgreSQL concurrent retries resolve RNG and ledger settlement exactly once', async () => {
  const pool = new Pool({ connectionString: databaseUrl })
  const sessionStore = new PostgresSessionStore({ pool, startingBalance: 1000 })
  const roundStore = new PostgresGameRoundStore({ sessionStore })

  try {
    await sessionStore.init()
    const session = await sessionStore.create({ player: 'Round QA' })
    const idempotencyKey = `round-concurrent-${session.id}`
    const context = createGameRoundFingerprint({
      accountId: session.accountId,
      sessionId: session.id,
      gameId: 'golden-vault',
      bet: 1,
      assetCode: 'DEMO',
      decimals: 2,
    })
    let prepareCalls = 0
    let resolveCalls = 0

    const execute = (requestId) => roundStore.executeGameRound(session.id, {
      bet: 1,
      betAtomic: context.betAtomic,
      gameId: 'golden-vault',
      assetCode: 'DEMO',
      idempotencyKey,
      fingerprint: context.fingerprint,
      sessionRef: context.sessionRef,
      requestId,
    }, async () => {
      prepareCalls += 1
      return {
        resolve: async () => {
          resolveCalls += 1
          return {
            reels: [['G', 'G', 'G'], ['G', 'G', 'G'], ['G', 'G', 'G']],
            wins: [],
            totalWin: 0,
          }
        },
      }
    })

    const [first, second] = await Promise.all([
      execute('round-request-0001'),
      execute('round-request-0002'),
    ])

    const resolved = [first, second].find((result) => result.replayed === false)
    const replayed = [first, second].find((result) => result.replayed === true)
    assert.ok(resolved)
    assert.ok(replayed)
    assert.deepEqual(replayed.response, resolved.response)
    assert.equal(prepareCalls, 1)
    assert.equal(resolveCalls, 1)

    const current = await sessionStore.get(session.id)
    assert.equal(current.spins, 1)
    assert.equal(current.balance, 999)

    const rounds = await pool.query(
      `SELECT id, status, request_fingerprint, response
       FROM game_rounds
       WHERE account_id = $1 AND idempotency_key = $2`,
      [session.accountId, idempotencyKey],
    )
    assert.equal(rounds.rowCount, 1)
    assert.equal(rounds.rows[0].status, 'SETTLED')
    assert.equal(rounds.rows[0].request_fingerprint, context.fingerprint)
    assert.equal(rounds.rows[0].response.roundId, resolved.response.roundId)

    const settlements = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM ledger_transactions
       WHERE reference_type = 'spin' AND reference_id = $1`,
      [resolved.response.roundId],
    )
    assert.equal(settlements.rows[0].count, 1)
  } finally {
    await pool.end()
  }
})

integrationTest('PostgreSQL rejects an idempotency key reused with a different fingerprint', async () => {
  const pool = new Pool({ connectionString: databaseUrl })
  const sessionStore = new PostgresSessionStore({ pool, startingBalance: 1000 })
  const roundStore = new PostgresGameRoundStore({ sessionStore })

  try {
    await sessionStore.init()
    const session = await sessionStore.create({ player: 'Conflict QA' })
    const idempotencyKey = `round-conflict-${session.id}`
    const firstContext = createGameRoundFingerprint({
      accountId: session.accountId,
      sessionId: session.id,
      gameId: 'golden-vault',
      bet: 1,
      assetCode: 'DEMO',
      decimals: 2,
    })
    const secondContext = createGameRoundFingerprint({
      accountId: session.accountId,
      sessionId: session.id,
      gameId: 'golden-vault',
      bet: 2,
      assetCode: 'DEMO',
      decimals: 2,
    })

    const first = await roundStore.executeGameRound(session.id, {
      bet: 1,
      betAtomic: firstContext.betAtomic,
      gameId: 'golden-vault',
      assetCode: 'DEMO',
      idempotencyKey,
      fingerprint: firstContext.fingerprint,
      sessionRef: firstContext.sessionRef,
      requestId: 'conflict-request-0001',
    }, async () => ({ resolve: async () => ({ reels: [], wins: [], totalWin: 0 }) }))

    const conflict = await roundStore.executeGameRound(session.id, {
      bet: 2,
      betAtomic: secondContext.betAtomic,
      gameId: 'golden-vault',
      assetCode: 'DEMO',
      idempotencyKey,
      fingerprint: secondContext.fingerprint,
      sessionRef: secondContext.sessionRef,
      requestId: 'conflict-request-0002',
    }, async () => {
      throw new Error('prepareResult must not run for an idempotency conflict')
    })

    assert.equal(conflict.conflict, true)
    assert.equal(conflict.roundId, first.response.roundId)

    const current = await sessionStore.get(session.id)
    assert.equal(current.spins, 1)
    assert.equal(current.balance, 999)
  } finally {
    await pool.end()
  }
})

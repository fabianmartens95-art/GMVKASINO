import test from 'node:test'
import assert from 'node:assert/strict'
import pg from 'pg'
import { SessionStore } from '../server/sessionStore.js'
import { PostgresSessionStore } from '../server/postgresSessionStore.js'
import { SlidingWindowRateLimiter } from '../server/rateLimiter.js'
import { AuditLog } from '../server/auditLog.js'
import { CasinoService } from '../server/casinoService.js'

const { Pool } = pg
const databaseUrl = process.env.TEST_DATABASE_URL || ''

function integrationTest(name, fn) {
  test(name, { skip: !databaseUrl }, fn)
}

test('memory game round replay does not run RNG or settle twice', async () => {
  let rngCalls = 0
  const service = new CasinoService({
    sessionStore: new SessionStore({ startingBalance: 1000 }),
    rateLimiter: new SlidingWindowRateLimiter({ limit: 5, windowMs: 10_000 }),
    auditLog: new AuditLog({ sink: () => {} }),
    rng: () => {
      rngCalls += 1
      return 0
    },
  })
  const session = await service.openSession({ player: 'Replay QA' })
  const idempotencyKey = 'memory-round-0001'

  const first = await service.spin({
    sessionId: session.id,
    gameId: 'golden-vault',
    bet: 1,
    idempotencyKey,
    requestId: 'memory-request-01',
  })
  const callsAfterFirst = rngCalls

  const replay = await service.spin({
    sessionId: session.id,
    gameId: 'golden-vault',
    bet: 1,
    idempotencyKey,
    requestId: 'memory-request-02',
  })

  assert.deepEqual(replay, first)
  assert.equal(rngCalls, callsAfterFirst)
  const stored = await service.getSession(session.id)
  assert.equal(stored.spins, 1)
  assert.equal(stored.balance, 1049)

  await assert.rejects(
    service.spin({
      sessionId: session.id,
      gameId: 'golden-vault',
      bet: 2,
      idempotencyKey,
      requestId: 'memory-request-03',
    }),
    (error) => error.code === 'IDEMPOTENCY_CONFLICT' && error.status === 409,
  )
})

integrationTest('PostgreSQL concurrent duplicate round settles the ledger once and replays one result', async () => {
  const pool = new Pool({ connectionString: databaseUrl })
  const store = new PostgresSessionStore({ pool, startingBalance: 1000 })

  try {
    await store.init()
    const firstSession = await store.create({ player: 'Concurrent Replay QA' })
    const secondSession = await store.createForAccount(firstSession.accountId)
    const idempotencyKey = `pg-round-${firstSession.accountId}`
    const requestFingerprint = `fingerprint-${firstSession.accountId}`
    const firstSpinId = `round-a-${firstSession.id}`
    const secondSpinId = `round-b-${secondSession.id}`

    const firstResponse = {
      spinId: firstSpinId,
      gameId: 'golden-vault',
      bet: 1,
      grid: [],
      wins: [],
      totalWin: 0,
    }
    const secondResponse = {
      ...firstResponse,
      spinId: secondSpinId,
    }

    const results = await Promise.all([
      store.applySpin(firstSession.id, {
        bet: 1,
        payout: 0,
        spinId: firstSpinId,
        gameId: 'golden-vault',
        ownerId: firstSession.accountId,
        idempotencyKey,
        requestFingerprint,
        roundResponse: firstResponse,
        requestId: 'concurrent-request-a',
      }),
      store.applySpin(secondSession.id, {
        bet: 1,
        payout: 0,
        spinId: secondSpinId,
        gameId: 'golden-vault',
        ownerId: firstSession.accountId,
        idempotencyKey,
        requestFingerprint,
        roundResponse: secondResponse,
        requestId: 'concurrent-request-b',
      }),
    ])

    const roundRows = await pool.query(
      `SELECT id, response_json
       FROM game_rounds
       WHERE account_id = $1 AND idempotency_key = $2`,
      [firstSession.accountId, idempotencyKey],
    )
    assert.equal(roundRows.rowCount, 1)

    const settlementRows = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM ledger_transactions
       WHERE type = 'GAME_SETTLEMENT'
         AND reference_id IN ($1, $2)`,
      [firstSpinId, secondSpinId],
    )
    assert.equal(settlementRows.rows[0].count, 1)

    const wallet = await store.ledger.getWallet(pool, firstSession.accountId)
    assert.equal(wallet.balanceExact, '999.00')

    const accountSpins = await pool.query(
      `SELECT COALESCE(SUM(spins), 0)::int AS spins
       FROM demo_sessions
       WHERE account_id = $1`,
      [firstSession.accountId],
    )
    assert.equal(accountSpins.rows[0].spins, 1)

    assert.equal(results.filter((result) => result?.replayed).length, 1)
    assert.deepEqual(
      results.find((result) => result?.replayed).roundResponse,
      roundRows.rows[0].response_json,
    )
  } finally {
    await pool.end()
  }
})

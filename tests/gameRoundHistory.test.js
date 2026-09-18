import test from 'node:test'
import assert from 'node:assert/strict'
import { GameRoundHistory, GameRoundHistoryError } from '../server/gameRoundHistory.js'

test('game round history is account-scoped and sanitized', async () => {
  const queries = []
  const history = new GameRoundHistory({
    pool: {
      async query(sql, params) {
        queries.push({ sql, params })
        return {
          rows: [{
            id: 'round-1',
            game_id: 'golden-vault',
            bet_atomic: '250',
            payout_atomic: '500',
            status: 'settled',
            created_at: 1234,
          }],
        }
      },
    },
  })

  const rows = await history.list({ accountId: 'player-1', limit: 25 })
  assert.deepEqual(rows, [{
    roundId: 'round-1',
    gameId: 'golden-vault',
    bet: 2.5,
    betExact: '2.50',
    payout: 5,
    payoutExact: '5.00',
    status: 'settled',
    createdAt: 1234,
  }])
  assert.deepEqual(queries[0].params, ['player-1', 25])
  assert.equal(queries[0].sql.includes('idempotency_key'), false)
  assert.equal(queries[0].sql.includes('request_fingerprint'), false)
  assert.equal(queries[0].sql.includes('response_json'), false)
  assert.equal(Object.hasOwn(rows[0], 'accountId'), false)
})

test('game round history rejects invalid limits and missing account context', async () => {
  const history = new GameRoundHistory({ pool: { query: async () => ({ rows: [] }) } })
  await assert.rejects(
    history.list({ accountId: '', limit: 10 }),
    (error) => error instanceof GameRoundHistoryError && error.code === 'ACCOUNT_REQUIRED',
  )
  await assert.rejects(
    history.list({ accountId: 'player-1', limit: 101 }),
    (error) => error instanceof GameRoundHistoryError && error.code === 'INVALID_HISTORY_LIMIT',
  )
})

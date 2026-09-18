import test from 'node:test'
import assert from 'node:assert/strict'
import { PlayerDirectory, PlayerDirectoryError } from '../server/playerDirectory.js'

test('player directory validates query and result limits before querying', async () => {
  const queries = []
  const directory = new PlayerDirectory({
    pool: {
      async query(sql, params) {
        queries.push({ sql, params })
        return { rows: [{ id: 'p1', display_name: 'Player One', status: 'active', created_at: 1000 }] }
      },
    },
  })

  const rows = await directory.search({ query: 'Play', limit: 5 })
  assert.deepEqual(rows, [{ id: 'p1', displayName: 'Player One', status: 'active', createdAt: 1000 }])
  assert.deepEqual(queries[0].params, ['Play', 5])
  assert.equal(queries[0].sql.includes('email'), false)
  assert.equal(queries[0].sql.includes('password'), false)

  await assert.rejects(
    directory.search({ query: 'x' }),
    (error) => error instanceof PlayerDirectoryError && error.code === 'INVALID_PLAYER_QUERY',
  )
  await assert.rejects(
    directory.search({ query: 'Player', limit: 100 }),
    (error) => error instanceof PlayerDirectoryError && error.code === 'INVALID_PLAYER_LIMIT',
  )
})

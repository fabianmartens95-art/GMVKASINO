import test from 'node:test'
import assert from 'node:assert/strict'
import { AuthSessionDirectory, AuthSessionDirectoryError } from '../server/authSessionDirectory.js'

test('auth session directory sanitizes identifiers and derives state from server timestamps', async () => {
  const queries = []
  const directory = new AuthSessionDirectory({
    now: () => 10_000,
    idleTtlMs: 5_000,
    pool: {
      async query(sql, params) {
        queries.push({ sql, params })
        return {
          rows: [
            { id: 'raw-session-1', created_at: 9000, last_seen_at: 9500, expires_at: 20_000, revoked_at: null },
            { id: 'raw-session-2', created_at: 1000, last_seen_at: 2000, expires_at: 20_000, revoked_at: null },
            { id: 'raw-session-3', created_at: 8000, last_seen_at: 9000, expires_at: 20_000, revoked_at: 9500 },
          ],
        }
      },
    },
  })

  const sessions = await directory.list({ accountId: 'player-1', limit: 3 })
  assert.deepEqual(sessions.map((item) => item.state), ['active', 'expired', 'revoked'])
  assert.equal(sessions[0].sessionRef.length, 16)
  assert.notEqual(sessions[0].sessionRef, 'raw-session-1')
  assert.deepEqual(queries[0].params, ['player-1', 3])
  assert.equal(queries[0].sql.includes('token_hash'), false)

  const serialized = JSON.stringify(sessions)
  assert.equal(serialized.includes('raw-session'), false)
  assert.equal(serialized.includes('token'), false)
})

test('auth session directory rejects invalid account ids and limits', async () => {
  const directory = new AuthSessionDirectory({ pool: { query: async () => ({ rows: [] }) } })
  await assert.rejects(
    directory.list({ accountId: '', limit: 10 }),
    (error) => error instanceof AuthSessionDirectoryError && error.code === 'INVALID_ACCOUNT_ID',
  )
  await assert.rejects(
    directory.list({ accountId: 'player-1', limit: 101 }),
    (error) => error instanceof AuthSessionDirectoryError && error.code === 'INVALID_SESSION_LIMIT',
  )
})

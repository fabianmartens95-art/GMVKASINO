import test from 'node:test'
import assert from 'node:assert/strict'
import { verifyStagingRevision } from '../scripts/verify-staging-revision.mjs'

const SHA = '0123456789abcdef0123456789abcdef01234567'
const OTHER_SHA = '89abcdef0123456789abcdef0123456789abcdef'

function response(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

test('staging revision verification accepts the exact deployed commit', async () => {
  let requestedUrl = ''
  const result = await verifyStagingRevision({
    baseUrl: 'https://staging.example.invalid',
    expectedRevision: SHA.toUpperCase(),
    fetchImpl: async (url) => {
      requestedUrl = String(url)
      return response({ ok: true, status: 'live', mode: 'demo', revision: SHA })
    },
  })

  assert.deepEqual(result, { ok: true, revision: SHA })
  assert.equal(requestedUrl, 'https://staging.example.invalid/api/v1/health/live')
})

test('staging revision verification rejects a stale deployment', async () => {
  await assert.rejects(
    verifyStagingRevision({
      baseUrl: 'https://staging.example.invalid',
      expectedRevision: SHA,
      fetchImpl: async () => response({
        ok: true,
        status: 'live',
        mode: 'demo',
        revision: OTHER_SHA,
      }),
    }),
    /Staging revision mismatch/,
  )
})

test('staging revision verification requires a full revision and the demo health contract', async () => {
  await assert.rejects(
    verifyStagingRevision({
      baseUrl: 'https://staging.example.invalid',
      expectedRevision: 'abc1234',
      fetchImpl: async () => response({}),
    }),
    /40-character git SHA/,
  )

  await assert.rejects(
    verifyStagingRevision({
      baseUrl: 'https://staging.example.invalid',
      expectedRevision: SHA,
      fetchImpl: async () => response({ ok: true, status: 'ready', mode: 'demo', revision: SHA }),
    }),
    /expected GMVKASINO demo contract/,
  )
})

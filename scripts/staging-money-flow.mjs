import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { pathToFileURL } from 'node:url'

function normalizeBaseUrl(value) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error('STAGING_BASE_URL must be a valid URL')
  }
  if (url.protocol !== 'https:') throw new Error('STAGING_BASE_URL must use HTTPS')
  url.pathname = url.pathname.replace(/\/+$/, '')
  url.search = ''
  url.hash = ''
  return url.toString().replace(/\/$/, '')
}

async function jsonRequest(baseUrl, path, { method = 'GET', sessionId, body, fetchImpl = fetch } = {}) {
  const headers = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (sessionId) headers['X-Demo-Session'] = sessionId

  const response = await fetchImpl(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(`${method} ${path} failed with HTTP ${response.status}: ${JSON.stringify(payload)}`)
  }
  return payload
}

export function selectPlayableGamesForGate(gamesPayload) {
  const games = Array.isArray(gamesPayload?.games) ? gamesPayload.games : []
  const playable = games.filter((candidate) => (
    candidate
    && candidate.status === 'playable'
    && typeof candidate.id === 'string'
    && Array.isArray(candidate.allowedBets)
    && candidate.allowedBets.length > 0
  ))

  if (!playable.length) {
    throw new Error('No playable demo game with an allowed bet is available')
  }

  return playable.map((game) => ({
    id: game.id,
    bet: game.allowedBets[0],
  }))
}

async function verifyPlayableGame({ target, sessionId, game, fetchImpl }) {
  const retryKey = `gate-retry-${game.id}-${randomUUID()}`
  const first = await jsonRequest(target, '/api/v1/spin', {
    method: 'POST',
    sessionId,
    body: { gameId: game.id, bet: game.bet, idempotencyKey: retryKey },
    fetchImpl,
  })
  const replay = await jsonRequest(target, '/api/v1/spin', {
    method: 'POST',
    sessionId,
    body: { gameId: game.id, bet: game.bet, idempotencyKey: retryKey },
    fetchImpl,
  })
  if (!isDeepStrictEqual(first?.result, replay?.result)) {
    throw new Error(`[${game.id}] Idempotent retry returned a different game-round result`)
  }

  const afterRetry = await jsonRequest(target, '/api/v1/wallet', { sessionId, fetchImpl })
  if (Number(afterRetry?.wallet?.balance) !== Number(first?.result?.balance)) {
    throw new Error(`[${game.id}] Wallet balance does not match the idempotent retry result`)
  }

  const concurrentKey = `gate-concurrent-${game.id}-${randomUUID()}`
  const concurrentBody = { gameId: game.id, bet: game.bet, idempotencyKey: concurrentKey }
  const [concurrentA, concurrentB] = await Promise.all([
    jsonRequest(target, '/api/v1/spin', {
      method: 'POST', sessionId, body: concurrentBody, fetchImpl,
    }),
    jsonRequest(target, '/api/v1/spin', {
      method: 'POST', sessionId, body: concurrentBody, fetchImpl,
    }),
  ])
  if (!isDeepStrictEqual(concurrentA?.result, concurrentB?.result)) {
    throw new Error(`[${game.id}] Concurrent duplicate requests produced different game-round results`)
  }

  const finalWallet = await jsonRequest(target, '/api/v1/wallet', { sessionId, fetchImpl })
  if (Number(finalWallet?.wallet?.balance) !== Number(concurrentA?.result?.balance)) {
    throw new Error(`[${game.id}] Final wallet balance does not match the concurrent idempotent round`)
  }

  return {
    gameId: game.id,
    bet: game.bet,
    retryIdempotency: 'passed',
    concurrentIdempotency: 'passed',
    walletConsistency: 'passed',
  }
}

export async function verifyStagingMoneyFlow({ baseUrl, fetchImpl = fetch } = {}) {
  const target = normalizeBaseUrl(baseUrl)
  const gamesPayload = await jsonRequest(target, '/api/v1/games', { fetchImpl })
  const games = selectPlayableGamesForGate(gamesPayload)

  const opened = await jsonRequest(target, '/api/v1/session', {
    method: 'POST',
    body: { player: `gate-${randomUUID().slice(0, 8)}` },
    fetchImpl,
  })
  const sessionId = opened?.session?.id
  if (!sessionId) throw new Error('Staging session creation did not return a session id')

  try {
    const before = await jsonRequest(target, '/api/v1/wallet', { sessionId, fetchImpl })
    if (!Number.isFinite(Number(before?.wallet?.balance))) {
      throw new Error('Wallet did not return a numeric demo balance')
    }

    const results = []
    for (const game of games) {
      results.push(await verifyPlayableGame({
        target,
        sessionId,
        game,
        fetchImpl,
      }))
    }

    const first = results[0]
    return {
      ok: true,
      mode: 'demo',
      gameId: first.gameId,
      bet: first.bet,
      retryIdempotency: 'passed',
      concurrentIdempotency: 'passed',
      walletConsistency: 'passed',
      gameCount: results.length,
      allPlayableGamesCertified: true,
      games: results,
    }
  } finally {
    await jsonRequest(target, '/api/v1/session', {
      method: 'DELETE',
      sessionId,
      fetchImpl,
    }).catch(() => {})
  }
}

async function main() {
  const result = await verifyStagingMoneyFlow({ baseUrl: process.env.STAGING_BASE_URL })
  console.log(JSON.stringify(result, null, 2))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(JSON.stringify({ ok: false, error: error?.message || 'Staging money flow failed' }))
    process.exitCode = 1
  })
}

import { decimalToAtomic } from './amounts.js'

const RESERVED_RESULT_FIELDS = Object.freeze([
  'spinId',
  'roundId',
  'gameId',
  'bet',
  'balance',
  'spins',
  'accountId',
  'asset',
  'idempotencyKey',
  'requestId',
  'settlementReferenceId',
])

function seededRng(seed) {
  let state = Math.max(1, Number(seed) || 1) % 0x7fffffff
  return () => {
    state = (state * 48271) % 0x7fffffff
    return state / 0x7fffffff
  }
}

function failure(code, message) {
  return { code, message }
}

export async function certifyGame({ game, registry, samples = 100 } = {}) {
  const failures = []
  const gameId = game?.id || '<missing>'

  if (!game || typeof game !== 'object') {
    return { gameId, ok: false, samples: 0, failures: [failure('CATALOG_ENTRY_INVALID', 'Game catalog entry is invalid')] }
  }
  if (!registry?.has?.(game.id)) {
    return { gameId, ok: false, samples: 0, failures: [failure('ADAPTER_MISSING', 'Game adapter is not registered')] }
  }
  if (!Array.isArray(game.allowedBets) || game.allowedBets.length === 0) {
    failures.push(failure('ALLOWED_BETS_MISSING', 'Game must define at least one DEMO bet'))
  }

  const bets = Array.isArray(game.allowedBets)
    ? game.allowedBets.filter((bet) => Number.isFinite(bet) && bet > 0)
    : []
  if (bets.length !== game.allowedBets?.length) {
    failures.push(failure('ALLOWED_BET_INVALID', 'Every allowed bet must be a positive finite number'))
  }

  let completedSamples = 0
  for (let index = 0; index < samples && bets.length > 0; index += 1) {
    const bet = bets[index % bets.length]
    try {
      const result = await registry.resolve(game.id, {
        bet,
        rng: seededRng((index + 1) * 7919),
        game: Object.freeze({ ...game, allowedBets: Object.freeze([...bets]) }),
        requestId: `certification-${game.id}-${index + 1}`,
      })
      completedSamples += 1

      if (!Number.isFinite(result.totalWin) || result.totalWin < 0) {
        failures.push(failure('PAYOUT_INVALID', `Sample ${index + 1} returned an invalid payout`))
        break
      }
      try {
        decimalToAtomic(result.totalWin, 2)
      } catch {
        failures.push(failure('PAYOUT_PRECISION_INVALID', `Sample ${index + 1} exceeds DEMO precision`))
        break
      }

      const reserved = RESERVED_RESULT_FIELDS.filter((field) => Object.hasOwn(result, field))
      if (reserved.length > 0) {
        failures.push(failure(
          'RESERVED_RESULT_FIELD_EXPOSED',
          `Sample ${index + 1} exposed reserved fields: ${reserved.join(', ')}`,
        ))
        break
      }

      try {
        JSON.stringify(result)
      } catch {
        failures.push(failure('RESULT_NOT_SERIALIZABLE', `Sample ${index + 1} is not JSON serializable`))
        break
      }
    } catch (error) {
      failures.push(failure(
        'ADAPTER_RESOLUTION_FAILED',
        `Sample ${index + 1} failed: ${error?.code || error?.message || 'unknown error'}`,
      ))
      break
    }
  }

  return {
    gameId,
    status: game.status || null,
    ok: failures.length === 0 && completedSamples === samples,
    samples: completedSamples,
    requestedSamples: samples,
    failures,
  }
}

export async function certifyGameCatalog({ games, registry, samples = 100 } = {}) {
  if (!Array.isArray(games)) throw new TypeError('games must be an array')
  if (!registry) throw new TypeError('registry is required')
  if (!Number.isInteger(samples) || samples < 1 || samples > 10_000) {
    throw new TypeError('samples must be an integer between 1 and 10000')
  }

  const results = []
  const catalogIds = new Set()
  for (const game of games) {
    if (catalogIds.has(game?.id)) {
      results.push({
        gameId: game?.id || '<missing>',
        status: game?.status || null,
        ok: false,
        samples: 0,
        requestedSamples: samples,
        failures: [failure('DUPLICATE_CATALOG_ID', 'Game catalog ids must be unique')],
      })
      continue
    }
    if (game?.id) catalogIds.add(game.id)
    results.push(await certifyGame({ game, registry, samples }))
  }

  const adapterIds = registry.adapters instanceof Map ? [...registry.adapters.keys()] : []
  for (const adapterId of adapterIds) {
    if (catalogIds.has(adapterId)) continue
    results.push({
      gameId: adapterId,
      status: null,
      ok: false,
      samples: 0,
      requestedSamples: samples,
      failures: [failure('ADAPTER_NOT_IN_CATALOG', 'Registered adapter is missing from the game catalog')],
    })
  }

  return {
    ok: results.length > 0 && results.every((result) => result.ok),
    mode: 'demo',
    generatedAt: new Date().toISOString(),
    totalGames: results.length,
    passedGames: results.filter((result) => result.ok).length,
    failedGames: results.filter((result) => !result.ok).length,
    results,
  }
}

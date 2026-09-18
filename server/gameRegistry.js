import { goldenVaultGameAdapter } from './gameAdapters/goldenVault.js'
import { neonFruitsGameAdapter } from './gameAdapters/neonFruits.js'
import { diamondRushGameAdapter } from './gameAdapters/diamondRush.js'
import { decimalToAtomic } from './amounts.js'

export class GameAdapterContractError extends Error {
  constructor(message, details = undefined) {
    super(message)
    this.name = 'GameAdapterContractError'
    this.code = 'GAME_ADAPTER_CONTRACT_ERROR'
    this.details = details
  }
}

const RESERVED_RESULT_FIELDS = new Set([
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

function assertGameId(gameId) {
  if (typeof gameId !== 'string' || !/^[a-z0-9][a-z0-9-]{1,63}$/.test(gameId)) {
    throw new GameAdapterContractError('Game adapter id must be a stable lowercase slug')
  }
}

export function normalizeGameResult(rawResult) {
  if (!rawResult || typeof rawResult !== 'object' || Array.isArray(rawResult)) {
    throw new GameAdapterContractError('Game adapter must return an object result')
  }

  if (!Number.isFinite(rawResult.totalWin) || rawResult.totalWin < 0) {
    throw new GameAdapterContractError('Game result totalWin must be a finite non-negative number')
  }

  try {
    decimalToAtomic(rawResult.totalWin, 2)
  } catch {
    throw new GameAdapterContractError('Game result totalWin exceeds DEMO asset precision')
  }

  const normalized = {}
  for (const [key, value] of Object.entries(rawResult)) {
    if (RESERVED_RESULT_FIELDS.has(key)) continue
    normalized[key] = value
  }

  normalized.totalWin = rawResult.totalWin

  try {
    JSON.stringify(normalized)
  } catch {
    throw new GameAdapterContractError('Game result must be JSON serializable')
  }

  return normalized
}

export class GameRegistry {
  constructor(adapters = []) {
    this.adapters = new Map()
    for (const adapter of adapters) this.register(adapter)
  }

  register(adapter) {
    if (!adapter || typeof adapter !== 'object') {
      throw new GameAdapterContractError('Game adapter must be an object')
    }
    assertGameId(adapter.id)
    if (typeof adapter.resolve !== 'function') {
      throw new GameAdapterContractError('Game adapter resolve function is required', { gameId: adapter.id })
    }
    if (this.adapters.has(adapter.id)) {
      throw new GameAdapterContractError('Game adapter id is already registered', { gameId: adapter.id })
    }

    this.adapters.set(adapter.id, Object.freeze({
      id: adapter.id,
      resolve: adapter.resolve,
    }))
    return this
  }

  has(gameId) {
    return this.adapters.has(gameId)
  }

  get(gameId) {
    return this.adapters.get(gameId) ?? null
  }

  async resolve(gameId, context = {}) {
    const adapter = this.get(gameId)
    if (!adapter) {
      throw new GameAdapterContractError('Game adapter is not registered', { gameId })
    }

    const rawResult = await adapter.resolve(Object.freeze({ ...context, gameId }))
    return normalizeGameResult(rawResult)
  }
}

export function createDefaultGameRegistry() {
  return new GameRegistry([goldenVaultGameAdapter, neonFruitsGameAdapter, diamondRushGameAdapter])
}

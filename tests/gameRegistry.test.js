import test from 'node:test'
import assert from 'node:assert/strict'
import {
  GameAdapterContractError,
  GameRegistry,
  createDefaultGameRegistry,
  normalizeGameResult,
} from '../server/gameRegistry.js'

test('default registry resolves Golden Vault through the shared adapter contract', async () => {
  const registry = createDefaultGameRegistry()
  assert.equal(registry.has('golden-vault'), true)

  const result = await registry.resolve('golden-vault', {
    bet: 1,
    rng: () => 0,
  })

  assert.equal(result.totalWin, 50)
  assert.equal(Array.isArray(result.grid), true)
  assert.equal(Array.isArray(result.wins), true)
})

test('default registry contains all certified game adapters behind one shared contract', () => {
  const registry = createDefaultGameRegistry()
  for (const gameId of [
    'golden-vault',
    'neon-fruits',
    'diamond-rush',
    'lucky-777',
    'royal-sevens',
    'diamond-heat',
    'lucky-bells',
    'fruit-fiesta',
  ]) {
    assert.equal(registry.has(gameId), true)
  }
})

test('normalized game results cannot override server-authoritative round fields', () => {
  const result = normalizeGameResult({
    totalWin: 12.34,
    outcome: { multiplier: 2.5 },
    spinId: 'provider-controlled-spin',
    gameId: 'provider-controlled-game',
    bet: 999,
    balance: 999999,
    spins: 999,
    accountId: 'provider-controlled-account',
    settlementReferenceId: 'provider-settlement',
  })

  assert.deepEqual(result, {
    totalWin: 12.34,
    outcome: { multiplier: 2.5 },
  })
})

test('registry rejects payout precision beyond the DEMO asset scale', () => {
  assert.throws(
    () => normalizeGameResult({ totalWin: 1.001 }),
    (error) => error instanceof GameAdapterContractError
      && error.code === 'GAME_ADAPTER_CONTRACT_ERROR',
  )
})

test('registry rejects malformed or negative game outcomes fail-closed', async () => {
  const registry = new GameRegistry([
    {
      id: 'broken-game',
      resolve: () => ({ totalWin: -1 }),
    },
  ])

  await assert.rejects(
    registry.resolve('broken-game', { bet: 1 }),
    (error) => error instanceof GameAdapterContractError
      && error.code === 'GAME_ADAPTER_CONTRACT_ERROR',
  )
})

test('registry enforces unique stable game ids and registered adapters', async () => {
  const adapter = {
    id: 'test-game',
    resolve: () => ({ totalWin: 0 }),
  }
  const registry = new GameRegistry([adapter])

  assert.throws(
    () => registry.register(adapter),
    (error) => error instanceof GameAdapterContractError,
  )

  await assert.rejects(
    registry.resolve('missing-game', { bet: 1 }),
    (error) => error instanceof GameAdapterContractError,
  )
})

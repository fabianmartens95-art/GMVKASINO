import test from 'node:test'
import assert from 'node:assert/strict'
import { dragonForgeEngine, resolveDragonForge } from '../src/game/dragonForgeEngine.js'
import { GameRegistry } from '../server/gameRegistry.js'
import { dragonForgeGameAdapter } from '../server/gameAdapters/dragonForge.js'

test('Dragon Forge consumes expanding-Wild Feature Slot V1 configuration', () => {
  assert.equal(dragonForgeEngine.rows, 3)
  assert.equal(dragonForgeEngine.reels, 5)
  assert.equal(dragonForgeEngine.expandingWild, true)
  assert.equal(dragonForgeEngine.stickyWild, false)
  assert.equal(dragonForgeEngine.bonusMultiplier, 2)
  assert.equal(dragonForgeEngine.freeSpins.spins, 6)
})

test('Dragon Forge deterministic base fixture is cent-exact', () => {
  const result = resolveDragonForge({ bet: 1, rng: () => 0 })
  assert.equal(result.totalWin, 220)
  assert.equal(result.wins.length, 10)
  assert.equal(result.features.freeSpinsAwarded, 0)
})

test('Dragon Forge awards shared Scatter/Free Spin feature', () => {
  const values = [0.999, 0.999, 0.999, ...Array(120).fill(0)]
  let index = 0
  const result = resolveDragonForge({ bet: 1, rng: () => values[index++] ?? 0 })

  assert.equal(result.scatter.count, 3)
  assert.equal(result.features.freeSpinsAwarded, 6)
  assert.equal(result.features.freeSpinsPlayed, 6)
  assert.equal(result.features.expandingWild, true)
  assert.equal(result.features.bonusMultiplier, 2)
})

test('Dragon Forge adapter satisfies shared normalized result contract', async () => {
  const registry = new GameRegistry([dragonForgeGameAdapter])
  const result = await registry.resolve('dragon-forge', { bet: 1, rng: () => 0 })

  assert.equal(result.totalWin, 220)
  assert.equal(Object.hasOwn(result, 'balance'), false)
  assert.equal(Object.hasOwn(result, 'settlementReferenceId'), false)
})

test('Dragon Forge simulation remains finite, non-negative and cent-exact', () => {
  for (let sample = 1; sample <= 100; sample += 1) {
    let state = sample * 409
    const rng = () => {
      state = (state * 48271) % 0x7fffffff
      return state / 0x7fffffff
    }
    const result = resolveDragonForge({ bet: 5, rng })
    assert.equal(Number.isFinite(result.totalWin), true)
    assert.ok(result.totalWin >= 0)
    assert.equal(Number.isInteger(result.totalWin * 100), true)
  }
})

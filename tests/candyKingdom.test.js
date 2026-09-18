import test from 'node:test'
import assert from 'node:assert/strict'
import { candyKingdomEngine, resolveCandyKingdom } from '../src/game/candyKingdomEngine.js'
import { GameRegistry } from '../server/gameRegistry.js'
import { candyKingdomGameAdapter } from '../server/gameAdapters/candyKingdom.js'

test('Candy Kingdom consumes multiplier-focused Feature Slot V1 configuration', () => {
  assert.equal(candyKingdomEngine.rows, 3)
  assert.equal(candyKingdomEngine.reels, 5)
  assert.equal(candyKingdomEngine.expandingWild, false)
  assert.equal(candyKingdomEngine.stickyWild, false)
  assert.equal(candyKingdomEngine.bonusMultiplier, 3)
  assert.equal(candyKingdomEngine.freeSpins.spins, 8)
})

test('Candy Kingdom deterministic base fixture is cent-exact', () => {
  const result = resolveCandyKingdom({ bet: 1, rng: () => 0 })
  assert.equal(result.totalWin, 150)
  assert.equal(result.wins.length, 10)
  assert.equal(result.features.freeSpinsAwarded, 0)
})

test('Candy Kingdom awards eight shared Free Spins', () => {
  const values = [0.999, 0.999, 0.999, ...Array(150).fill(0)]
  let index = 0
  const result = resolveCandyKingdom({ bet: 1, rng: () => values[index++] ?? 0 })

  assert.equal(result.scatter.count, 3)
  assert.equal(result.features.freeSpinsAwarded, 8)
  assert.equal(result.features.freeSpinsPlayed, 8)
  assert.equal(result.features.bonusMultiplier, 3)
})

test('Candy Kingdom adapter satisfies shared normalized result contract', async () => {
  const registry = new GameRegistry([candyKingdomGameAdapter])
  const result = await registry.resolve('candy-kingdom', { bet: 1, rng: () => 0 })

  assert.equal(result.totalWin, 150)
  assert.equal(Object.hasOwn(result, 'balance'), false)
  assert.equal(Object.hasOwn(result, 'requestId'), false)
})

test('Candy Kingdom simulation remains finite, non-negative and cent-exact', () => {
  for (let sample = 1; sample <= 100; sample += 1) {
    let state = sample * 307
    const rng = () => {
      state = (state * 48271) % 0x7fffffff
      return state / 0x7fffffff
    }
    const result = resolveCandyKingdom({ bet: 5, rng })
    assert.equal(Number.isFinite(result.totalWin), true)
    assert.ok(result.totalWin >= 0)
    assert.equal(Number.isInteger(result.totalWin * 100), true)
  }
})

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  pharaohsFortuneEngine,
  resolvePharaohsFortune,
} from '../src/game/pharaohsFortuneEngine.js'
import { GameRegistry } from '../server/gameRegistry.js'
import { pharaohsFortuneGameAdapter } from '../server/gameAdapters/pharaohsFortune.js'

test("Pharaoh's Fortune consumes Feature Slot Template V1", () => {
  assert.equal(pharaohsFortuneEngine.rows, 3)
  assert.equal(pharaohsFortuneEngine.reels, 5)
  assert.equal(pharaohsFortuneEngine.paylines.length, 10)
  assert.equal(pharaohsFortuneEngine.expandingWild, true)
  assert.equal(pharaohsFortuneEngine.stickyWild, false)
  assert.equal(pharaohsFortuneEngine.freeSpins.spins, 6)
})

test("Pharaoh's Fortune deterministic base fixture is cent-exact", () => {
  const result = resolvePharaohsFortune({ bet: 1, rng: () => 0 })
  assert.equal(result.features.freeSpinsAwarded, 0)
  assert.equal(result.totalWin, 200)
  assert.equal(result.wins.length, 10)
})

test("Pharaoh's Fortune awards shared Scatter/Free Spin feature", () => {
  const values = [0.999, 0.999, 0.999, ...Array(120).fill(0)]
  let index = 0
  const result = resolvePharaohsFortune({ bet: 1, rng: () => values[index++] ?? 0 })

  assert.equal(result.scatter.count, 3)
  assert.equal(result.features.freeSpinsAwarded, 6)
  assert.equal(result.features.freeSpinsPlayed, 6)
  assert.equal(result.features.expandingWild, true)
  assert.equal(result.features.bonusMultiplier, 1.5)
})

test("Pharaoh's Fortune adapter satisfies the shared normalized result contract", async () => {
  const registry = new GameRegistry([pharaohsFortuneGameAdapter])
  const result = await registry.resolve('pharaohs-fortune', { bet: 1, rng: () => 0 })

  assert.equal(result.totalWin, 200)
  assert.equal(Object.hasOwn(result, 'balance'), false)
  assert.equal(Object.hasOwn(result, 'accountId'), false)
})

test("Pharaoh's Fortune simulation remains finite, non-negative and cent-exact", () => {
  for (let sample = 1; sample <= 100; sample += 1) {
    let state = sample * 101
    const rng = () => {
      state = (state * 48271) % 0x7fffffff
      return state / 0x7fffffff
    }
    const result = resolvePharaohsFortune({ bet: 5, rng })
    assert.equal(Number.isFinite(result.totalWin), true)
    assert.ok(result.totalWin >= 0)
    assert.equal(Number.isInteger(result.totalWin * 100), true)
  }
})

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DIAMOND_HEAT_SYMBOLS,
  createDiamondHeatGrid,
  evaluateDiamondHeatGrid,
  resolveDiamondHeat,
} from '../src/game/diamondHeatEngine.js'
import { GameRegistry } from '../server/gameRegistry.js'
import { diamondHeatGameAdapter } from '../server/gameAdapters/diamondHeat.js'

const byId = Object.fromEntries(DIAMOND_HEAT_SYMBOLS.map((symbol) => [symbol.id, symbol]))
const grid = (rows) => rows.map((row) => row.map((id) => byId[id]))

test('Diamond Heat consumes Classic Slot Template deterministic grid behavior', () => {
  const deterministic = () => 0
  const generated = createDiamondHeatGrid(deterministic)
  assert.ok(generated.flat().every((symbol) => symbol.id === 'hot-diamond'))
  const result = resolveDiamondHeat({ bet: 2, rng: deterministic })
  assert.equal(result.wins.length, 5)
  assert.equal(result.totalWin, 250)
})

test('Diamond Heat evaluates shared paylines without authoritative wallet fields', () => {
  const result = evaluateDiamondHeatGrid(grid([
    ['flame', 'coin', 'flame'],
    ['crown', 'flame', 'crown'],
    ['flame', 'ruby', 'flame'],
  ]), 1)
  assert.deepEqual(result.wins.map((win) => win.line), [4, 5])
  assert.equal(result.totalWin, 24)
  for (const field of ['balance', 'accountId', 'spinId']) assert.equal(Object.hasOwn(result, field), false)
})

test('Diamond Heat adapter satisfies the shared normalized game contract', async () => {
  const registry = new GameRegistry([diamondHeatGameAdapter])
  const result = await registry.resolve('diamond-heat', { bet: 1, rng: () => 0 })
  assert.equal(result.totalWin, 125)
  assert.equal(Array.isArray(result.grid), true)
  assert.equal(Array.isArray(result.wins), true)
})

test('Diamond Heat deterministic simulation remains finite, non-negative and cent-exact', () => {
  let sawWin = false
  let sawNoWin = false
  for (let sample = 0; sample < 200; sample += 1) {
    let state = sample + 59
    const rng = () => {
      state = (state * 48271) % 0x7fffffff
      return state / 0x7fffffff
    }
    const result = resolveDiamondHeat({ bet: 5, rng })
    sawWin ||= result.totalWin > 0
    sawNoWin ||= result.totalWin === 0
    assert.equal(Number.isFinite(result.totalWin), true)
    assert.ok(result.totalWin >= 0)
    assert.equal(Number.isInteger(result.totalWin * 100), true)
    assert.ok(result.wins.every((win) => Number.isFinite(win.payout) && win.payout >= 0))
  }
  assert.equal(sawWin, true)
  assert.equal(sawNoWin, true)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  LUCKY_BELLS_SYMBOLS,
  createLuckyBellsGrid,
  evaluateLuckyBellsGrid,
  resolveLuckyBells,
} from '../src/game/luckyBellsEngine.js'
import { GameRegistry } from '../server/gameRegistry.js'
import { luckyBellsGameAdapter } from '../server/gameAdapters/luckyBells.js'

const byId = Object.fromEntries(LUCKY_BELLS_SYMBOLS.map((symbol) => [symbol.id, symbol]))
const grid = (rows) => rows.map((row) => row.map((id) => byId[id]))

test('Lucky Bells consumes Classic Slot Template deterministic grid behavior', () => {
  const deterministic = () => 0
  const generated = createLuckyBellsGrid(deterministic)
  assert.ok(generated.flat().every((symbol) => symbol.id === 'gold-bell'))
  const result = resolveLuckyBells({ bet: 2, rng: deterministic })
  assert.equal(result.wins.length, 5)
  assert.equal(result.totalWin, 160)
})

test('Lucky Bells evaluates shared paylines without authoritative wallet fields', () => {
  const result = evaluateLuckyBellsGrid(grid([
    ['horseshoe', 'lemon', 'horseshoe'],
    ['clover', 'horseshoe', 'clover'],
    ['horseshoe', 'bar', 'horseshoe'],
  ]), 1)
  assert.deepEqual(result.wins.map((win) => win.line), [4, 5])
  assert.equal(result.totalWin, 18)
  for (const field of ['balance', 'accountId', 'spinId']) assert.equal(Object.hasOwn(result, field), false)
})

test('Lucky Bells adapter satisfies the shared normalized game contract', async () => {
  const registry = new GameRegistry([luckyBellsGameAdapter])
  const result = await registry.resolve('lucky-bells', { bet: 1, rng: () => 0 })
  assert.equal(result.totalWin, 80)
  assert.equal(Array.isArray(result.grid), true)
  assert.equal(Array.isArray(result.wins), true)
})

test('Lucky Bells deterministic simulation remains finite, non-negative and cent-exact', () => {
  let sawWin = false
  let sawNoWin = false
  for (let sample = 0; sample < 200; sample += 1) {
    let state = sample + 73
    const rng = () => {
      state = (state * 48271) % 0x7fffffff
      return state / 0x7fffffff
    }
    const result = resolveLuckyBells({ bet: 5, rng })
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

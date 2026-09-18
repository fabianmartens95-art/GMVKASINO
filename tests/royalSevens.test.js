import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ROYAL_SEVENS_SYMBOLS,
  createRoyalSevensGrid,
  evaluateRoyalSevensGrid,
  resolveRoyalSevens,
} from '../src/game/royalSevensEngine.js'
import { GameRegistry } from '../server/gameRegistry.js'
import { royalSevensGameAdapter } from '../server/gameAdapters/royalSevens.js'

const byId = Object.fromEntries(ROYAL_SEVENS_SYMBOLS.map((symbol) => [symbol.id, symbol]))
const grid = (rows) => rows.map((row) => row.map((id) => byId[id]))

test('Royal Sevens consumes Classic Slot Template deterministic grid behavior', () => {
  const deterministic = () => 0
  const generated = createRoyalSevensGrid(deterministic)
  assert.ok(generated.flat().every((symbol) => symbol.id === 'royal-seven'))
  const result = resolveRoyalSevens({ bet: 2, rng: deterministic })
  assert.equal(result.wins.length, 5)
  assert.equal(result.totalWin, 180)
})

test('Royal Sevens evaluates shared paylines without authoritative wallet fields', () => {
  const result = evaluateRoyalSevensGrid(grid([
    ['crown', 'lemon', 'crown'],
    ['diamond', 'crown', 'diamond'],
    ['crown', 'bar', 'crown'],
  ]), 1)
  assert.deepEqual(result.wins.map((win) => win.line), [4, 5])
  assert.equal(result.totalWin, 20)
  for (const field of ['balance', 'accountId', 'spinId']) assert.equal(Object.hasOwn(result, field), false)
})

test('Royal Sevens adapter satisfies the shared normalized game contract', async () => {
  const registry = new GameRegistry([royalSevensGameAdapter])
  const result = await registry.resolve('royal-sevens', { bet: 1, rng: () => 0 })
  assert.equal(result.totalWin, 90)
  assert.equal(Array.isArray(result.grid), true)
  assert.equal(Array.isArray(result.wins), true)
})

test('Royal Sevens deterministic simulation remains finite, non-negative and cent-exact', () => {
  let sawWin = false
  let sawNoWin = false
  for (let sample = 0; sample < 200; sample += 1) {
    let state = sample + 41
    const rng = () => {
      state = (state * 48271) % 0x7fffffff
      return state / 0x7fffffff
    }
    const result = resolveRoyalSevens({ bet: 5, rng })
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

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  FRUIT_FIESTA_SYMBOLS,
  createFruitFiestaGrid,
  evaluateFruitFiestaGrid,
  resolveFruitFiesta,
} from '../src/game/fruitFiestaEngine.js'
import { GameRegistry } from '../server/gameRegistry.js'
import { fruitFiestaGameAdapter } from '../server/gameAdapters/fruitFiesta.js'

const byId = Object.fromEntries(FRUIT_FIESTA_SYMBOLS.map((symbol) => [symbol.id, symbol]))
const grid = (rows) => rows.map((row) => row.map((id) => byId[id]))

test('Fruit Fiesta consumes Classic Slot Template deterministic grid behavior', () => {
  const deterministic = () => 0
  const generated = createFruitFiestaGrid(deterministic)
  assert.ok(generated.flat().every((symbol) => symbol.id === 'golden-fruit'))
  const result = resolveFruitFiesta({ bet: 2, rng: deterministic })
  assert.equal(result.wins.length, 5)
  assert.equal(result.totalWin, 150)
})

test('Fruit Fiesta evaluates shared paylines without authoritative wallet fields', () => {
  const result = evaluateFruitFiestaGrid(grid([
    ['pineapple', 'orange', 'pineapple'],
    ['watermelon', 'pineapple', 'watermelon'],
    ['pineapple', 'grape', 'pineapple'],
  ]), 1)
  assert.deepEqual(result.wins.map((win) => win.line), [4, 5])
  assert.equal(result.totalWin, 16)
  for (const field of ['balance', 'accountId', 'spinId']) assert.equal(Object.hasOwn(result, field), false)
})

test('Fruit Fiesta adapter satisfies the shared normalized game contract', async () => {
  const registry = new GameRegistry([fruitFiestaGameAdapter])
  const result = await registry.resolve('fruit-fiesta', { bet: 1, rng: () => 0 })
  assert.equal(result.totalWin, 75)
  assert.equal(Array.isArray(result.grid), true)
  assert.equal(Array.isArray(result.wins), true)
})

test('Fruit Fiesta deterministic simulation remains finite, non-negative and cent-exact', () => {
  let sawWin = false
  let sawNoWin = false
  for (let sample = 0; sample < 200; sample += 1) {
    let state = sample + 89
    const rng = () => {
      state = (state * 48271) % 0x7fffffff
      return state / 0x7fffffff
    }
    const result = resolveFruitFiesta({ bet: 5, rng })
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

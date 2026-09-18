import test from 'node:test'
import assert from 'node:assert/strict'
import {
  NEON_FRUITS_SYMBOLS,
  createNeonFruitsGrid,
  evaluateNeonFruitsGrid,
  resolveNeonFruits,
} from '../src/game/neonFruitsEngine.js'
import { GameRegistry } from '../server/gameRegistry.js'
import { neonFruitsGameAdapter } from '../server/gameAdapters/neonFruits.js'

const byId = Object.fromEntries(NEON_FRUITS_SYMBOLS.map((symbol) => [symbol.id, symbol]))

function grid(rows) {
  return rows.map((row) => row.map((id) => byId[id]))
}

test('Neon Fruits resolves deterministic all-strawberry fixtures', () => {
  const deterministic = () => 0
  const generated = createNeonFruitsGrid(deterministic)
  assert.ok(generated.flat().every((symbol) => symbol.id === 'strawberry'))

  const result = resolveNeonFruits({ bet: 2, rng: deterministic })
  assert.equal(result.wins.length, 5)
  assert.equal(result.totalWin, 20)
})

test('Neon Fruits evaluates horizontal and diagonal paylines without touching wallet state', () => {
  const result = evaluateNeonFruitsGrid(grid([
    ['star', 'lemon', 'star'],
    ['grape', 'star', 'grape'],
    ['star', 'watermelon', 'star'],
  ]), 1)

  assert.deepEqual(result.wins.map((win) => win.line), [4, 5])
  assert.equal(result.totalWin, 14)
  assert.equal(Object.hasOwn(result, 'balance'), false)
  assert.equal(Object.hasOwn(result, 'accountId'), false)
})

test('Neon Fruits adapter satisfies the shared normalized game contract', async () => {
  const registry = new GameRegistry([neonFruitsGameAdapter])
  const result = await registry.resolve('neon-fruits', { bet: 1, rng: () => 0 })

  assert.equal(result.totalWin, 10)
  assert.equal(Array.isArray(result.grid), true)
  assert.equal(Array.isArray(result.wins), true)
})

test('Neon Fruits simulation remains finite and non-negative across deterministic samples', () => {
  for (let sample = 0; sample < 100; sample += 1) {
    let state = sample + 1
    const rng = () => {
      state = (state * 48271) % 0x7fffffff
      return state / 0x7fffffff
    }
    const result = resolveNeonFruits({ bet: 5, rng })
    assert.equal(Number.isFinite(result.totalWin), true)
    assert.ok(result.totalWin >= 0)
    assert.ok(result.wins.every((win) => win.payout >= 0 && Number.isFinite(win.payout)))
  }
})

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  LUCKY_777_SYMBOLS,
  createLucky777Grid,
  evaluateLucky777Grid,
  resolveLucky777,
} from '../src/game/lucky777Engine.js'
import { GameRegistry } from '../server/gameRegistry.js'
import { lucky777GameAdapter } from '../server/gameAdapters/lucky777.js'

const byId = Object.fromEntries(LUCKY_777_SYMBOLS.map((symbol) => [symbol.id, symbol]))

function grid(rows) {
  return rows.map((row) => row.map((id) => byId[id]))
}

test('Lucky 777 resolves deterministic all-seven fixtures', () => {
  const deterministic = () => 0
  const generated = createLucky777Grid(deterministic)
  assert.ok(generated.flat().every((symbol) => symbol.id === 'triple-seven'))

  const result = resolveLucky777({ bet: 2, rng: deterministic })
  assert.equal(result.wins.length, 5)
  assert.equal(result.totalWin, 200)
})

test('Lucky 777 evaluates paylines without authoritative wallet fields', () => {
  const result = evaluateLucky777Grid(grid([
    ['bell', 'lemon', 'bell'],
    ['cherry', 'bell', 'cherry'],
    ['bell', 'horseshoe', 'bell'],
  ]), 1)

  assert.deepEqual(result.wins.map((win) => win.line), [4, 5])
  assert.equal(result.totalWin, 12)
  assert.equal(Object.hasOwn(result, 'balance'), false)
  assert.equal(Object.hasOwn(result, 'accountId'), false)
})

test('Lucky 777 adapter satisfies the shared normalized game contract', async () => {
  const registry = new GameRegistry([lucky777GameAdapter])
  const result = await registry.resolve('lucky-777', { bet: 1, rng: () => 0 })

  assert.equal(result.totalWin, 100)
  assert.equal(Array.isArray(result.grid), true)
  assert.equal(Array.isArray(result.wins), true)
})

test('Lucky 777 simulation remains finite, non-negative and cent-exact', () => {
  let sawWin = false
  let sawNoWin = false

  for (let sample = 0; sample < 150; sample += 1) {
    let state = sample + 31
    const rng = () => {
      state = (state * 48271) % 0x7fffffff
      return state / 0x7fffffff
    }
    const result = resolveLucky777({ bet: 5, rng })
    sawWin ||= result.totalWin > 0
    sawNoWin ||= result.totalWin === 0
    assert.equal(Number.isFinite(result.totalWin), true)
    assert.ok(result.totalWin >= 0)
    assert.equal(Number.isInteger(result.totalWin * 100), true)
    assert.ok(result.wins.every((win) => win.payout >= 0 && Number.isFinite(win.payout)))
  }

  assert.equal(sawWin, true)
  assert.equal(sawNoWin, true)
})

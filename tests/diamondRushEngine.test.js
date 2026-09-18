import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DIAMOND_RUSH_SYMBOLS,
  createDiamondRushGrid,
  evaluateDiamondRushGrid,
  resolveDiamondRush,
} from '../src/game/diamondRushEngine.js'
import { GameRegistry } from '../server/gameRegistry.js'
import { diamondRushGameAdapter } from '../server/gameAdapters/diamondRush.js'

const byId = Object.fromEntries(DIAMOND_RUSH_SYMBOLS.map((symbol) => [symbol.id, symbol]))

function grid(rows) {
  return rows.map((row) => row.map((id) => byId[id]))
}

test('Diamond Rush resolves deterministic all-diamond fixtures', () => {
  const deterministic = () => 0
  const generated = createDiamondRushGrid(deterministic)
  assert.ok(generated.flat().every((symbol) => symbol.id === 'diamond'))

  const result = resolveDiamondRush({ bet: 2, rng: deterministic })
  assert.equal(result.wins.length, 5)
  assert.equal(result.totalWin, 150)
})

test('Diamond Rush evaluates paylines without authoritative wallet fields', () => {
  const result = evaluateDiamondRushGrid(grid([
    ['crown', 'coin', 'crown'],
    ['ruby', 'crown', 'ruby'],
    ['crown', 'gold', 'crown'],
  ]), 1)

  assert.deepEqual(result.wins.map((win) => win.line), [4, 5])
  assert.equal(result.totalWin, 18)
  assert.equal(Object.hasOwn(result, 'balance'), false)
  assert.equal(Object.hasOwn(result, 'accountId'), false)
})

test('Diamond Rush adapter satisfies the shared normalized game contract', async () => {
  const registry = new GameRegistry([diamondRushGameAdapter])
  const result = await registry.resolve('diamond-rush', { bet: 1, rng: () => 0 })

  assert.equal(result.totalWin, 75)
  assert.equal(Array.isArray(result.grid), true)
  assert.equal(Array.isArray(result.wins), true)
})

test('Diamond Rush simulation remains finite, non-negative and cent-exact', () => {
  let sawWin = false
  let sawNoWin = false

  for (let sample = 0; sample < 150; sample += 1) {
    let state = sample + 17
    const rng = () => {
      state = (state * 48271) % 0x7fffffff
      return state / 0x7fffffff
    }
    const result = resolveDiamondRush({ bet: 5, rng })
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

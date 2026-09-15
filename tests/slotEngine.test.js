import test from 'node:test'
import assert from 'node:assert/strict'
import { SYMBOLS, evaluateGrid } from '../src/game/slotEngine.js'

const byId = Object.fromEntries(SYMBOLS.map((symbol) => [symbol.id, symbol]))

function grid(rows) {
  return rows.map((row) => row.map((id) => byId[id]))
}

test('pays one horizontal winning line', () => {
  const result = evaluateGrid(grid([
    ['cherry', 'cherry', 'cherry'],
    ['lemon', 'bar', 'seven'],
    ['diamond', 'bell', 'lemon'],
  ]), 5)

  assert.equal(result.wins.length, 1)
  assert.equal(result.wins[0].line, 1)
  assert.equal(result.totalWin, 15)
})

test('adds multiple paylines correctly', () => {
  const result = evaluateGrid(grid([
    ['seven', 'lemon', 'seven'],
    ['diamond', 'seven', 'diamond'],
    ['seven', 'bar', 'seven'],
  ]), 2)

  assert.equal(result.wins.length, 2)
  assert.deepEqual(result.wins.map((win) => win.line), [4, 5])
  assert.equal(result.totalWin, 40)
})

test('returns zero for a losing grid', () => {
  const result = evaluateGrid(grid([
    ['seven', 'diamond', 'bar'],
    ['bell', 'cherry', 'lemon'],
    ['lemon', 'bar', 'diamond'],
  ]), 10)

  assert.equal(result.wins.length, 0)
  assert.equal(result.totalWin, 0)
})

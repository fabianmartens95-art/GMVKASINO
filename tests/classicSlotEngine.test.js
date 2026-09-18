import test from 'node:test'
import assert from 'node:assert/strict'
import { CLASSIC_3X3_PAYLINES, createClassicSlotEngine } from '../src/game/classicSlotEngine.js'
import { SYMBOLS, spin } from '../src/game/slotEngine.js'

const TEST_SYMBOLS = Object.freeze([
  Object.freeze({ id: 'alpha', label: 'A', weight: 1, multiplier: 2 }),
  Object.freeze({ id: 'beta', label: 'B', weight: 1, multiplier: 4 }),
])

test('Classic Slot Template resolves deterministic 3x3/5-line outcomes from game configuration', () => {
  const engine = createClassicSlotEngine({
    name: 'Template Fixture',
    symbols: TEST_SYMBOLS,
  })

  const result = engine.resolve({ bet: 2, rng: () => 0 })

  assert.equal(CLASSIC_3X3_PAYLINES.length, 5)
  assert.equal(result.wins.length, 5)
  assert.equal(result.totalWin, 20)
  assert.deepEqual(result.grid[0][0], { id: 'alpha', label: 'A' })
  assert.deepEqual(result.wins[0].symbol, { id: 'alpha', label: 'A' })
  assert.equal(result.wins[0].multiplier, 2)
})

test('Classic Slot Template supports Golden Vault legacy result projection without changing payout math', () => {
  const result = spin(1, () => 0)

  assert.equal(result.totalWin, 50)
  assert.equal(result.grid[0][0], SYMBOLS[0])
  assert.equal(result.wins[0].symbol, SYMBOLS[0])
  assert.equal(Object.hasOwn(result.wins[0], 'multiplier'), false)
})

test('Classic Slot Template rejects malformed shared configuration early', () => {
  assert.throws(
    () => createClassicSlotEngine({
      symbols: [{ id: 'broken', label: 'Broken', weight: 0, multiplier: 1 }],
    }),
    /positive finite weight/,
  )

  const engine = createClassicSlotEngine({ symbols: TEST_SYMBOLS })
  assert.throws(
    () => engine.evaluateGrid([[TEST_SYMBOLS[0]]], 1),
    /3x3/,
  )
})

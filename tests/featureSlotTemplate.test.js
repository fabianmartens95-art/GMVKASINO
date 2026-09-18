import test from 'node:test'
import assert from 'node:assert/strict'
import {
  FEATURE_5X3_PAYLINES,
  createFeatureSlotEngine,
} from '../src/game/featureSlotEngine.js'

const SYMBOLS = Object.freeze([
  Object.freeze({ id: 'gem', label: 'G', weight: 1, multiplier: 2 }),
  Object.freeze({ id: 'wild', label: 'W', weight: 1, multiplier: 5, kind: 'wild' }),
  Object.freeze({ id: 'scatter', label: 'S', weight: 1, multiplier: 0, kind: 'scatter' }),
])

function makeEngine(overrides = {}) {
  return createFeatureSlotEngine({
    name: 'Feature QA',
    symbols: SYMBOLS,
    freeSpins: { triggerCount: 3, spins: 2 },
    scatterPayouts: { 3: 2, 4: 5, 5: 10 },
    expandingWild: true,
    stickyWild: true,
    bonusMultiplier: 2,
    ...overrides,
  })
}

test('Feature Slot Template V1 exposes the shared 5x3 payline family', () => {
  const engine = makeEngine()
  assert.equal(engine.rows, 3)
  assert.equal(engine.reels, 5)
  assert.equal(engine.paylines, FEATURE_5X3_PAYLINES)
  assert.equal(engine.paylines.length, 10)
})

test('wilds substitute on paylines while scatters never become line wins', () => {
  const engine = makeEngine({ expandingWild: false, stickyWild: false })
  const result = engine.evaluateGrid([
    ['gem', 'wild', 'gem', 'gem', 'gem'],
    ['scatter', 'gem', 'gem', 'gem', 'gem'],
    ['gem', 'gem', 'gem', 'gem', 'gem'],
  ], 1)

  const topLine = result.wins.find((win) => win.line === 1)
  assert.ok(topLine)
  assert.equal(topLine.symbol.id, 'gem')
  assert.equal(topLine.payout, 2)
  assert.ok(result.wins.every((win) => win.symbol.id !== 'scatter'))
})

test('expanding wilds preserve scatter positions and expand the wild reel', () => {
  const engine = makeEngine({ stickyWild: false })
  const result = engine.evaluateGrid([
    ['gem', 'wild', 'gem', 'gem', 'gem'],
    ['gem', 'gem', 'gem', 'gem', 'gem'],
    ['gem', 'scatter', 'gem', 'gem', 'gem'],
  ], 1)

  assert.equal(result.grid[0][1].kind, 'wild')
  assert.equal(result.grid[1][1].kind, 'wild')
  assert.equal(result.grid[2][1].kind, 'scatter')
  assert.equal(result.scatter.count, 1)
})

test('three base scatters award deterministic free spins with sticky expanding wilds', () => {
  const engine = makeEngine()
  const values = [
    // Base grid: 3 scatters, then regular gems.
    0.9, 0.9, 0.9, 0.1, 0.1,
    0.1, 0.1, 0.1, 0.1, 0.1,
    0.1, 0.1, 0.1, 0.1, 0.1,
    // Bonus 1: first cell wild, everything else regular.
    0.5, 0.1, 0.1, 0.1, 0.1,
    0.1, 0.1, 0.1, 0.1, 0.1,
    0.1, 0.1, 0.1, 0.1, 0.1,
    // Bonus 2: all regular; prior expanded reel must remain sticky.
    ...Array(15).fill(0.1),
  ]
  let cursor = 0
  const rng = () => values[cursor++] ?? 0.1

  const result = engine.resolve({ bet: 1, rng })

  assert.equal(result.scatter.count, 3)
  assert.equal(result.scatter.payout, 2)
  assert.equal(result.features.freeSpinsAwarded, 2)
  assert.equal(result.features.freeSpinsPlayed, 2)
  assert.equal(result.features.bonusMultiplier, 2)
  assert.equal(result.features.retriggerSupported, false)
  assert.equal(result.bonusSpins.length, 2)
  assert.deepEqual(result.bonusSpins[0].stickyWildPositions, [[0, 0], [1, 0], [2, 0]])
  assert.deepEqual(result.bonusSpins[1].stickyWildPositions, [[0, 0], [1, 0], [2, 0]])
  assert.ok(result.bonusSpins[1].grid.every((row) => row[0].kind === 'wild'))
  assert.equal(Number.isFinite(result.totalWin), true)
  assert.ok(result.totalWin >= result.baseWin)
  assert.equal(Number.isInteger(result.totalWin * 100), true)
})

test('grid symbols are resolved from immutable configuration rather than caller multipliers', () => {
  const engine = makeEngine({ expandingWild: false, stickyWild: false })
  const result = engine.evaluateGrid([
    [{ id: 'gem', multiplier: 999999 }, 'gem', 'gem', 'gem', 'gem'],
    ['gem', 'gem', 'gem', 'gem', 'gem'],
    ['gem', 'gem', 'gem', 'gem', 'gem'],
  ], 1)

  assert.equal(result.wins.find((win) => win.line === 1)?.payout, 2)
})

test('feature configuration fails closed when required Wild or Scatter symbols are missing', () => {
  const regularOnly = [Object.freeze({ id: 'a', label: 'A', weight: 1, multiplier: 1 })]

  assert.throws(
    () => createFeatureSlotEngine({ symbols: regularOnly, expandingWild: true }),
    /wild features require/,
  )
  assert.throws(
    () => createFeatureSlotEngine({ symbols: regularOnly, freeSpins: { triggerCount: 3, spins: 5 } }),
    /scatter\/free-spin features require/,
  )
})

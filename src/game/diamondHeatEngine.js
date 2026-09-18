import { CLASSIC_3X3_PAYLINES, createClassicSlotEngine } from './classicSlotEngine.js'

export const DIAMOND_HEAT_SYMBOLS = Object.freeze([
  Object.freeze({ id: 'hot-diamond', label: '💎', weight: 4, multiplier: 25 }),
  Object.freeze({ id: 'flame', label: '🔥', weight: 8, multiplier: 12 }),
  Object.freeze({ id: 'crown', label: '♛', weight: 13, multiplier: 8 }),
  Object.freeze({ id: 'ruby', label: '♦', weight: 18, multiplier: 5 }),
  Object.freeze({ id: 'bar', label: 'BAR', weight: 24, multiplier: 3 }),
  Object.freeze({ id: 'coin', label: '●', weight: 33, multiplier: 2 }),
])

export const DIAMOND_HEAT_PAYLINES = CLASSIC_3X3_PAYLINES

const engine = createClassicSlotEngine({
  name: 'Diamond Heat',
  symbols: DIAMOND_HEAT_SYMBOLS,
  paylines: DIAMOND_HEAT_PAYLINES,
})

export function createDiamondHeatGrid(rng = Math.random) {
  return engine.createGrid(rng)
}

export function evaluateDiamondHeatGrid(grid, bet) {
  return engine.evaluateGrid(grid, bet)
}

export function resolveDiamondHeat({ bet, rng = Math.random } = {}) {
  return engine.resolve({ bet, rng })
}

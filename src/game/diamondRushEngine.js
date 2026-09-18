import { CLASSIC_3X3_PAYLINES, createClassicSlotEngine } from './classicSlotEngine.js'

export const DIAMOND_RUSH_SYMBOLS = Object.freeze([
  Object.freeze({ id: 'diamond', label: '💎', weight: 6, multiplier: 15 }),
  Object.freeze({ id: 'crown', label: '♛', weight: 10, multiplier: 9 }),
  Object.freeze({ id: 'ruby', label: '♦', weight: 14, multiplier: 7 }),
  Object.freeze({ id: 'gold', label: '●', weight: 18, multiplier: 5 }),
  Object.freeze({ id: 'bar', label: 'BAR', weight: 22, multiplier: 3 }),
  Object.freeze({ id: 'coin', label: '◉', weight: 30, multiplier: 2 }),
])

export const DIAMOND_RUSH_PAYLINES = CLASSIC_3X3_PAYLINES

const engine = createClassicSlotEngine({
  name: 'Diamond Rush',
  symbols: DIAMOND_RUSH_SYMBOLS,
  paylines: DIAMOND_RUSH_PAYLINES,
})

export function createDiamondRushGrid(rng = Math.random) {
  return engine.createGrid(rng)
}

export function evaluateDiamondRushGrid(grid, bet) {
  return engine.evaluateGrid(grid, bet)
}

export function resolveDiamondRush({ bet, rng = Math.random } = {}) {
  return engine.resolve({ bet, rng })
}

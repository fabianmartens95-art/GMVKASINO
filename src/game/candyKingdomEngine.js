import { FEATURE_5X3_PAYLINES, createFeatureSlotEngine } from './featureSlotEngine.js'

export const CANDY_KINGDOM_SYMBOLS = Object.freeze([
  Object.freeze({ id: 'candy-crown', label: '♛', weight: 7, multiplier: 15 }),
  Object.freeze({ id: 'rainbow-cake', label: '▦', weight: 11, multiplier: 10 }),
  Object.freeze({ id: 'jelly-gem', label: '◆', weight: 15, multiplier: 7 }),
  Object.freeze({ id: 'sugar-star', label: '★', weight: 19, multiplier: 5 }),
  Object.freeze({ id: 'gumdrop', label: '●', weight: 25, multiplier: 3 }),
  Object.freeze({ id: 'gummy-wild', label: 'W', weight: 8, multiplier: 18, kind: 'wild' }),
  Object.freeze({ id: 'lollipop-scatter', label: '◎', weight: 5, multiplier: 0, kind: 'scatter' }),
])

export const CANDY_KINGDOM_PAYLINES = FEATURE_5X3_PAYLINES

export const candyKingdomEngine = createFeatureSlotEngine({
  name: 'Candy Kingdom',
  symbols: CANDY_KINGDOM_SYMBOLS,
  paylines: CANDY_KINGDOM_PAYLINES,
  freeSpins: { triggerCount: 3, spins: 8 },
  scatterPayouts: { 3: 2, 4: 5, 5: 10 },
  expandingWild: false,
  stickyWild: false,
  bonusMultiplier: 3,
})

export function createCandyKingdomGrid(rng = Math.random) {
  return candyKingdomEngine.createGrid(rng)
}

export function evaluateCandyKingdomGrid(grid, bet, options) {
  return candyKingdomEngine.evaluateGrid(grid, bet, options)
}

export function resolveCandyKingdom({ bet, rng = Math.random } = {}) {
  return candyKingdomEngine.resolve({ bet, rng })
}

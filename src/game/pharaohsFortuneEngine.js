import { FEATURE_5X3_PAYLINES, createFeatureSlotEngine } from './featureSlotEngine.js'

export const PHARAOHS_FORTUNE_SYMBOLS = Object.freeze([
  Object.freeze({ id: 'gold-ankh', label: '☥', weight: 6, multiplier: 20 }),
  Object.freeze({ id: 'pharaoh', label: '♛', weight: 9, multiplier: 12 }),
  Object.freeze({ id: 'scarab', label: '◆', weight: 13, multiplier: 8 }),
  Object.freeze({ id: 'eye', label: '◉', weight: 17, multiplier: 5 }),
  Object.freeze({ id: 'lotus', label: '✦', weight: 23, multiplier: 3 }),
  Object.freeze({ id: 'sphinx-wild', label: 'W', weight: 8, multiplier: 25, kind: 'wild' }),
  Object.freeze({ id: 'pyramid-scatter', label: '△', weight: 5, multiplier: 0, kind: 'scatter' }),
])

export const PHARAOHS_FORTUNE_PAYLINES = FEATURE_5X3_PAYLINES

export const pharaohsFortuneEngine = createFeatureSlotEngine({
  name: "Pharaoh's Fortune",
  symbols: PHARAOHS_FORTUNE_SYMBOLS,
  paylines: PHARAOHS_FORTUNE_PAYLINES,
  freeSpins: { triggerCount: 3, spins: 6 },
  scatterPayouts: { 3: 2, 4: 5, 5: 12 },
  expandingWild: true,
  stickyWild: false,
  bonusMultiplier: 1.5,
})

export function createPharaohsFortuneGrid(rng = Math.random) {
  return pharaohsFortuneEngine.createGrid(rng)
}

export function evaluatePharaohsFortuneGrid(grid, bet, options) {
  return pharaohsFortuneEngine.evaluateGrid(grid, bet, options)
}

export function resolvePharaohsFortune({ bet, rng = Math.random } = {}) {
  return pharaohsFortuneEngine.resolve({ bet, rng })
}

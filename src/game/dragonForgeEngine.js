import { FEATURE_5X3_PAYLINES, createFeatureSlotEngine } from './featureSlotEngine.js'

export const DRAGON_FORGE_SYMBOLS = Object.freeze([
  Object.freeze({ id: 'dragon', label: 'D', weight: 6, multiplier: 22 }),
  Object.freeze({ id: 'forge-hammer', label: 'T', weight: 10, multiplier: 12 }),
  Object.freeze({ id: 'ruby-shield', label: '◆', weight: 14, multiplier: 8 }),
  Object.freeze({ id: 'flame-rune', label: '✦', weight: 18, multiplier: 5 }),
  Object.freeze({ id: 'iron-coin', label: '●', weight: 24, multiplier: 3 }),
  Object.freeze({ id: 'dragon-wild', label: 'W', weight: 8, multiplier: 24, kind: 'wild' }),
  Object.freeze({ id: 'dragon-egg-scatter', label: 'O', weight: 5, multiplier: 0, kind: 'scatter' }),
])

export const DRAGON_FORGE_PAYLINES = FEATURE_5X3_PAYLINES

export const dragonForgeEngine = createFeatureSlotEngine({
  name: 'Dragon Forge',
  symbols: DRAGON_FORGE_SYMBOLS,
  paylines: DRAGON_FORGE_PAYLINES,
  freeSpins: { triggerCount: 3, spins: 6 },
  scatterPayouts: { 3: 2, 4: 6, 5: 14 },
  expandingWild: true,
  stickyWild: false,
  bonusMultiplier: 2,
})

export function createDragonForgeGrid(rng = Math.random) {
  return dragonForgeEngine.createGrid(rng)
}

export function evaluateDragonForgeGrid(grid, bet, options) {
  return dragonForgeEngine.evaluateGrid(grid, bet, options)
}

export function resolveDragonForge({ bet, rng = Math.random } = {}) {
  return dragonForgeEngine.resolve({ bet, rng })
}

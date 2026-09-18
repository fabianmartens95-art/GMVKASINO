import { CLASSIC_3X3_PAYLINES, createClassicSlotEngine } from './classicSlotEngine.js'

export const LUCKY_BELLS_SYMBOLS = Object.freeze([
  Object.freeze({ id: 'gold-bell', label: '🔔', weight: 6, multiplier: 16 }),
  Object.freeze({ id: 'horseshoe', label: '♧', weight: 10, multiplier: 9 }),
  Object.freeze({ id: 'clover', label: '☘', weight: 14, multiplier: 6 }),
  Object.freeze({ id: 'cherry', label: '🍒', weight: 20, multiplier: 4 }),
  Object.freeze({ id: 'bar', label: 'BAR', weight: 22, multiplier: 3 }),
  Object.freeze({ id: 'lemon', label: '🍋', weight: 28, multiplier: 2 }),
])

export const LUCKY_BELLS_PAYLINES = CLASSIC_3X3_PAYLINES

const engine = createClassicSlotEngine({
  name: 'Lucky Bells',
  symbols: LUCKY_BELLS_SYMBOLS,
  paylines: LUCKY_BELLS_PAYLINES,
})

export function createLuckyBellsGrid(rng = Math.random) {
  return engine.createGrid(rng)
}

export function evaluateLuckyBellsGrid(grid, bet) {
  return engine.evaluateGrid(grid, bet)
}

export function resolveLuckyBells({ bet, rng = Math.random } = {}) {
  return engine.resolve({ bet, rng })
}

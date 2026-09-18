import { CLASSIC_3X3_PAYLINES, createClassicSlotEngine } from './classicSlotEngine.js'

export const ROYAL_SEVENS_SYMBOLS = Object.freeze([
  Object.freeze({ id: 'royal-seven', label: '7', weight: 5, multiplier: 18 }),
  Object.freeze({ id: 'crown', label: '♛', weight: 9, multiplier: 10 }),
  Object.freeze({ id: 'diamond', label: '◆', weight: 14, multiplier: 7 }),
  Object.freeze({ id: 'bar', label: 'BAR', weight: 18, multiplier: 5 }),
  Object.freeze({ id: 'cherry', label: '🍒', weight: 24, multiplier: 3 }),
  Object.freeze({ id: 'lemon', label: '🍋', weight: 30, multiplier: 2 }),
])

export const ROYAL_SEVENS_PAYLINES = CLASSIC_3X3_PAYLINES

const engine = createClassicSlotEngine({
  name: 'Royal Sevens',
  symbols: ROYAL_SEVENS_SYMBOLS,
  paylines: ROYAL_SEVENS_PAYLINES,
})

export function createRoyalSevensGrid(rng = Math.random) {
  return engine.createGrid(rng)
}

export function evaluateRoyalSevensGrid(grid, bet) {
  return engine.evaluateGrid(grid, bet)
}

export function resolveRoyalSevens({ bet, rng = Math.random } = {}) {
  return engine.resolve({ bet, rng })
}

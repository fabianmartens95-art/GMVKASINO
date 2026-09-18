import { CLASSIC_3X3_PAYLINES, createClassicSlotEngine } from './classicSlotEngine.js'

export const NEON_FRUITS_SYMBOLS = Object.freeze([
  Object.freeze({ id: 'strawberry', label: '🍓', weight: 26, multiplier: 2 }),
  Object.freeze({ id: 'lemon', label: '🍋', weight: 24, multiplier: 2.5 }),
  Object.freeze({ id: 'grape', label: '🍇', weight: 20, multiplier: 3 }),
  Object.freeze({ id: 'watermelon', label: '🍉', weight: 16, multiplier: 4 }),
  Object.freeze({ id: 'star', label: '★', weight: 9, multiplier: 7 }),
  Object.freeze({ id: 'neon-seven', label: '7', weight: 5, multiplier: 12 }),
])

export const NEON_FRUITS_PAYLINES = CLASSIC_3X3_PAYLINES

const engine = createClassicSlotEngine({
  name: 'Neon Fruits',
  symbols: NEON_FRUITS_SYMBOLS,
  paylines: NEON_FRUITS_PAYLINES,
})

export function createNeonFruitsGrid(rng = Math.random) {
  return engine.createGrid(rng)
}

export function evaluateNeonFruitsGrid(grid, bet) {
  return engine.evaluateGrid(grid, bet)
}

export function resolveNeonFruits({ bet, rng = Math.random } = {}) {
  return engine.resolve({ bet, rng })
}

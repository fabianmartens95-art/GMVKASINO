import { CLASSIC_3X3_PAYLINES, createClassicSlotEngine } from './classicSlotEngine.js'

export const LUCKY_777_SYMBOLS = Object.freeze([
  Object.freeze({ id: 'triple-seven', label: '7', weight: 5, multiplier: 20 }),
  Object.freeze({ id: 'double-bar', label: 'BAR', weight: 10, multiplier: 10 }),
  Object.freeze({ id: 'bell', label: '🔔', weight: 15, multiplier: 6 }),
  Object.freeze({ id: 'horseshoe', label: '♧', weight: 20, multiplier: 4 }),
  Object.freeze({ id: 'cherry', label: '🍒', weight: 23, multiplier: 3 }),
  Object.freeze({ id: 'lemon', label: '🍋', weight: 27, multiplier: 2 }),
])

export const LUCKY_777_PAYLINES = CLASSIC_3X3_PAYLINES

const engine = createClassicSlotEngine({
  name: 'Lucky 777',
  symbols: LUCKY_777_SYMBOLS,
  paylines: LUCKY_777_PAYLINES,
})

export function createLucky777Grid(rng = Math.random) {
  return engine.createGrid(rng)
}

export function evaluateLucky777Grid(grid, bet) {
  return engine.evaluateGrid(grid, bet)
}

export function resolveLucky777({ bet, rng = Math.random } = {}) {
  return engine.resolve({ bet, rng })
}

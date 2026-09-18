import { CLASSIC_3X3_PAYLINES, createClassicSlotEngine } from './classicSlotEngine.js'

export const FRUIT_FIESTA_SYMBOLS = Object.freeze([
  Object.freeze({ id: 'golden-fruit', label: '★', weight: 5, multiplier: 15 }),
  Object.freeze({ id: 'pineapple', label: '🍍', weight: 10, multiplier: 8 }),
  Object.freeze({ id: 'watermelon', label: '🍉', weight: 14, multiplier: 5 }),
  Object.freeze({ id: 'grape', label: '🍇', weight: 16, multiplier: 4 }),
  Object.freeze({ id: 'strawberry', label: '🍓', weight: 20, multiplier: 3 }),
  Object.freeze({ id: 'orange', label: '🍊', weight: 20, multiplier: 3 }),
])

export const FRUIT_FIESTA_PAYLINES = CLASSIC_3X3_PAYLINES

const engine = createClassicSlotEngine({
  name: 'Fruit Fiesta',
  symbols: FRUIT_FIESTA_SYMBOLS,
  paylines: FRUIT_FIESTA_PAYLINES,
})

export function createFruitFiestaGrid(rng = Math.random) {
  return engine.createGrid(rng)
}

export function evaluateFruitFiestaGrid(grid, bet) {
  return engine.evaluateGrid(grid, bet)
}

export function resolveFruitFiesta({ bet, rng = Math.random } = {}) {
  return engine.resolve({ bet, rng })
}

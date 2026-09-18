import { CLASSIC_3X3_PAYLINES, createClassicSlotEngine } from './classicSlotEngine.js'

export const SYMBOLS = [
  { id: 'seven', label: '7', weight: 7, multiplier: 10 },
  { id: 'diamond', label: '◆', weight: 10, multiplier: 7 },
  { id: 'bar', label: 'BAR', weight: 14, multiplier: 5 },
  { id: 'bell', label: '🔔', weight: 18, multiplier: 4 },
  { id: 'cherry', label: '🍒', weight: 24, multiplier: 3 },
  { id: 'lemon', label: '🍋', weight: 27, multiplier: 2 },
]

export function secureRandom() {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const values = new Uint32Array(1)
    crypto.getRandomValues(values)
    return values[0] / 4294967296
  }

  return Math.random()
}

const goldenVaultEngine = createClassicSlotEngine({
  name: 'Golden Vault',
  symbols: SYMBOLS,
  paylines: CLASSIC_3X3_PAYLINES,
  defaultRng: secureRandom,
  projectGridSymbol: (symbol) => symbol,
  projectWinSymbol: (symbol) => symbol,
  includeWinMultiplier: false,
  validateBet: false,
})

export function createGrid(rng = secureRandom) {
  return goldenVaultEngine.createGrid(rng)
}

export function evaluateGrid(grid, bet) {
  return goldenVaultEngine.evaluateGrid(grid, bet)
}

export function spin(bet, rng = secureRandom) {
  const grid = createGrid(rng)
  return { grid, ...evaluateGrid(grid, bet) }
}

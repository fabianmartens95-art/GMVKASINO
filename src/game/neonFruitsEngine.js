export const NEON_FRUITS_SYMBOLS = Object.freeze([
  Object.freeze({ id: 'strawberry', label: '🍓', weight: 26, multiplier: 2 }),
  Object.freeze({ id: 'lemon', label: '🍋', weight: 24, multiplier: 2.5 }),
  Object.freeze({ id: 'grape', label: '🍇', weight: 20, multiplier: 3 }),
  Object.freeze({ id: 'watermelon', label: '🍉', weight: 16, multiplier: 4 }),
  Object.freeze({ id: 'star', label: '★', weight: 9, multiplier: 7 }),
  Object.freeze({ id: 'neon-seven', label: '7', weight: 5, multiplier: 12 }),
])

export const NEON_FRUITS_PAYLINES = Object.freeze([
  Object.freeze([[0, 0], [0, 1], [0, 2]]),
  Object.freeze([[1, 0], [1, 1], [1, 2]]),
  Object.freeze([[2, 0], [2, 1], [2, 2]]),
  Object.freeze([[0, 0], [1, 1], [2, 2]]),
  Object.freeze([[2, 0], [1, 1], [0, 2]]),
])

function pickSymbol(rng) {
  const totalWeight = NEON_FRUITS_SYMBOLS.reduce((sum, symbol) => sum + symbol.weight, 0)
  let cursor = rng() * totalWeight
  for (const symbol of NEON_FRUITS_SYMBOLS) {
    cursor -= symbol.weight
    if (cursor < 0) return symbol
  }
  return NEON_FRUITS_SYMBOLS[NEON_FRUITS_SYMBOLS.length - 1]
}

export function createNeonFruitsGrid(rng = Math.random) {
  if (typeof rng !== 'function') throw new TypeError('rng must be a function')
  return Array.from(
    { length: 3 },
    () => Array.from({ length: 3 }, () => pickSymbol(rng)),
  )
}

export function evaluateNeonFruitsGrid(grid, bet) {
  if (!Array.isArray(grid) || grid.length !== 3 || grid.some((row) => !Array.isArray(row) || row.length !== 3)) {
    throw new TypeError('Neon Fruits grid must be 3x3')
  }
  if (!Number.isFinite(bet) || bet <= 0) throw new TypeError('bet must be a positive finite number')

  const wins = []
  for (const [index, line] of NEON_FRUITS_PAYLINES.entries()) {
    const symbols = line.map(([row, reel]) => grid[row][reel])
    const first = symbols[0]
    if (!first || symbols.some((symbol) => !symbol || symbol.id !== first.id)) continue

    wins.push({
      line: index + 1,
      symbol: { id: first.id, label: first.label },
      multiplier: first.multiplier,
      payout: Number((bet * first.multiplier).toFixed(2)),
    })
  }

  return {
    wins,
    totalWin: Number(wins.reduce((sum, win) => sum + win.payout, 0).toFixed(2)),
  }
}

export function resolveNeonFruits({ bet, rng = Math.random } = {}) {
  const grid = createNeonFruitsGrid(rng)
  const result = evaluateNeonFruitsGrid(grid, bet)
  return {
    grid: grid.map((row) => row.map((symbol) => ({ id: symbol.id, label: symbol.label }))),
    ...result,
  }
}

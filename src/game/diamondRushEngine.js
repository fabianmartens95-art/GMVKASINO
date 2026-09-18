export const DIAMOND_RUSH_SYMBOLS = Object.freeze([
  Object.freeze({ id: 'diamond', label: '💎', weight: 6, multiplier: 15 }),
  Object.freeze({ id: 'crown', label: '♛', weight: 10, multiplier: 9 }),
  Object.freeze({ id: 'ruby', label: '♦', weight: 14, multiplier: 7 }),
  Object.freeze({ id: 'gold', label: '●', weight: 18, multiplier: 5 }),
  Object.freeze({ id: 'bar', label: 'BAR', weight: 22, multiplier: 3 }),
  Object.freeze({ id: 'coin', label: '◉', weight: 30, multiplier: 2 }),
])

export const DIAMOND_RUSH_PAYLINES = Object.freeze([
  Object.freeze([[0, 0], [0, 1], [0, 2]]),
  Object.freeze([[1, 0], [1, 1], [1, 2]]),
  Object.freeze([[2, 0], [2, 1], [2, 2]]),
  Object.freeze([[0, 0], [1, 1], [2, 2]]),
  Object.freeze([[2, 0], [1, 1], [0, 2]]),
])

function pickSymbol(rng) {
  const totalWeight = DIAMOND_RUSH_SYMBOLS.reduce((sum, symbol) => sum + symbol.weight, 0)
  let cursor = rng() * totalWeight
  for (const symbol of DIAMOND_RUSH_SYMBOLS) {
    cursor -= symbol.weight
    if (cursor < 0) return symbol
  }
  return DIAMOND_RUSH_SYMBOLS[DIAMOND_RUSH_SYMBOLS.length - 1]
}

export function createDiamondRushGrid(rng = Math.random) {
  if (typeof rng !== 'function') throw new TypeError('rng must be a function')
  return Array.from(
    { length: 3 },
    () => Array.from({ length: 3 }, () => pickSymbol(rng)),
  )
}

export function evaluateDiamondRushGrid(grid, bet) {
  if (!Array.isArray(grid) || grid.length !== 3 || grid.some((row) => !Array.isArray(row) || row.length !== 3)) {
    throw new TypeError('Diamond Rush grid must be 3x3')
  }
  if (!Number.isFinite(bet) || bet <= 0) throw new TypeError('bet must be a positive finite number')

  const wins = []
  for (const [index, line] of DIAMOND_RUSH_PAYLINES.entries()) {
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

export function resolveDiamondRush({ bet, rng = Math.random } = {}) {
  const grid = createDiamondRushGrid(rng)
  const result = evaluateDiamondRushGrid(grid, bet)
  return {
    grid: grid.map((row) => row.map((symbol) => ({ id: symbol.id, label: symbol.label }))),
    ...result,
  }
}

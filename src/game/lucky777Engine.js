export const LUCKY_777_SYMBOLS = Object.freeze([
  Object.freeze({ id: 'triple-seven', label: '7', weight: 5, multiplier: 20 }),
  Object.freeze({ id: 'double-bar', label: 'BAR', weight: 10, multiplier: 10 }),
  Object.freeze({ id: 'bell', label: '🔔', weight: 15, multiplier: 6 }),
  Object.freeze({ id: 'horseshoe', label: '♧', weight: 20, multiplier: 4 }),
  Object.freeze({ id: 'cherry', label: '🍒', weight: 23, multiplier: 3 }),
  Object.freeze({ id: 'lemon', label: '🍋', weight: 27, multiplier: 2 }),
])

export const LUCKY_777_PAYLINES = Object.freeze([
  Object.freeze([[0, 0], [0, 1], [0, 2]]),
  Object.freeze([[1, 0], [1, 1], [1, 2]]),
  Object.freeze([[2, 0], [2, 1], [2, 2]]),
  Object.freeze([[0, 0], [1, 1], [2, 2]]),
  Object.freeze([[2, 0], [1, 1], [0, 2]]),
])

function pickSymbol(rng) {
  const totalWeight = LUCKY_777_SYMBOLS.reduce((sum, symbol) => sum + symbol.weight, 0)
  let cursor = rng() * totalWeight
  for (const symbol of LUCKY_777_SYMBOLS) {
    cursor -= symbol.weight
    if (cursor < 0) return symbol
  }
  return LUCKY_777_SYMBOLS[LUCKY_777_SYMBOLS.length - 1]
}

export function createLucky777Grid(rng = Math.random) {
  if (typeof rng !== 'function') throw new TypeError('rng must be a function')
  return Array.from(
    { length: 3 },
    () => Array.from({ length: 3 }, () => pickSymbol(rng)),
  )
}

export function evaluateLucky777Grid(grid, bet) {
  if (!Array.isArray(grid) || grid.length !== 3 || grid.some((row) => !Array.isArray(row) || row.length !== 3)) {
    throw new TypeError('Lucky 777 grid must be 3x3')
  }
  if (!Number.isFinite(bet) || bet <= 0) throw new TypeError('bet must be a positive finite number')

  const wins = []
  for (const [index, line] of LUCKY_777_PAYLINES.entries()) {
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

export function resolveLucky777({ bet, rng = Math.random } = {}) {
  const grid = createLucky777Grid(rng)
  const result = evaluateLucky777Grid(grid, bet)
  return {
    grid: grid.map((row) => row.map((symbol) => ({ id: symbol.id, label: symbol.label }))),
    ...result,
  }
}

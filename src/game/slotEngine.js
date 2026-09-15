export const SYMBOLS = [
  { id: 'seven', label: '7', weight: 7, multiplier: 10 },
  { id: 'diamond', label: '◆', weight: 10, multiplier: 7 },
  { id: 'bar', label: 'BAR', weight: 14, multiplier: 5 },
  { id: 'bell', label: '🔔', weight: 18, multiplier: 4 },
  { id: 'cherry', label: '🍒', weight: 24, multiplier: 3 },
  { id: 'lemon', label: '🍋', weight: 27, multiplier: 2 },
]

const PAYLINES = [
  [[0, 0], [0, 1], [0, 2]],
  [[1, 0], [1, 1], [1, 2]],
  [[2, 0], [2, 1], [2, 2]],
  [[0, 0], [1, 1], [2, 2]],
  [[2, 0], [1, 1], [0, 2]],
]

export function secureRandom() {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const values = new Uint32Array(1)
    crypto.getRandomValues(values)
    return values[0] / 4294967296
  }

  return Math.random()
}

function pickSymbol(rng = secureRandom) {
  const totalWeight = SYMBOLS.reduce((sum, symbol) => sum + symbol.weight, 0)
  let cursor = rng() * totalWeight

  for (const symbol of SYMBOLS) {
    cursor -= symbol.weight
    if (cursor < 0) return symbol
  }

  return SYMBOLS[SYMBOLS.length - 1]
}

export function createGrid(rng = secureRandom) {
  return Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => pickSymbol(rng)))
}

export function evaluateGrid(grid, bet) {
  const wins = []

  PAYLINES.forEach((line, lineIndex) => {
    const symbols = line.map(([row, reel]) => grid[row][reel])
    const first = symbols[0]
    const matched = symbols.every((symbol) => symbol.id === first.id)

    if (matched) {
      wins.push({
        line: lineIndex + 1,
        symbol: first,
        payout: Number((bet * first.multiplier).toFixed(2)),
      })
    }
  })

  return {
    wins,
    totalWin: Number(wins.reduce((sum, win) => sum + win.payout, 0).toFixed(2)),
  }
}

export function spin(bet, rng = secureRandom) {
  const grid = createGrid(rng)
  return { grid, ...evaluateGrid(grid, bet) }
}

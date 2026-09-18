export const CLASSIC_3X3_PAYLINES = Object.freeze([
  Object.freeze([[0, 0], [0, 1], [0, 2]]),
  Object.freeze([[1, 0], [1, 1], [1, 2]]),
  Object.freeze([[2, 0], [2, 1], [2, 2]]),
  Object.freeze([[0, 0], [1, 1], [2, 2]]),
  Object.freeze([[2, 0], [1, 1], [0, 2]]),
])

function displaySymbol(symbol) {
  return { id: symbol.id, label: symbol.label }
}

function assertSymbols(symbols) {
  if (!Array.isArray(symbols) || symbols.length === 0) {
    throw new TypeError('classic slot symbols must be a non-empty array')
  }

  for (const symbol of symbols) {
    if (!symbol || typeof symbol.id !== 'string' || !symbol.id) {
      throw new TypeError('classic slot symbols require a stable id')
    }
    if (!Number.isFinite(symbol.weight) || symbol.weight <= 0) {
      throw new TypeError(`classic slot symbol ${symbol.id} requires a positive finite weight`)
    }
    if (!Number.isFinite(symbol.multiplier) || symbol.multiplier < 0) {
      throw new TypeError(`classic slot symbol ${symbol.id} requires a finite non-negative multiplier`)
    }
  }
}

function assertPaylines(paylines, rows, reels) {
  if (!Array.isArray(paylines) || paylines.length === 0) {
    throw new TypeError('classic slot paylines must be a non-empty array')
  }

  for (const line of paylines) {
    if (!Array.isArray(line) || line.length !== reels) {
      throw new TypeError(`classic slot paylines must contain exactly ${reels} positions`)
    }

    for (const position of line) {
      if (!Array.isArray(position) || position.length !== 2) {
        throw new TypeError('classic slot payline positions must be [row, reel] tuples')
      }

      const [row, reel] = position
      if (
        !Number.isInteger(row)
        || row < 0
        || row >= rows
        || !Number.isInteger(reel)
        || reel < 0
        || reel >= reels
      ) {
        throw new TypeError('classic slot payline position is outside the configured grid')
      }
    }
  }
}

export function createClassicSlotEngine({
  name = 'Classic Slot',
  symbols,
  paylines = CLASSIC_3X3_PAYLINES,
  rows = 3,
  reels = 3,
  defaultRng = Math.random,
  projectGridSymbol = displaySymbol,
  projectWinSymbol = displaySymbol,
  includeWinMultiplier = true,
  validateBet = true,
} = {}) {
  if (!Number.isInteger(rows) || rows < 1 || !Number.isInteger(reels) || reels < 1) {
    throw new TypeError('classic slot rows and reels must be positive integers')
  }
  if (typeof defaultRng !== 'function') {
    throw new TypeError('classic slot defaultRng must be a function')
  }
  if (typeof projectGridSymbol !== 'function' || typeof projectWinSymbol !== 'function') {
    throw new TypeError('classic slot symbol projectors must be functions')
  }

  assertSymbols(symbols)
  assertPaylines(paylines, rows, reels)

  const totalWeight = symbols.reduce((sum, symbol) => sum + symbol.weight, 0)

  function pickSymbol(rng) {
    let cursor = rng() * totalWeight
    for (const symbol of symbols) {
      cursor -= symbol.weight
      if (cursor < 0) return symbol
    }
    return symbols[symbols.length - 1]
  }

  function createGrid(rng = defaultRng) {
    if (typeof rng !== 'function') throw new TypeError('rng must be a function')

    return Array.from(
      { length: rows },
      () => Array.from({ length: reels }, () => pickSymbol(rng)),
    )
  }

  function evaluateGrid(grid, bet) {
    if (
      !Array.isArray(grid)
      || grid.length !== rows
      || grid.some((row) => !Array.isArray(row) || row.length !== reels)
    ) {
      throw new TypeError(`${name} grid must be ${rows}x${reels}`)
    }

    if (validateBet && (!Number.isFinite(bet) || bet <= 0)) {
      throw new TypeError('bet must be a positive finite number')
    }

    const wins = []
    for (const [index, line] of paylines.entries()) {
      const lineSymbols = line.map(([row, reel]) => grid[row][reel])
      const first = lineSymbols[0]
      if (!first || lineSymbols.some((symbol) => !symbol || symbol.id !== first.id)) continue

      const win = {
        line: index + 1,
        symbol: projectWinSymbol(first),
        payout: Number((bet * first.multiplier).toFixed(2)),
      }
      if (includeWinMultiplier) win.multiplier = first.multiplier
      wins.push(win)
    }

    return {
      wins,
      totalWin: Number(wins.reduce((sum, win) => sum + win.payout, 0).toFixed(2)),
    }
  }

  function resolve({ bet, rng = defaultRng } = {}) {
    const grid = createGrid(rng)
    return {
      grid: grid.map((row) => row.map((symbol) => projectGridSymbol(symbol))),
      ...evaluateGrid(grid, bet),
    }
  }

  return Object.freeze({
    symbols,
    paylines,
    rows,
    reels,
    createGrid,
    evaluateGrid,
    resolve,
  })
}

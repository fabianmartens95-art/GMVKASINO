export const FEATURE_5X3_PAYLINES = Object.freeze([
  Object.freeze([[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]]),
  Object.freeze([[1, 0], [1, 1], [1, 2], [1, 3], [1, 4]]),
  Object.freeze([[2, 0], [2, 1], [2, 2], [2, 3], [2, 4]]),
  Object.freeze([[0, 0], [1, 1], [2, 2], [1, 3], [0, 4]]),
  Object.freeze([[2, 0], [1, 1], [0, 2], [1, 3], [2, 4]]),
  Object.freeze([[0, 0], [0, 1], [1, 2], [0, 3], [0, 4]]),
  Object.freeze([[2, 0], [2, 1], [1, 2], [2, 3], [2, 4]]),
  Object.freeze([[1, 0], [0, 1], [0, 2], [0, 3], [1, 4]]),
  Object.freeze([[1, 0], [2, 1], [2, 2], [2, 3], [1, 4]]),
  Object.freeze([[0, 0], [1, 1], [1, 2], [1, 3], [0, 4]]),
])

function roundMoney(value) {
  return Number(Number(value).toFixed(2))
}

function displaySymbol(symbol) {
  return {
    id: symbol.id,
    label: symbol.label,
    kind: symbol.kind || 'regular',
  }
}

function assertSymbols(symbols) {
  if (!Array.isArray(symbols) || symbols.length === 0) {
    throw new TypeError('feature slot symbols must be a non-empty array')
  }

  const ids = new Set()
  let wildCount = 0
  let scatterCount = 0

  for (const symbol of symbols) {
    if (!symbol || typeof symbol.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(symbol.id)) {
      throw new TypeError('feature slot symbols require a stable lowercase id')
    }
    if (ids.has(symbol.id)) throw new TypeError(`duplicate feature slot symbol id: ${symbol.id}`)
    ids.add(symbol.id)

    if (typeof symbol.label !== 'string' || !symbol.label) {
      throw new TypeError(`feature slot symbol ${symbol.id} requires a label`)
    }
    if (!Number.isFinite(symbol.weight) || symbol.weight <= 0) {
      throw new TypeError(`feature slot symbol ${symbol.id} requires a positive finite weight`)
    }
    if (!Number.isFinite(symbol.multiplier) || symbol.multiplier < 0) {
      throw new TypeError(`feature slot symbol ${symbol.id} requires a finite non-negative multiplier`)
    }

    const kind = symbol.kind || 'regular'
    if (!['regular', 'wild', 'scatter'].includes(kind)) {
      throw new TypeError(`feature slot symbol ${symbol.id} has an unsupported kind`)
    }
    if (kind === 'wild') wildCount += 1
    if (kind === 'scatter') scatterCount += 1
  }

  if (wildCount > 1) throw new TypeError('Feature Slot Template V1 supports at most one wild symbol')
  if (scatterCount > 1) throw new TypeError('Feature Slot Template V1 supports at most one scatter symbol')
}

function assertPaylines(paylines, rows, reels) {
  if (!Array.isArray(paylines) || paylines.length === 0) {
    throw new TypeError('feature slot paylines must be a non-empty array')
  }

  for (const line of paylines) {
    if (!Array.isArray(line) || line.length !== reels) {
      throw new TypeError(`feature slot paylines must contain exactly ${reels} positions`)
    }
    for (const position of line) {
      if (!Array.isArray(position) || position.length !== 2) {
        throw new TypeError('feature slot payline positions must be [row, reel] tuples')
      }
      const [row, reel] = position
      if (
        !Number.isInteger(row) || row < 0 || row >= rows
        || !Number.isInteger(reel) || reel < 0 || reel >= reels
      ) {
        throw new TypeError('feature slot payline position is outside the configured grid')
      }
    }
  }
}

function normalizeFreeSpins(value) {
  if (value == null) return null
  const triggerCount = value.triggerCount ?? 3
  const spins = value.spins ?? 6
  if (!Number.isInteger(triggerCount) || triggerCount < 1) {
    throw new TypeError('freeSpins.triggerCount must be a positive integer')
  }
  if (!Number.isInteger(spins) || spins < 1 || spins > 50) {
    throw new TypeError('freeSpins.spins must be an integer between 1 and 50')
  }
  return Object.freeze({ triggerCount, spins })
}

function normalizeScatterPayouts(value = {}) {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('scatterPayouts must be an object')
  }
  const entries = Object.entries(value).map(([count, multiplier]) => {
    const parsedCount = Number(count)
    if (!Number.isInteger(parsedCount) || parsedCount < 1) {
      throw new TypeError('scatter payout counts must be positive integers')
    }
    if (!Number.isFinite(multiplier) || multiplier < 0) {
      throw new TypeError('scatter payout multipliers must be finite and non-negative')
    }
    return [parsedCount, multiplier]
  })
  return Object.freeze(Object.fromEntries(entries))
}

function scatterMultiplierFor(count, table) {
  let selectedCount = -1
  let selected = 0
  for (const [thresholdText, multiplier] of Object.entries(table)) {
    const threshold = Number(thresholdText)
    if (threshold <= count && threshold > selectedCount) {
      selectedCount = threshold
      selected = multiplier
    }
  }
  return selected
}

export function createFeatureSlotEngine({
  name = 'Feature Slot',
  symbols,
  paylines = FEATURE_5X3_PAYLINES,
  rows = 3,
  reels = 5,
  freeSpins = null,
  scatterPayouts = {},
  expandingWild = false,
  stickyWild = false,
  bonusMultiplier = 1,
  defaultRng = Math.random,
  projectSymbol = displaySymbol,
} = {}) {
  if (!Number.isInteger(rows) || rows < 1 || !Number.isInteger(reels) || reels < 1) {
    throw new TypeError('feature slot rows and reels must be positive integers')
  }
  if (typeof defaultRng !== 'function') throw new TypeError('feature slot defaultRng must be a function')
  if (typeof projectSymbol !== 'function') throw new TypeError('feature slot projectSymbol must be a function')
  if (typeof expandingWild !== 'boolean' || typeof stickyWild !== 'boolean') {
    throw new TypeError('feature slot wild feature flags must be booleans')
  }
  if (!Number.isFinite(bonusMultiplier) || bonusMultiplier <= 0) {
    throw new TypeError('bonusMultiplier must be a positive finite number')
  }

  assertSymbols(symbols)
  assertPaylines(paylines, rows, reels)

  const freeSpinConfig = normalizeFreeSpins(freeSpins)
  const scatterTable = normalizeScatterPayouts(scatterPayouts)
  const symbolMap = new Map(symbols.map((symbol) => [symbol.id, Object.freeze({
    ...symbol,
    kind: symbol.kind || 'regular',
  })]))
  const normalizedSymbols = Object.freeze([...symbolMap.values()])
  const wild = normalizedSymbols.find((symbol) => symbol.kind === 'wild') || null
  const scatter = normalizedSymbols.find((symbol) => symbol.kind === 'scatter') || null

  if ((expandingWild || stickyWild) && !wild) {
    throw new TypeError('wild features require one configured wild symbol')
  }
  if ((freeSpinConfig || Object.keys(scatterTable).length > 0) && !scatter) {
    throw new TypeError('scatter/free-spin features require one configured scatter symbol')
  }

  const totalWeight = normalizedSymbols.reduce((sum, symbol) => sum + symbol.weight, 0)

  function pickSymbol(rng) {
    let cursor = rng() * totalWeight
    for (const symbol of normalizedSymbols) {
      cursor -= symbol.weight
      if (cursor < 0) return symbol
    }
    return normalizedSymbols[normalizedSymbols.length - 1]
  }

  function createGrid(rng = defaultRng) {
    if (typeof rng !== 'function') throw new TypeError('rng must be a function')
    return Array.from(
      { length: rows },
      () => Array.from({ length: reels }, () => pickSymbol(rng)),
    )
  }

  function normalizeGrid(grid) {
    if (
      !Array.isArray(grid)
      || grid.length !== rows
      || grid.some((row) => !Array.isArray(row) || row.length !== reels)
    ) {
      throw new TypeError(`${name} grid must be ${rows}x${reels}`)
    }

    return grid.map((row) => row.map((cell) => {
      const id = typeof cell === 'string' ? cell : cell?.id
      const symbol = symbolMap.get(id)
      if (!symbol) throw new TypeError(`${name} grid contains an unknown symbol`)
      return symbol
    }))
  }

  function applyStickyWilds(grid, positions) {
    if (!stickyWild || !wild || positions.length === 0) return grid.map((row) => [...row])
    const next = grid.map((row) => [...row])
    for (const position of positions) {
      if (!Array.isArray(position) || position.length !== 2) continue
      const [row, reel] = position
      if (!Number.isInteger(row) || !Number.isInteger(reel)) continue
      if (row < 0 || row >= rows || reel < 0 || reel >= reels) continue
      if (next[row][reel].kind === 'scatter') continue
      next[row][reel] = wild
    }
    return next
  }

  function applyExpandingWilds(grid) {
    if (!expandingWild || !wild) return grid
    const next = grid.map((row) => [...row])
    for (let reel = 0; reel < reels; reel += 1) {
      const hasWild = next.some((row) => row[reel].kind === 'wild')
      if (!hasWild) continue
      for (let row = 0; row < rows; row += 1) {
        if (next[row][reel].kind !== 'scatter') next[row][reel] = wild
      }
    }
    return next
  }

  function collectWildPositions(grid) {
    if (!stickyWild) return []
    const positions = []
    for (let row = 0; row < rows; row += 1) {
      for (let reel = 0; reel < reels; reel += 1) {
        if (grid[row][reel].kind === 'wild') positions.push(Object.freeze([row, reel]))
      }
    }
    return positions
  }

  function evaluateLines(grid, bet, spinMultiplier) {
    const wins = []

    for (const [index, line] of paylines.entries()) {
      const lineSymbols = line.map(([row, reel]) => grid[row][reel])
      if (lineSymbols.some((symbol) => symbol.kind === 'scatter')) continue

      const target = lineSymbols.find((symbol) => symbol.kind !== 'wild') || wild
      if (!target) continue
      const matches = lineSymbols.every((symbol) => (
        symbol.kind === 'wild' || symbol.id === target.id
      ))
      if (!matches) continue

      wins.push({
        line: index + 1,
        symbol: projectSymbol(target),
        multiplier: target.multiplier,
        payout: roundMoney(bet * target.multiplier * spinMultiplier),
      })
    }

    return wins
  }

  function evaluateGrid(grid, bet, {
    multiplier = 1,
    stickyPositions = [],
  } = {}) {
    if (!Number.isFinite(bet) || bet <= 0) throw new TypeError('bet must be a positive finite number')
    if (!Number.isFinite(multiplier) || multiplier <= 0) {
      throw new TypeError('spin multiplier must be a positive finite number')
    }

    const normalized = normalizeGrid(grid)
    const scatterCount = scatter
      ? normalized.flat().filter((symbol) => symbol.kind === 'scatter').length
      : 0

    let processed = applyStickyWilds(normalized, stickyPositions)
    processed = applyExpandingWilds(processed)

    const wins = evaluateLines(processed, bet, multiplier)
    const scatterMultiplier = scatterMultiplierFor(scatterCount, scatterTable)
    const scatterPayout = roundMoney(bet * scatterMultiplier * multiplier)
    const totalWin = roundMoney(
      wins.reduce((sum, win) => sum + win.payout, 0) + scatterPayout,
    )

    return {
      grid: processed,
      wins,
      scatter: {
        count: scatterCount,
        multiplier: scatterMultiplier,
        payout: scatterPayout,
      },
      totalWin,
      stickyWildPositions: collectWildPositions(processed),
    }
  }

  function projectEvaluation(evaluation) {
    return {
      grid: evaluation.grid.map((row) => row.map((symbol) => projectSymbol(symbol))),
      wins: evaluation.wins,
      scatter: evaluation.scatter,
      totalWin: evaluation.totalWin,
      stickyWildPositions: evaluation.stickyWildPositions.map(([row, reel]) => [row, reel]),
    }
  }

  function resolve({ bet, rng = defaultRng } = {}) {
    if (typeof rng !== 'function') throw new TypeError('rng must be a function')

    const base = evaluateGrid(createGrid(rng), bet)
    const shouldAwardFreeSpins = Boolean(
      freeSpinConfig && base.scatter.count >= freeSpinConfig.triggerCount
    )
    const freeSpinsAwarded = shouldAwardFreeSpins ? freeSpinConfig.spins : 0
    const bonusSpins = []
    let stickyPositions = []

    for (let index = 0; index < freeSpinsAwarded; index += 1) {
      const bonus = evaluateGrid(createGrid(rng), bet, {
        multiplier: bonusMultiplier,
        stickyPositions,
      })
      if (stickyWild) stickyPositions = bonus.stickyWildPositions
      bonusSpins.push({
        index: index + 1,
        ...projectEvaluation(bonus),
      })
    }

    const bonusWin = roundMoney(bonusSpins.reduce((sum, spin) => sum + spin.totalWin, 0))
    const totalWin = roundMoney(base.totalWin + bonusWin)

    return {
      ...projectEvaluation(base),
      baseWin: base.totalWin,
      bonusWin,
      totalWin,
      features: {
        freeSpinsAwarded,
        freeSpinsPlayed: bonusSpins.length,
        bonusMultiplier,
        expandingWild,
        stickyWild,
        retriggerSupported: false,
      },
      bonusSpins,
    }
  }

  return Object.freeze({
    symbols: normalizedSymbols,
    paylines,
    rows,
    reels,
    freeSpins: freeSpinConfig,
    scatterPayouts: scatterTable,
    expandingWild,
    stickyWild,
    bonusMultiplier,
    createGrid,
    evaluateGrid,
    resolve,
  })
}

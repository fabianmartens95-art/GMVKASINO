import test from 'node:test'
import assert from 'node:assert/strict'
import { createGamePreviewGrid, getGamePresentation } from '../src/game/clientGamePresentation.js'

const CASES = [
  ['royal-sevens', 'vault', '7'],
  ['diamond-heat', 'diamond', '💎'],
  ['lucky-bells', 'lucky', '🔔'],
  ['fruit-fiesta', 'neon', '★'],
]

for (const [gameId, expectedTheme, expectedFirstSymbol] of CASES) {
  test(`${gameId} has explicit client presentation metadata`, () => {
    const presentation = getGamePresentation(gameId)
    assert.equal(presentation.theme, expectedTheme)
    assert.equal(presentation.preview.length, 9)
    assert.equal(presentation.preview[0], expectedFirstSymbol)

    const grid = createGamePreviewGrid(gameId)
    assert.equal(grid.length, 3)
    assert.equal(grid[0].length, 3)
    assert.equal(grid[0][0].label, expectedFirstSymbol)
  })
}

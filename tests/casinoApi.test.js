import test from 'node:test'
import assert from 'node:assert/strict'
import { getGames, spinDemo } from '../src/api/casinoApi.js'

test('catalog exposes one playable game', async () => {
  const games = await getGames()
  assert.equal(games.filter((game) => game.status === 'playable').length, 1)
  assert.equal(games.find((game) => game.status === 'playable').id, 'golden-vault')
})

test('demo API validates game availability and bet', async () => {
  await assert.rejects(() => spinDemo({ gameId: 'missing', bet: 1 }), /not available/)
  await assert.rejects(() => spinDemo({ gameId: 'golden-vault', bet: 0 }), /positive number/)
})

test('demo API can run deterministic spins', async () => {
  const result = await spinDemo({ gameId: 'golden-vault', bet: 1, rng: () => 0 })
  assert.equal(result.totalWin, 50)
})

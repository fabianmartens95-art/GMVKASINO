import test from 'node:test'
import assert from 'node:assert/strict'
import { selectPlayableGamesForGate } from '../scripts/staging-money-flow.mjs'

test('staging game gate selects every playable game with its first allowed DEMO bet', () => {
  const selected = selectPlayableGamesForGate({
    games: [
      { id: 'golden-vault', status: 'playable', allowedBets: [1, 2, 5] },
      { id: 'neon-fruits', status: 'playable', allowedBets: [2, 5] },
      { id: 'coming-soon', status: 'coming-soon', allowedBets: [1] },
      { id: 'broken', status: 'playable', allowedBets: [] },
      { id: 'diamond-rush', status: 'playable', allowedBets: [1, 10] },
    ],
  })

  assert.deepEqual(selected, [
    { id: 'golden-vault', bet: 1 },
    { id: 'neon-fruits', bet: 2 },
    { id: 'diamond-rush', bet: 1 },
  ])
})

test('staging game gate fails closed when no certifiable playable game exists', () => {
  assert.throws(
    () => selectPlayableGamesForGate({
      games: [
        { id: 'future-game', status: 'coming-soon', allowedBets: [1] },
        { id: 'missing-bets', status: 'playable', allowedBets: [] },
      ],
    }),
    /No playable demo game/,
  )
})

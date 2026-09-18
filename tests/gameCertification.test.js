import test from 'node:test'
import assert from 'node:assert/strict'
import { GAMES } from '../src/config/games.js'
import { createDefaultGameRegistry, GameRegistry } from '../server/gameRegistry.js'
import { certifyGame, certifyGameCatalog } from '../server/gameCertification.js'

test('current DEMO catalog passes shared certification without changing game status', async () => {
  const originalStatuses = GAMES.map((game) => [game.id, game.status])
  const report = await certifyGameCatalog({
    games: GAMES,
    registry: createDefaultGameRegistry(),
    samples: 40,
  })

  assert.equal(report.ok, true)
  assert.equal(report.totalGames, 4)
  assert.equal(report.failedGames, 0)
  assert.deepEqual(GAMES.map((game) => [game.id, game.status]), originalStatuses)
  assert.ok(report.results.every((result) => result.samples === 40))
})

test('certification fails closed on missing adapters and invalid payouts', async () => {
  const missing = await certifyGame({
    game: { id: 'missing-game', status: 'coming-soon', allowedBets: [1] },
    registry: new GameRegistry([]),
    samples: 2,
  })
  assert.equal(missing.ok, false)
  assert.equal(missing.failures[0].code, 'ADAPTER_MISSING')

  const brokenRegistry = new GameRegistry([{
    id: 'broken-game',
    resolve() {
      return { totalWin: 1.001, balance: 999999 }
    },
  }])
  const broken = await certifyGame({
    game: { id: 'broken-game', status: 'coming-soon', allowedBets: [1] },
    registry: brokenRegistry,
    samples: 2,
  })
  assert.equal(broken.ok, false)
  assert.equal(broken.failures[0].code, 'ADAPTER_RESOLUTION_FAILED')
})

test('certification requires valid DEMO bet metadata', async () => {
  const registry = new GameRegistry([{
    id: 'metadata-game',
    resolve() {
      return { totalWin: 0 }
    },
  }])
  const report = await certifyGame({
    game: { id: 'metadata-game', status: 'coming-soon', allowedBets: [] },
    registry,
    samples: 1,
  })
  assert.equal(report.ok, false)
  assert.ok(report.failures.some((item) => item.code === 'ALLOWED_BETS_MISSING'))
})

import { GAMES } from '../src/config/games.js'
import { createDefaultGameRegistry } from '../server/gameRegistry.js'
import { certifyGameCatalog } from '../server/gameCertification.js'

const samples = process.env.GAME_CERTIFICATION_SAMPLES
  ? Number(process.env.GAME_CERTIFICATION_SAMPLES)
  : 250

const report = await certifyGameCatalog({
  games: GAMES,
  registry: createDefaultGameRegistry(),
  samples,
})

console.log(JSON.stringify(report, null, 2))
if (!report.ok) process.exitCode = 1

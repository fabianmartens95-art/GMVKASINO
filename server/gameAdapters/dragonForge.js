import { resolveDragonForge } from '../../src/game/dragonForgeEngine.js'

export const dragonForgeGameAdapter = Object.freeze({
  id: 'dragon-forge',
  resolve({ bet, rng }) {
    return resolveDragonForge({ bet, rng })
  },
})

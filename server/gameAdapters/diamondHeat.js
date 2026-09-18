import { resolveDiamondHeat } from '../../src/game/diamondHeatEngine.js'

export const diamondHeatGameAdapter = Object.freeze({
  id: 'diamond-heat',
  resolve({ bet, rng }) {
    return resolveDiamondHeat({ bet, rng })
  },
})

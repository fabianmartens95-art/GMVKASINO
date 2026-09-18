import { resolveDiamondRush } from '../../src/game/diamondRushEngine.js'

export const diamondRushGameAdapter = Object.freeze({
  id: 'diamond-rush',
  resolve({ bet, rng }) {
    return resolveDiamondRush({ bet, rng })
  },
})

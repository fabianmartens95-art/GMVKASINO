import { resolvePharaohsFortune } from '../../src/game/pharaohsFortuneEngine.js'

export const pharaohsFortuneGameAdapter = Object.freeze({
  id: 'pharaohs-fortune',
  resolve({ bet, rng }) {
    return resolvePharaohsFortune({ bet, rng })
  },
})

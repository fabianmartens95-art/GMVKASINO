import { resolveRoyalSevens } from '../../src/game/royalSevensEngine.js'

export const royalSevensGameAdapter = Object.freeze({
  id: 'royal-sevens',
  resolve({ bet, rng }) {
    return resolveRoyalSevens({ bet, rng })
  },
})

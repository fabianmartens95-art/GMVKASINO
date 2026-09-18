import { resolveCandyKingdom } from '../../src/game/candyKingdomEngine.js'

export const candyKingdomGameAdapter = Object.freeze({
  id: 'candy-kingdom',
  resolve({ bet, rng }) {
    return resolveCandyKingdom({ bet, rng })
  },
})

import { resolveNeonFruits } from '../../src/game/neonFruitsEngine.js'

export const neonFruitsGameAdapter = Object.freeze({
  id: 'neon-fruits',
  resolve({ bet, rng }) {
    return resolveNeonFruits({ bet, rng })
  },
})

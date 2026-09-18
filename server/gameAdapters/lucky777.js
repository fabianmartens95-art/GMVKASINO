import { resolveLucky777 } from '../../src/game/lucky777Engine.js'

export const lucky777GameAdapter = Object.freeze({
  id: 'lucky-777',
  resolve({ bet, rng }) {
    return resolveLucky777({ bet, rng })
  },
})

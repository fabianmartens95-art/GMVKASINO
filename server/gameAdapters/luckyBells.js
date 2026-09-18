import { resolveLuckyBells } from '../../src/game/luckyBellsEngine.js'

export const luckyBellsGameAdapter = Object.freeze({
  id: 'lucky-bells',
  resolve({ bet, rng }) {
    return resolveLuckyBells({ bet, rng })
  },
})

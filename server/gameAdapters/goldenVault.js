import { spin } from '../../src/game/slotEngine.js'

export const goldenVaultGameAdapter = Object.freeze({
  id: 'golden-vault',
  resolve({ bet, rng }) {
    return spin(bet, rng)
  },
})

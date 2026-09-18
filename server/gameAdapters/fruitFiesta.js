import { resolveFruitFiesta } from '../../src/game/fruitFiestaEngine.js'

export const fruitFiestaGameAdapter = Object.freeze({
  id: 'fruit-fiesta',
  resolve({ bet, rng }) {
    return resolveFruitFiesta({ bet, rng })
  },
})

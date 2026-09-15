import { GAMES, getGameById } from '../config/games.js'
import { spin } from '../game/slotEngine.js'

export async function getGames() {
  return GAMES.map((game) => ({ ...game }))
}

export async function spinDemo({ gameId, bet, rng }) {
  const game = getGameById(gameId)

  if (!game || game.status !== 'playable') {
    throw new Error('Game is not available')
  }

  if (!Number.isFinite(bet) || bet <= 0) {
    throw new Error('Bet must be a positive number')
  }

  return spin(bet, rng)
}

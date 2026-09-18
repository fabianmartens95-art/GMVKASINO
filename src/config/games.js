export const GAMES = [
  {
    id: 'golden-vault',
    title: 'Golden Vault',
    provider: 'GMVKASINO Originals',
    status: 'playable',
    type: 'slot',
    reels: 3,
    rows: 3,
    paylines: 5,
    icon: '7',
    allowedBets: [1, 2, 5, 10, 25],
  },
  {
    id: 'neon-fruits',
    title: 'Neon Fruits',
    provider: 'GMVKASINO Originals',
    status: 'playable',
    type: 'slot',
    reels: 3,
    rows: 3,
    paylines: 5,
    icon: '🍓',
    allowedBets: [1, 2, 5, 10, 20],
  },
  {
    id: 'diamond-rush',
    title: 'Diamond Rush',
    provider: 'GMVKASINO Originals',
    status: 'playable',
    type: 'slot',
    reels: 3,
    rows: 3,
    paylines: 5,
    icon: '💎',
    allowedBets: [1, 2, 5, 10, 20],
  },
  {
    id: 'lucky-777',
    title: 'Lucky 777',
    provider: 'GMVKASINO Originals',
    status: 'playable',
    type: 'slot',
    reels: 3,
    rows: 3,
    paylines: 5,
    icon: '7',
    allowedBets: [1, 2, 5, 10, 20],
  },
]

export function getGameById(gameId) {
  return GAMES.find((game) => game.id === gameId) ?? null
}

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
  },
  {
    id: 'neon-fruits',
    title: 'Neon Fruits',
    provider: 'GMVKASINO Originals',
    status: 'coming-soon',
    type: 'slot',
    icon: '🍓',
  },
  {
    id: 'diamond-rush',
    title: 'Diamond Rush',
    provider: 'GMVKASINO Originals',
    status: 'coming-soon',
    type: 'slot',
    icon: '💎',
  },
  {
    id: 'lucky-777',
    title: 'Lucky 777',
    provider: 'GMVKASINO Originals',
    status: 'coming-soon',
    type: 'slot',
    icon: '7',
  },
]

export function getGameById(gameId) {
  return GAMES.find((game) => game.id === gameId) ?? null
}

const GAME_PRESENTATIONS = Object.freeze({
  'golden-vault': Object.freeze({
    theme: 'vault',
    subtitle: 'Classic gold-line slot',
    preview: Object.freeze([
      '7', '◆', 'BAR',
      '🍒', '7', '🔔',
      'BAR', '🍋', '7',
    ]),
  }),
  'neon-fruits': Object.freeze({
    theme: 'neon',
    subtitle: 'Bright fruit-line slot',
    preview: Object.freeze([
      '🍓', '🍋', '🍇',
      '🍉', '7', '🍓',
      '🍇', '🍋', '🍉',
    ]),
  }),
  'diamond-rush': Object.freeze({
    theme: 'diamond',
    subtitle: 'High-value jewel slot',
    preview: Object.freeze([
      '💎', '♛', '♦',
      '●', '💎', 'BAR',
      '♦', '◉', '💎',
    ]),
  }),
  'lucky-777': Object.freeze({
    theme: 'lucky',
    subtitle: 'Retro seven-line slot',
    preview: Object.freeze([
      '7', 'BAR', '🔔',
      '🍒', '7', '♧',
      'BAR', '🍋', '7',
    ]),
  }),
})

export function getGamePresentation(gameId) {
  return GAME_PRESENTATIONS[gameId] || GAME_PRESENTATIONS['golden-vault']
}

export function createGamePreviewGrid(gameId) {
  const presentation = getGamePresentation(gameId)
  return Array.from({ length: 3 }, (_, row) =>
    Array.from({ length: 3 }, (_, reel) => ({
      id: `preview-${row}-${reel}`,
      label: presentation.preview[(row * 3) + reel],
    })),
  )
}

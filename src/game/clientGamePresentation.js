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
  'royal-sevens': Object.freeze({
    theme: 'vault',
    subtitle: 'Royal seven-line classic slot',
    preview: Object.freeze([
      '7', '♛', '◆',
      'BAR', '7', '🍒',
      '◆', '🍋', '7',
    ]),
  }),
  'diamond-heat': Object.freeze({
    theme: 'diamond',
    subtitle: 'Diamond-and-flame classic slot',
    preview: Object.freeze([
      '💎', '🔥', '♛',
      '♦', '💎', 'BAR',
      '🔥', '●', '💎',
    ]),
  }),
  'lucky-bells': Object.freeze({
    theme: 'lucky',
    subtitle: 'Bell-and-luck classic slot',
    preview: Object.freeze([
      '🔔', '♧', '☘',
      '🍒', '🔔', 'BAR',
      '☘', '🍋', '🔔',
    ]),
  }),
  'fruit-fiesta': Object.freeze({
    theme: 'neon',
    subtitle: 'Colorful fruit-line classic slot',
    preview: Object.freeze([
      '★', '🍍', '🍉',
      '🍇', '🍓', '🍊',
      '🍍', '★', '🍉',
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

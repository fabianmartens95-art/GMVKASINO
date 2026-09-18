import { getGamePresentation } from '../game/clientGamePresentation.js'
import '../gameDetails.css'

function formatBets(game) {
  return Array.isArray(game?.allowedBets) ? game.allowedBets : []
}

export default function GameDetails({ game, onBack, onPlay }) {
  const presentation = getGamePresentation(game.id)
  const bets = formatBets(game)

  return (
    <main className="game-details-shell">
      <section className={`game-details-panel game-details-${presentation.theme}`}>
        <header className="game-details-header">
          <div>
            <span className="game-details-kicker">GMVKASINO ORIGINAL · DEMO ONLY</span>
            <h1>{game.title}</h1>
            <p>{presentation.subtitle}</p>
          </div>
          <button type="button" onClick={onBack}>Back to lobby</button>
        </header>

        <div className="game-details-grid">
          <article className="game-details-preview" aria-label={`${game.title} preview`}>
            <div className="game-details-machine-title">{game.title.toUpperCase()}</div>
            <div className="game-details-reels">
              {presentation.preview.map((symbol, index) => (
                <span key={`${symbol}-${index}`}>{symbol}</span>
              ))}
            </div>
          </article>

          <section className="game-details-info">
            <div className="game-details-stat-grid">
              <article>
                <span>Provider</span>
                <strong>{game.provider}</strong>
              </article>
              <article>
                <span>Grid</span>
                <strong>{game.reels} × {game.rows}</strong>
              </article>
              <article>
                <span>Paylines</span>
                <strong>{game.paylines}</strong>
              </article>
              <article>
                <span>Status</span>
                <strong>{game.status === 'playable' ? 'Playable DEMO' : 'Coming soon'}</strong>
              </article>
            </div>

            <div className="game-details-bets">
              <span>Allowed DEMO bets</span>
              <div>
                {bets.map((bet) => <strong key={bet}>{bet}</strong>)}
              </div>
            </div>

            <div className="game-details-notice">
              <strong>DEMO credits only</strong>
              <span>
                This game uses the shared server-authoritative GMVKASINO DEMO core.
                Credits have no monetary value. No RTP, jackpot or real-money claim is made on this page.
              </span>
            </div>

            <div className="game-details-actions">
              <button type="button" onClick={onBack}>Lobby</button>
              <button
                type="button"
                className="primary-button"
                disabled={game.status !== 'playable'}
                onClick={() => onPlay(game.id)}
              >
                {game.status === 'playable' ? `Play ${game.title}` : 'Coming soon'}
              </button>
            </div>
          </section>
        </div>
      </section>
    </main>
  )
}

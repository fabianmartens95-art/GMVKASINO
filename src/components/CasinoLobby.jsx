import { GAMES } from '../config/games.js'
import { getGamePresentation } from '../game/clientGamePresentation.js'

export default function CasinoLobby({ onPlay, onDetails }) {
  const playableGames = GAMES.filter((game) => game.status === 'playable')
  const upcomingGames = GAMES.filter((game) => game.status !== 'playable')
  const featured = playableGames[0]

  return (
    <main>
      <section className="hero-section">
        <div className="hero-copy">
          <div className="eyebrow">MULTI-GAME DEMO CORE</div>
          <h1>Classic slots.<br /><span>One secure core.</span></h1>
          <p>
            Multiple GMVKASINO Originals running through the same server-authoritative game, settlement and ledger architecture.
          </p>
          <div className="hero-actions">
            <button className="primary-button" onClick={() => onPlay(featured.id)}>Play {featured.title}</button>
            <span className="demo-label">Demo credits only</span>
          </div>
        </div>

        <div className="hero-machine" aria-hidden="true">
          <div className="machine-crown">{featured.title.toUpperCase()}</div>
          <div className="machine-screen">
            <span>7</span><span>◆</span><span>BAR</span>
          </div>
          <div className="machine-panel">
            <div>DEMO</div><div className="machine-spin">SPIN</div><div>{featured.paylines} LINES</div>
          </div>
        </div>
      </section>

      <section className="games-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">CASINO LOBBY</span>
            <h2>Featured games</h2>
          </div>
          <span className="game-count">{playableGames.length} playable · {GAMES.length} total</span>
        </div>

        <div className="game-grid">
          {playableGames.map((game) => {
            const presentation = getGamePresentation(game.id)
            return (
              <article
                className={`game-card playable-game game-card-${presentation.theme}`}
                key={game.id}
              >
                <div className="game-art">
                  <span className="big-seven">{game.icon}</span>
                  <span className="game-badge live-badge">PLAYABLE</span>
                </div>
                <div className="game-meta">
                  <div>
                    <strong>{game.title}</strong>
                    <span>{presentation.subtitle}</span>
                  </div>
                  <span className="play-circle">▶</span>
                </div>
                <div className="game-card-actions">
                  <button type="button" onClick={() => onDetails(game.id)}>Details</button>
                  <button type="button" className="primary-button" onClick={() => onPlay(game.id)}>Play</button>
                </div>
              </article>
            )
          })}

          {upcomingGames.map((game) => (
            <article className="game-card is-locked" key={game.id}>
              <div className="game-art upcoming-art">
                <span>{game.icon}</span>
                <span className="game-badge">COMING SOON</span>
              </div>
              <div className="game-meta">
                <div><strong>{game.title}</strong><span>{game.provider}</span></div>
                <span className="lock-dot">•</span>
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  )
}

import { GAMES } from '../config/games.js'

export default function CasinoLobby({ onPlay }) {
  const playable = GAMES.find((game) => game.status === 'playable')
  const upcomingGames = GAMES.filter((game) => game.status !== 'playable')

  return (
    <main>
      <section className="hero-section">
        <div className="hero-copy">
          <div className="eyebrow">PLAYABLE CORE · M2</div>
          <h1>Classic slots.<br /><span>Modern shell.</span></h1>
          <p>
            The first GMVKASINO browser build. Demo credits only, no deposits, no withdrawals, no real-money wagering.
          </p>
          <div className="hero-actions">
            <button className="primary-button" onClick={onPlay}>Play {playable.title}</button>
            <span className="demo-label">18+ concept demo</span>
          </div>
        </div>

        <div className="hero-machine" aria-hidden="true">
          <div className="machine-crown">{playable.title.toUpperCase()}</div>
          <div className="machine-screen">
            <span>7</span><span>◆</span><span>BAR</span>
          </div>
          <div className="machine-panel">
            <div>DEMO</div><div className="machine-spin">SPIN</div><div>{playable.paylines} LINES</div>
          </div>
        </div>
      </section>

      <section className="games-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">CASINO LOBBY</span>
            <h2>Featured games</h2>
          </div>
          <span className="game-count">{GAMES.length} games</span>
        </div>

        <div className="game-grid">
          <button className="game-card featured-game" onClick={onPlay}>
            <div className="game-art">
              <span className="big-seven">{playable.icon}</span>
              <span className="game-badge live-badge">PLAYABLE</span>
            </div>
            <div className="game-meta">
              <div><strong>{playable.title}</strong><span>{playable.provider}</span></div>
              <span className="play-circle">▶</span>
            </div>
          </button>

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

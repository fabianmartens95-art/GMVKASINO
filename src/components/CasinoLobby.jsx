const upcomingGames = [
  { title: 'Neon Fruits', icon: '🍓', tag: 'COMING SOON' },
  { title: 'Diamond Rush', icon: '💎', tag: 'COMING SOON' },
  { title: 'Lucky 777', icon: '7', tag: 'COMING SOON' },
]

export default function CasinoLobby({ onPlay }) {
  return (
    <main>
      <section className="hero-section">
        <div className="hero-copy">
          <div className="eyebrow">PLAYABLE CORE · M1</div>
          <h1>Classic slots.<br /><span>Modern shell.</span></h1>
          <p>
            The first GMVKASINO browser build. Demo credits only, no deposits, no withdrawals, no real-money wagering.
          </p>
          <div className="hero-actions">
            <button className="primary-button" onClick={onPlay}>Play Golden Vault</button>
            <span className="demo-label">18+ concept demo</span>
          </div>
        </div>

        <div className="hero-machine" aria-hidden="true">
          <div className="machine-crown">GOLDEN VAULT</div>
          <div className="machine-screen">
            <span>7</span><span>◆</span><span>BAR</span>
          </div>
          <div className="machine-panel">
            <div>DEMO</div><div className="machine-spin">SPIN</div><div>5 LINES</div>
          </div>
        </div>
      </section>

      <section className="games-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">CASINO LOBBY</span>
            <h2>Featured games</h2>
          </div>
          <span className="game-count">4 games</span>
        </div>

        <div className="game-grid">
          <button className="game-card featured-game" onClick={onPlay}>
            <div className="game-art">
              <span className="big-seven">7</span>
              <span className="game-badge live-badge">PLAYABLE</span>
            </div>
            <div className="game-meta">
              <div><strong>Golden Vault</strong><span>GMVKASINO Originals</span></div>
              <span className="play-circle">▶</span>
            </div>
          </button>

          {upcomingGames.map((game) => (
            <article className="game-card is-locked" key={game.title}>
              <div className="game-art upcoming-art">
                <span>{game.icon}</span>
                <span className="game-badge">{game.tag}</span>
              </div>
              <div className="game-meta">
                <div><strong>{game.title}</strong><span>GMVKASINO Originals</span></div>
                <span className="lock-dot">•</span>
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  )
}

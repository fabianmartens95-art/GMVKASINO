export default function Header({ balance, onHome, onOpenLogin, player }) {
  return (
    <header className="topbar">
      <button className="brand" onClick={onHome} aria-label="Open casino lobby">
        <span className="brand-mark">G</span>
        <span>
          <strong>GMV</strong>KASINO
        </span>
      </button>

      <nav className="desktop-nav" aria-label="Primary navigation">
        <button onClick={onHome}>Casino</button>
        <button disabled>Live</button>
        <button disabled>Rewards</button>
      </nav>

      <div className="account-actions">
        <div className="wallet-chip" title="Demo credits only">
          <span>Demo wallet</span>
          <strong>{balance.toLocaleString('en-US', { minimumFractionDigits: 2 })} CR</strong>
        </div>
        <button className="secondary-button" onClick={onOpenLogin}>
          {player ? player : 'Log in'}
        </button>
      </div>
    </header>
  )
}

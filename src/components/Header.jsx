export default function Header({ balance, onHome, onCashier, onAccount, onHistory, onOpenLogin, player }) {
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
        <button onClick={onCashier}>Cashier</button>
        <button onClick={onAccount}>Account</button>
        <button onClick={onHistory}>History</button>
        <button disabled>Live</button>
        <button disabled>Rewards</button>
      </nav>

      <div className="account-actions">
        <button className="wallet-chip" title="Demo credits only" onClick={onCashier}>
          <span>Demo wallet</span>
          <strong>{balance.toLocaleString('en-US', { minimumFractionDigits: 2 })} CR</strong>
        </button>
        <button className="secondary-button" onClick={onOpenLogin}>
          {player ? player : 'Demo name'}
        </button>
      </div>
    </header>
  )
}

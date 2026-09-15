import { useMemo, useState } from 'react'
import { createGrid, spin } from '../game/slotEngine.js'

const BETS = [1, 2, 5, 10, 25]

function Symbol({ symbol, spinning }) {
  return (
    <div className={`slot-symbol symbol-${symbol.id} ${spinning ? 'is-spinning' : ''}`}>
      <span>{symbol.label}</span>
    </div>
  )
}

export default function SlotMachine({ balance, setBalance, onBack }) {
  const initialGrid = useMemo(() => createGrid(), [])
  const [grid, setGrid] = useState(initialGrid)
  const [betIndex, setBetIndex] = useState(2)
  const [lastWin, setLastWin] = useState(0)
  const [message, setMessage] = useState('Place your bet and spin')
  const [spinning, setSpinning] = useState(false)
  const bet = BETS[betIndex]

  function changeBet(direction) {
    if (spinning) return
    setBetIndex((current) => Math.min(BETS.length - 1, Math.max(0, current + direction)))
  }

  function handleSpin() {
    if (spinning) return
    if (balance < bet) {
      setMessage('Not enough demo credits')
      return
    }

    setSpinning(true)
    setMessage('Spinning…')
    setBalance((current) => Number((current - bet).toFixed(2)))

    const result = spin(bet)

    window.setTimeout(() => {
      setGrid(result.grid)
      setLastWin(result.totalWin)
      setBalance((current) => Number((current + result.totalWin).toFixed(2)))
      setMessage(result.totalWin > 0 ? `Win! +${result.totalWin.toFixed(2)} CR` : 'No win — spin again')
      setSpinning(false)
    }, 650)
  }

  return (
    <main className="slot-page">
      <div className="slot-page-header">
        <button className="back-button" onClick={onBack}>← Casino lobby</button>
        <div>
          <span className="eyebrow">GMVKASINO ORIGINAL</span>
          <h1>Golden Vault</h1>
        </div>
        <div className="provably-demo">DEMO RNG</div>
      </div>

      <section className="slot-cabinet">
        <div className="cabinet-top">
          <span className="cabinet-star">★</span>
          <div><small>THE ORIGINAL</small><strong>GOLDEN VAULT</strong></div>
          <span className="cabinet-star">★</span>
        </div>

        <div className="slot-screen-shell">
          <div className="payline-marker marker-left">1<br />2<br />3<br />4<br />5</div>
          <div className="reel-window">
            {grid.map((row, rowIndex) => row.map((symbol, reelIndex) => (
              <Symbol key={`${rowIndex}-${reelIndex}`} symbol={symbol} spinning={spinning} />
            )))}
          </div>
          <div className="payline-marker marker-right">1<br />2<br />3<br />4<br />5</div>
        </div>

        <div className="status-display">
          <div><span>WIN</span><strong>{lastWin.toFixed(2)}</strong></div>
          <div className="status-message">{message}</div>
          <div><span>CREDIT</span><strong>{balance.toFixed(2)}</strong></div>
        </div>

        <div className="control-panel">
          <div className="bet-control">
            <span>BET</span>
            <button onClick={() => changeBet(-1)} disabled={spinning || betIndex === 0}>−</button>
            <strong>{bet.toFixed(2)}</strong>
            <button onClick={() => changeBet(1)} disabled={spinning || betIndex === BETS.length - 1}>+</button>
          </div>

          <button className="spin-button" onClick={handleSpin} disabled={spinning || balance < bet}>
            <span>{spinning ? '…' : 'SPIN'}</span>
            <small>{bet.toFixed(2)} CR</small>
          </button>

          <div className="lines-control">
            <span>LINES</span>
            <strong>5</strong>
            <small>fixed</small>
          </div>
        </div>
      </section>

      <section className="game-info-panel">
        <div><strong>Demo only</strong><span>No deposits or cash value</span></div>
        <div><strong>5 paylines</strong><span>Three identical symbols win</span></div>
        <div><strong>Local session</strong><span>Refresh resets the demo</span></div>
      </section>
    </main>
  )
}

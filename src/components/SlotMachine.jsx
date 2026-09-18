import { useMemo, useState } from 'react'
import { spinDemo } from '../api/casinoApi.js'
import { getGameById } from '../config/games.js'
import { createGamePreviewGrid, getGamePresentation } from '../game/clientGamePresentation.js'

function Symbol({ symbol, spinning }) {
  return (
    <div className={`slot-symbol symbol-${symbol.id} ${spinning ? 'is-spinning' : ''}`}>
      <span>{symbol.label}</span>
    </div>
  )
}

export default function SlotMachine({ gameId, balance, setBalance, onBack, serverState, setServerState }) {
  const game = getGameById(gameId)
  const bets = game.allowedBets?.length ? game.allowedBets : [1, 2, 5, 10, 25]
  const presentation = getGamePresentation(gameId)
  const initialGrid = useMemo(() => createGamePreviewGrid(gameId), [gameId])
  const [grid, setGrid] = useState(initialGrid)
  const [betIndex, setBetIndex] = useState(Math.min(2, bets.length - 1))
  const [lastWin, setLastWin] = useState(0)
  const [message, setMessage] = useState('Place your bet and spin')
  const [spinning, setSpinning] = useState(false)
  const bet = bets[betIndex]

  function changeBet(direction) {
    if (spinning) return
    setBetIndex((current) => Math.min(bets.length - 1, Math.max(0, current + direction)))
  }

  async function handleSpin() {
    if (spinning) return
    if (serverState === 'offline') {
      setMessage('Demo server unavailable')
      return
    }
    if (balance < bet) {
      setMessage('Not enough demo credits')
      return
    }

    setSpinning(true)
    setMessage('Server resolving spin…')

    try {
      const result = await spinDemo({ gameId, bet })
      setServerState('online')

      window.setTimeout(() => {
        setGrid(result.grid)
        setLastWin(result.totalWin)
        setBalance(result.balance)
        setMessage(result.totalWin > 0 ? `Win! +${result.totalWin.toFixed(2)} CR` : 'No win — spin again')
        setSpinning(false)
      }, 650)
    } catch (error) {
      if (error.code === 'INSUFFICIENT_DEMO_CREDITS') {
        setMessage('Not enough demo credits')
      } else if (error.code === 'RATE_LIMITED') {
        setMessage('Too many spins — slow down')
      } else {
        setMessage('Demo server unavailable')
        setServerState('offline')
      }
      setSpinning(false)
    }
  }

  return (
    <main className="slot-page">
      <div className="slot-page-header">
        <button className="back-button" onClick={onBack}>← Casino lobby</button>
        <div>
          <span className="eyebrow">GMVKASINO ORIGINAL</span>
          <h1>{game.title}</h1>
        </div>
        <div className="provably-demo">SERVER RNG · DEMO</div>
      </div>

      <section className={`slot-cabinet game-theme-${presentation.theme}`}>
        <div className="cabinet-top">
          <span className="cabinet-star">★</span>
          <div><small>THE ORIGINAL</small><strong>{game.title.toUpperCase()}</strong></div>
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
            <button onClick={() => changeBet(1)} disabled={spinning || betIndex === bets.length - 1}>+</button>
          </div>

          <button className="spin-button" onClick={handleSpin} disabled={spinning || balance < bet || serverState === 'offline'}>
            <span>{spinning ? '…' : 'SPIN'}</span>
            <small>{bet.toFixed(2)} CR</small>
          </button>

          <div className="lines-control">
            <span>LINES</span>
            <strong>{game.paylines}</strong>
            <small>fixed</small>
          </div>
        </div>
      </section>

      <section className="game-info-panel">
        <div><strong>Server-owned balance</strong><span>Browser cannot credit itself</span></div>
        <div><strong>{game.paylines} paylines</strong><span>Three identical symbols win</span></div>
        <div><strong>{presentation.subtitle}</strong><span>Outcome resolved by the server</span></div>
      </section>
    </main>
  )
}

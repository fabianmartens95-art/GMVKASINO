import { useEffect, useMemo, useState } from 'react'
import { listDemoSpinHistory, listSandboxPayments } from '../api/casinoApi.js'
import '../transactionHistory.css'

function formatAmount(operation) {
  if (typeof operation?.amountExact === 'string') return operation.amountExact
  const amount = Number(operation?.amount ?? 0)
  return Number.isFinite(amount) ? amount.toFixed(2) : '0.00'
}

function formatDate(value) {
  const timestamp = Number(value)
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString() : '—'
}

function titleFor(operation) {
  return operation.kind === 'withdrawal' ? 'DEMO withdrawal' : 'DEMO deposit'
}

export default function TransactionHistory({ onExit, onCashier }) {
  const [operations, setOperations] = useState([])
  const [rounds, setRounds] = useState([])
  const [state, setState] = useState('loading')
  const [error, setError] = useState('')

  async function load() {
    setError('')
    setState('loading')
    try {
      const [nextPayments, nextRounds] = await Promise.all([
        listSandboxPayments(),
        listDemoSpinHistory(),
      ])
      setOperations(Array.isArray(nextPayments) ? nextPayments : [])
      setRounds(Array.isArray(nextRounds) ? nextRounds : [])
      setState('ready')
    } catch (requestError) {
      setOperations([])
      setRounds([])
      if (requestError.status === 401) setState('auth')
      else {
        setError(requestError.message || 'Transaction history could not be loaded.')
        setState('error')
      }
    }
  }

  useEffect(() => {
    load()
  }, [])

  const totals = useMemo(() => {
    return operations.reduce((summary, operation) => {
      const key = operation.kind === 'withdrawal' ? 'withdrawals' : 'deposits'
      summary[key] += 1
      return summary
    }, { deposits: 0, withdrawals: 0 })
  }, [operations])

  if (state === 'loading') {
    return (
      <main className="history-shell">
        <section className="history-panel history-centered">
          <span className="history-kicker">TRANSACTION HISTORY · DEMO ONLY</span>
          <h1>Loading history…</h1>
        </section>
      </main>
    )
  }

  if (state === 'auth') {
    return (
      <main className="history-shell">
        <section className="history-panel history-centered">
          <span className="history-kicker">TRANSACTION HISTORY · DEMO ONLY</span>
          <h1>Sign in required</h1>
          <p>Transaction history belongs to your authenticated DEMO account and is loaded only from the server.</p>
          <div className="history-actions">
            <button className="primary-button" type="button" onClick={onCashier}>Open account login</button>
            <button type="button" onClick={onExit}>Back to casino</button>
          </div>
        </section>
      </main>
    )
  }

  return (
    <main className="history-shell">
      <section className="history-panel">
        <header className="history-header">
          <div>
            <span className="history-kicker">PLAYER HISTORY · DEMO ONLY</span>
            <h1>Transactions</h1>
            <p>Authoritative sandbox deposit and withdrawal states. DEMO credits have no monetary value.</p>
          </div>
          <div className="history-actions">
            <button type="button" onClick={load}>Refresh</button>
            <button type="button" onClick={onCashier}>Cashier</button>
            <button type="button" onClick={onExit}>Casino</button>
          </div>
        </header>

        {error && <div className="history-error">{error}</div>}

        <div className="history-summary">
          <article><span>Operations</span><strong>{operations.length}</strong></article>
          <article><span>Deposits</span><strong>{totals.deposits}</strong></article>
          <article><span>Withdrawals</span><strong>{totals.withdrawals}</strong></article>
        </div>

        <div className="history-section-heading">
          <h2>Payments</h2>
          <span>Authoritative sandbox payment states</span>
        </div>

        {operations.length === 0 ? (
          <div className="history-empty">
            <strong>No DEMO transactions yet.</strong>
            <span>Create a sandbox deposit or withdrawal in the cashier to see it here.</span>
          </div>
        ) : (
          <div className="history-list" role="list">
            {operations.map((operation) => (
              <article className="history-row" role="listitem" key={operation.id}>
                <div className="history-type">
                  <strong>{titleFor(operation)}</strong>
                  <span>{formatDate(operation.createdAt)}</span>
                </div>
                <div className="history-state">
                  <span>Status</span>
                  <strong>{operation.status || 'unknown'}</strong>
                </div>
                <div className="history-amount">
                  <span>Amount</span>
                  <strong>{formatAmount(operation)} DEMO</strong>
                </div>
              </article>
            ))}
          </div>
        )}

        <div className="history-section-heading">
          <h2>Game rounds</h2>
          <span>Settled DEMO spins from the server ledger boundary</span>
        </div>

        {rounds.length === 0 ? (
          <div className="history-empty">
            <strong>No settled DEMO spins yet.</strong>
            <span>Play Golden Vault to create a server-authoritative round.</span>
          </div>
        ) : (
          <div className="history-list" role="list">
            {rounds.map((round) => (
              <article className="history-row" role="listitem" key={round.roundId}>
                <div className="history-type">
                  <strong>{round.gameId}</strong>
                  <span>{formatDate(round.createdAt)}</span>
                </div>
                <div className="history-state">
                  <span>Status</span>
                  <strong>{round.status || 'unknown'}</strong>
                </div>
                <div className="history-amount">
                  <span>Bet / payout</span>
                  <strong>{round.betExact} / {round.payoutExact} DEMO</strong>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  )
}

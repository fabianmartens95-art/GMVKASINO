import { useEffect, useMemo, useState } from 'react'
import {
  createClientIdempotencyKey,
  createSandboxPayment,
  getAccountProfile,
  getDemoWallet,
  listSandboxPayments,
  loginAccount,
  logoutAccount,
  registerAccount,
} from '../api/casinoApi.js'
import '../cashier.css'

function formatAmount(value) {
  return Number(value || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function formatDate(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return '—'
  return new Date(number).toLocaleString()
}

function statusLabel(status) {
  return String(status || 'unknown').replaceAll('_', ' ')
}

export default function Cashier({ onExit, onBalanceChange }) {
  const [profile, setProfile] = useState(null)
  const [wallet, setWallet] = useState(null)
  const [operations, setOperations] = useState([])
  const [mode, setMode] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [kind, setKind] = useState('deposit')
  const [amount, setAmount] = useState('100.00')
  const [state, setState] = useState('loading')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const pendingCount = useMemo(
    () => operations.filter((operation) => ['pending', 'reserved', 'approved'].includes(operation.status)).length,
    [operations],
  )

  async function refreshData() {
    setError('')
    const nextProfile = await getAccountProfile()
    if (!nextProfile) {
      setProfile(null)
      setWallet(null)
      setOperations([])
      setState('auth')
      return
    }

    const [nextWallet, nextOperations] = await Promise.all([
      getDemoWallet(),
      listSandboxPayments(),
    ])
    setProfile(nextProfile)
    setWallet(nextWallet)
    setOperations(nextOperations)
    onBalanceChange?.(nextWallet.balance)
    setState('ready')
  }

  useEffect(() => {
    refreshData().catch((requestError) => {
      if (requestError.status === 401) setState('auth')
      else {
        setError(requestError.message || 'Cashier data could not be loaded.')
        setState('error')
      }
    })
  }, [])

  async function handleAuth(event) {
    event.preventDefault()
    setError('')
    setNotice('')
    setState('loading')
    try {
      if (mode === 'register') {
        await registerAccount({ email, password, displayName })
      } else {
        await loginAccount({ email, password })
      }
      setPassword('')
      await refreshData()
    } catch (authError) {
      setPassword('')
      setError(authError.message || 'Authentication failed.')
      setState('auth')
    }
  }

  async function handleCreate(event) {
    event.preventDefault()
    setError('')
    setNotice('')
    setState('submitting')
    const idempotencyKey = createClientIdempotencyKey(`cashier-${kind}`)
    try {
      const operation = await createSandboxPayment({ kind, amount, idempotencyKey })
      setNotice(
        operation.kind === 'withdrawal'
          ? 'DEMO withdrawal reserved. Available demo credits were updated server-side.'
          : 'DEMO deposit intent created. Finance/Admin sandbox simulation must complete it.',
      )
      await refreshData()
    } catch (paymentError) {
      setError(paymentError.message || 'Sandbox payment could not be created.')
      setState('ready')
    }
  }

  async function handleLogout() {
    await logoutAccount().catch(() => {})
    setProfile(null)
    setWallet(null)
    setOperations([])
    setState('auth')
    setNotice('')
    setError('')
    onBalanceChange?.(0)
  }

  if (state === 'loading') {
    return (
      <main className="cashier-shell">
        <section className="cashier-panel cashier-centered">
          <span className="cashier-kicker">DEMO ONLY · NO MONETARY VALUE</span>
          <h1>Sandbox Cashier</h1>
          <p>Loading authoritative account and wallet state…</p>
        </section>
      </main>
    )
  }

  if (!profile || state === 'auth') {
    return (
      <main className="cashier-shell">
        <section className="cashier-panel cashier-auth-panel">
          <div>
            <span className="cashier-kicker">DEMO ONLY · ACCOUNT REQUIRED</span>
            <h1>Sandbox Cashier</h1>
            <p>Deposit and withdrawal simulations require a registered GMVKASINO demo account. No real payment method is collected.</p>
          </div>

          <div className="cashier-tabs" role="tablist" aria-label="Account mode">
            <button className={mode === 'login' ? 'active' : ''} type="button" onClick={() => setMode('login')}>Log in</button>
            <button className={mode === 'register' ? 'active' : ''} type="button" onClick={() => setMode('register')}>Create demo account</button>
          </div>

          <form className="cashier-auth-form" onSubmit={handleAuth}>
            {mode === 'register' && (
              <label>
                Display name
                <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={40} required />
              </label>
            )}
            <label>
              Email
              <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" required />
            </label>
            <label>
              Password
              <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} minLength={12} required />
            </label>
            {error && <div className="cashier-error">{error}</div>}
            <button className="primary-button" type="submit">{mode === 'register' ? 'Create demo account' : 'Log in'}</button>
          </form>

          <button className="cashier-link-button" type="button" onClick={onExit}>Back to casino</button>
        </section>
      </main>
    )
  }

  return (
    <main className="cashier-shell">
      <section className="cashier-panel">
        <header className="cashier-header">
          <div>
            <span className="cashier-kicker">SANDBOX CASHIER · DEMO ONLY</span>
            <h1>Cashier</h1>
            <p>All amounts are DEMO credits with no monetary value. No external payment provider is connected.</p>
          </div>
          <div className="cashier-actions">
            <button type="button" onClick={() => refreshData().catch((requestError) => setError(requestError.message))}>Refresh</button>
            <button type="button" onClick={handleLogout}>Log out</button>
            <button type="button" onClick={onExit}>Casino</button>
          </div>
        </header>

        <div className="cashier-status-line">
          <span className="cashier-badge">DEMO ONLY</span>
          <span>{profile.account?.email || 'Authenticated account'}</span>
          <span>{pendingCount} open operation{pendingCount === 1 ? '' : 's'}</span>
        </div>

        <div className="cashier-grid">
          <article className="cashier-card cashier-balance-card">
            <span>Available demo wallet</span>
            <strong>{formatAmount(wallet?.balance)} CR</strong>
            <small>Authoritative server/ledger balance</small>
          </article>

          <article className="cashier-card cashier-form-card">
            <div className="cashier-tabs" role="tablist" aria-label="Sandbox payment type">
              <button className={kind === 'deposit' ? 'active' : ''} type="button" onClick={() => setKind('deposit')}>Deposit simulation</button>
              <button className={kind === 'withdrawal' ? 'active' : ''} type="button" onClick={() => setKind('withdrawal')}>Withdrawal simulation</button>
            </div>
            <form onSubmit={handleCreate}>
              <label>
                Amount in DEMO credits
                <input type="number" min="0.01" max="1000000" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} required />
              </label>
              <button className="primary-button" type="submit" disabled={state === 'submitting'}>
                {state === 'submitting' ? 'Submitting…' : kind === 'deposit' ? 'Create deposit intent' : 'Reserve withdrawal'}
              </button>
            </form>
            <small>
              {kind === 'withdrawal'
                ? 'A withdrawal request immediately reserves the selected DEMO credits on the server.'
                : 'A deposit intent does not credit the wallet until a Finance/Admin sandbox event completes it.'}
            </small>
          </article>
        </div>

        {notice && <div className="cashier-notice">{notice}</div>}
        {error && <div className="cashier-error">{error}</div>}

        <section className="cashier-history">
          <div className="cashier-section-heading">
            <h2>Sandbox payment history</h2>
            <span>{operations.length} shown</span>
          </div>
          <div className="cashier-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {operations.length === 0 ? (
                  <tr><td colSpan="5">No sandbox payment operations yet.</td></tr>
                ) : operations.map((operation) => (
                  <tr key={operation.id}>
                    <td>{operation.kind}</td>
                    <td>{operation.amountExact} CR</td>
                    <td><span className={`cashier-state state-${operation.status}`}>{statusLabel(operation.status)}</span></td>
                    <td>{formatDate(operation.createdAt)}</td>
                    <td>{formatDate(operation.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </main>
  )
}

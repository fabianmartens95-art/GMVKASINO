import { useEffect, useState } from 'react'
import {
  getAccountProfile,
  getDemoWallet,
  logoutAccount,
} from '../api/casinoApi.js'

function formatAmount(value) {
  const number = Number(value ?? 0)
  return Number.isFinite(number)
    ? number.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '0.00'
}

function formatDate(value) {
  const timestamp = Number(value)
  if (!Number.isFinite(timestamp)) return '—'
  return new Date(timestamp).toLocaleString()
}

export default function AccountPanel({ onExit, onCashier, onBalanceChange }) {
  const [profile, setProfile] = useState(null)
  const [wallet, setWallet] = useState(null)
  const [state, setState] = useState('loading')
  const [error, setError] = useState('')

  async function load() {
    setError('')
    setState('loading')
    const nextProfile = await getAccountProfile()
    if (!nextProfile) {
      setProfile(null)
      setWallet(null)
      setState('auth')
      return
    }

    const nextWallet = await getDemoWallet()
    setProfile(nextProfile)
    setWallet(nextWallet)
    onBalanceChange?.(nextWallet.balance)
    setState('ready')
  }

  useEffect(() => {
    load().catch((requestError) => {
      if (requestError.status === 401) setState('auth')
      else {
        setError(requestError.message || 'Account data could not be loaded.')
        setState('error')
      }
    })
  }, [])

  async function handleLogout() {
    setError('')
    await logoutAccount().catch(() => {})
    setProfile(null)
    setWallet(null)
    setState('auth')
    onBalanceChange?.(0)
  }

  if (state === 'loading') {
    return (
      <main className="account-shell">
        <section className="account-panel account-centered">
          <span className="account-kicker">ACCOUNT · DEMO ENVIRONMENT</span>
          <h1>Loading account…</h1>
        </section>
      </main>
    )
  }

  if (!profile || state === 'auth') {
    return (
      <main className="account-shell">
        <section className="account-panel account-centered">
          <span className="account-kicker">ACCOUNT · DEMO ENVIRONMENT</span>
          <h1>Sign in required</h1>
          <p>Your registered demo account, wallet and security state are loaded only from the authoritative server APIs.</p>
          {error && <div className="account-error">{error}</div>}
          <div className="account-actions">
            <button className="primary-button" type="button" onClick={onCashier}>Open account login</button>
            <button type="button" onClick={onExit}>Back to casino</button>
          </div>
        </section>
      </main>
    )
  }

  const account = profile.account || {}
  const security = [
    {
      label: 'Email verification',
      value: account.emailVerified ? 'Verified' : 'Not verified',
    },
    {
      label: 'MFA enrollment',
      value: account.mfaEnrolled ? 'Enrolled' : 'Not enrolled',
    },
  ]

  return (
    <main className="account-shell">
      <section className="account-panel">
        <header className="account-header">
          <div>
            <span className="account-kicker">PLAYER ACCOUNT · DEMO ONLY</span>
            <h1>{account.displayName || 'GMVKASINO account'}</h1>
            <p>Account, wallet and security indicators below are server-authoritative. No real-money identity verification is active.</p>
          </div>
          <div className="account-actions">
            <button type="button" onClick={() => load().catch((requestError) => setError(requestError.message))}>Refresh</button>
            <button type="button" onClick={onCashier}>Cashier</button>
            <button type="button" onClick={onExit}>Casino</button>
          </div>
        </header>

        {error && <div className="account-error">{error}</div>}

        <div className="account-grid">
          <article className="account-card">
            <span>Email</span>
            <strong>{account.email || '—'}</strong>
            <small>Registered demo credential identity</small>
          </article>
          <article className="account-card">
            <span>Available demo wallet</span>
            <strong>{formatAmount(wallet?.balance)} CR</strong>
            <small>Authoritative ledger-backed balance</small>
          </article>
          <article className="account-card">
            <span>Account status</span>
            <strong>{account.status || 'unknown'}</strong>
            <small>Created {formatDate(account.createdAt)}</small>
          </article>
        </div>

        <section className="account-security">
          <div className="account-section-heading">
            <div>
              <h2>Security readiness</h2>
              <p>These indicators report backend state only. They do not enable verification or MFA from the browser.</p>
            </div>
          </div>
          <div className="account-security-grid">
            {security.map((item) => (
              <article className="account-security-row" key={item.label}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </article>
            ))}
          </div>
        </section>

        <div className="account-footer-actions">
          <button type="button" onClick={handleLogout}>Log out of this browser</button>
        </div>
      </section>
    </main>
  )
}

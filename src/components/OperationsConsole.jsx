import { useEffect, useMemo, useState } from 'react'
import {
  getOperationsOverview,
  loginOperations,
  logoutOperations,
} from '../api/operationsApi.js'
import '../operations.css'

function shortRevision(value) {
  return typeof value === 'string' && value ? value.slice(0, 12) : 'unavailable'
}

function aggregateRequests(metrics) {
  const requests = Array.isArray(metrics?.requests) ? metrics.requests : []
  return requests.reduce((summary, item) => ({
    total: summary.total + Number(item?.count || 0),
    errors: summary.errors + Number(item?.errorCount || 0),
  }), { total: 0, errors: 0 })
}

function formatUptime(value) {
  const totalSeconds = Math.max(0, Math.floor(Number(value || 0) / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  return `${hours}h ${minutes}m`
}

export default function OperationsConsole({ onExit }) {
  const [overview, setOverview] = useState(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [state, setState] = useState('checking')
  const [error, setError] = useState('')

  const requestTotals = useMemo(() => aggregateRequests(overview?.metrics), [overview])

  async function refresh() {
    setError('')
    try {
      const next = await getOperationsOverview()
      setOverview(next)
      setState('ready')
    } catch (requestError) {
      setOverview(null)
      if (requestError.status === 401) setState('login')
      else if (requestError.status === 403) {
        setState('forbidden')
        setError('Dieses Konto besitzt keine Operations-Berechtigung.')
      } else {
        setState('error')
        setError(requestError.message || 'Operations-Daten konnten nicht geladen werden.')
      }
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  async function handleLogin(event) {
    event.preventDefault()
    setState('checking')
    setError('')
    try {
      const result = await loginOperations({ email, password })
      setOverview(result.overview)
      setPassword('')
      setState('ready')
    } catch (loginError) {
      setPassword('')
      if (loginError.status === 403) {
        setState('forbidden')
        setError('Anmeldung erfolgreich, aber das Konto besitzt keine Operations-Berechtigung.')
      } else {
        setState('login')
        setError(loginError.message || 'Anmeldung fehlgeschlagen.')
      }
    }
  }

  async function handleLogout() {
    await logoutOperations().catch(() => {})
    setOverview(null)
    setPassword('')
    setState('login')
    setError('')
  }

  if (state === 'checking') {
    return (
      <main className="ops-shell">
        <section className="ops-panel ops-centered">
          <span className="ops-kicker">GMVKASINO OPERATIONS</span>
          <h1>Zugriff wird geprüft</h1>
          <p>Read-only · Demo-System</p>
        </section>
      </main>
    )
  }

  if (state !== 'ready') {
    return (
      <main className="ops-shell">
        <section className="ops-panel ops-login-panel">
          <div>
            <span className="ops-kicker">STAFF ONLY · READ ONLY</span>
            <h1>Operations Console</h1>
            <p>Der erste interne Betriebsbereich. Echtgeldfunktionen und administrative Mutationen sind hier nicht verfügbar.</p>
          </div>

          {state === 'forbidden' ? (
            <div className="ops-alert">
              <strong>Zugriff verweigert</strong>
              <span>{error}</span>
              <button type="button" onClick={handleLogout}>Anderes Konto verwenden</button>
            </div>
          ) : (
            <form className="ops-login-form" onSubmit={handleLogin}>
              <label>
                E-Mail
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="username"
                  required
                />
              </label>
              <label>
                Passwort
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  required
                  minLength={12}
                />
              </label>
              {error && <div className="ops-error">{error}</div>}
              <button type="submit">Staff Login</button>
            </form>
          )}

          <button className="ops-link-button" type="button" onClick={onExit}>Zurück zum Demo-Casino</button>
        </section>
      </main>
    )
  }

  const events = overview?.metrics?.events || {}

  return (
    <main className="ops-shell">
      <section className="ops-panel">
        <header className="ops-header">
          <div>
            <span className="ops-kicker">STAFF OPERATIONS · READ ONLY</span>
            <h1>Systemübersicht</h1>
            <p>Keine Balance-, Rollen-, KYC-, Payment- oder Player-Mutationen verfügbar.</p>
          </div>
          <div className="ops-actions">
            <button type="button" onClick={refresh}>Aktualisieren</button>
            <button type="button" onClick={handleLogout}>Abmelden</button>
            <button type="button" onClick={onExit}>Casino</button>
          </div>
        </header>

        <div className="ops-status-line">
          <span className="ops-badge">DEMO ONLY</span>
          <span>Revision {shortRevision(overview?.revision)}</span>
          <span>Persistence {overview?.persistence || 'unknown'}</span>
          <span>{overview?.readOnly ? 'Read-only enforced' : 'Unknown mode'}</span>
        </div>

        <div className="ops-grid">
          <article className="ops-card">
            <span>Games</span>
            <strong>{overview?.games?.playable || 0} playable</strong>
            <small>{overview?.games?.total || 0} total · {overview?.games?.comingSoon || 0} coming soon</small>
          </article>
          <article className="ops-card">
            <span>HTTP Requests</span>
            <strong>{requestTotals.total}</strong>
            <small>{requestTotals.errors} errors in current process lifetime</small>
          </article>
          <article className="ops-card">
            <span>Resolved Spins</span>
            <strong>{Number(events['spin.resolved'] || 0)}</strong>
            <small>{Number(events['spin.rate_limited'] || 0)} rate limited</small>
          </article>
          <article className="ops-card">
            <span>Process Uptime</span>
            <strong>{formatUptime(overview?.metrics?.uptimeMs)}</strong>
            <small>Metrics retention: {overview?.metrics?.retention || 'unknown'}</small>
          </article>
        </div>

        <section className="ops-table-section">
          <div className="ops-section-heading">
            <h2>Request Health</h2>
            <span>{overview?.generatedAt ? new Date(overview.generatedAt).toLocaleString() : ''}</span>
          </div>
          <div className="ops-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Route</th>
                  <th>Method</th>
                  <th>Status</th>
                  <th>Count</th>
                  <th>Errors</th>
                  <th>Avg ms</th>
                  <th>Max ms</th>
                </tr>
              </thead>
              <tbody>
                {(overview?.metrics?.requests || []).map((item) => (
                  <tr key={`${item.method}-${item.route}-${item.statusClass}`}>
                    <td>{item.route}</td>
                    <td>{item.method}</td>
                    <td>{item.statusClass}</td>
                    <td>{item.count}</td>
                    <td>{item.errorCount}</td>
                    <td>{item.averageDurationMs}</td>
                    <td>{item.maxDurationMs}</td>
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

import { useEffect, useMemo, useState } from 'react'
import {
  getOperationsOverview,
  getSandboxPaymentQueue,
  loginOperations,
  logoutOperations,
  transitionSandboxPayment,
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

function paymentStatusRows(payments) {
  return Object.entries(payments?.countsByStatus || {})
    .sort(([a], [b]) => a.localeCompare(b))
}

function paymentActions(operation) {
  if (operation.kind === 'deposit' && operation.status === 'pending') return ['complete', 'fail']
  if (operation.kind === 'withdrawal' && operation.status === 'reserved') return ['approve', 'reject', 'fail']
  if (operation.kind === 'withdrawal' && operation.status === 'approved') return ['complete', 'fail']
  return []
}

function formatDate(value) {
  const number = Number(value)
  return Number.isFinite(number) ? new Date(number).toLocaleString() : '—'
}

export default function OperationsConsole({ onExit }) {
  const [overview, setOverview] = useState(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [state, setState] = useState('checking')
  const [error, setError] = useState('')
  const [queue, setQueue] = useState([])
  const [queueAccess, setQueueAccess] = useState('checking')
  const [queueError, setQueueError] = useState('')
  const [transitioningId, setTransitioningId] = useState('')

  const requestTotals = useMemo(() => aggregateRequests(overview?.metrics), [overview])
  const payments = overview?.payments || null

  async function refreshFinanceQueue() {
    setQueueError('')
    try {
      const operations = await getSandboxPaymentQueue()
      setQueue(operations)
      setQueueAccess('allowed')
    } catch (requestError) {
      setQueue([])
      if (requestError.status === 403) setQueueAccess('denied')
      else if (requestError.status === 401) throw requestError
      else {
        setQueueAccess('error')
        setQueueError(requestError.message || 'Finance queue could not be loaded.')
      }
    }
  }

  async function refresh() {
    setError('')
    try {
      const next = await getOperationsOverview()
      setOverview(next)
      setState('ready')
      await refreshFinanceQueue()
    } catch (requestError) {
      setOverview(null)
      setQueue([])
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
      await refreshFinanceQueue()
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

  async function handleTransition(operation, action) {
    setQueueError('')
    setTransitioningId(operation.id)
    try {
      await transitionSandboxPayment(operation.id, action)
      await Promise.all([
        getOperationsOverview().then(setOverview),
        refreshFinanceQueue(),
      ])
    } catch (transitionError) {
      setQueueError(transitionError.message || 'Sandbox transition failed.')
    } finally {
      setTransitioningId('')
    }
  }

  async function handleLogout() {
    await logoutOperations().catch(() => {})
    setOverview(null)
    setQueue([])
    setQueueAccess('checking')
    setPassword('')
    setState('login')
    setError('')
    setQueueError('')
  }

  if (state === 'checking') {
    return (
      <main className="ops-shell">
        <section className="ops-panel ops-centered">
          <span className="ops-kicker">GMVKASINO OPERATIONS</span>
          <h1>Zugriff wird geprüft</h1>
          <p>Demo-System · Capability protected</p>
        </section>
      </main>
    )
  }

  if (state !== 'ready') {
    return (
      <main className="ops-shell">
        <section className="ops-panel ops-login-panel">
          <div>
            <span className="ops-kicker">STAFF ONLY</span>
            <h1>Operations Console</h1>
            <p>Interner Betriebsbereich. Echtgeldfunktionen sind nicht verfügbar; Finance/Admin kann ausschließlich DEMO-Sandbox-Zustände simulieren.</p>
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
            <span className="ops-kicker">STAFF OPERATIONS · DEMO ONLY</span>
            <h1>Systemübersicht</h1>
            <p>Keine Echtgeld-, Rollen-, KYC- oder Player-Balance-Mutationen. Finance-Aktionen unten wirken ausschließlich auf den DEMO-Sandbox-Payment-State.</p>
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
          <span>{overview?.readOnly ? 'Overview read-only' : 'Unknown mode'}</span>
          {payments && <span>Payments {payments.ok ? 'reconciled' : 'anomaly detected'}</span>}
          <span>Finance queue {queueAccess === 'allowed' ? 'enabled' : queueAccess === 'denied' ? 'not permitted' : queueAccess}</span>
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
          <article className="ops-card">
            <span>Sandbox Payments</span>
            <strong>{Number(payments?.operationsChecked || 0)}</strong>
            <small>{Number(payments?.countsByKind?.deposit || 0)} deposits · {Number(payments?.countsByKind?.withdrawal || 0)} withdrawals</small>
          </article>
          <article className="ops-card">
            <span>Payment Reconciliation</span>
            <strong>{payments?.ok ? 'HEALTHY' : payments ? 'ANOMALY' : 'N/A'}</strong>
            <small>{Number(payments?.mismatchCount || 0)} mismatches · read-only check</small>
          </article>
        </div>

        {queueAccess === 'allowed' && (
          <section className="ops-table-section">
            <div className="ops-section-heading">
              <h2>Finance Sandbox Queue</h2>
              <span>{queue.length} operations · capability protected</span>
            </div>
            {queueError && <div className="ops-error">{queueError}</div>}
            <div className="ops-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Account ref</th>
                    <th>Type</th>
                    <th>Amount</th>
                    <th>Status</th>
                    <th>Created</th>
                    <th>Sandbox actions</th>
                  </tr>
                </thead>
                <tbody>
                  {queue.length === 0 ? (
                    <tr><td colSpan="6">No sandbox payment operations.</td></tr>
                  ) : queue.map((operation) => (
                    <tr key={operation.id}>
                      <td>{operation.accountRef}</td>
                      <td>{operation.kind}</td>
                      <td>{operation.amountExact} DEMO</td>
                      <td>{operation.status}</td>
                      <td>{formatDate(operation.createdAt)}</td>
                      <td>
                        <div className="ops-inline-actions">
                          {paymentActions(operation).map((action) => (
                            <button
                              key={action}
                              type="button"
                              disabled={transitioningId === operation.id}
                              onClick={() => handleTransition(operation, action)}
                            >
                              {transitioningId === operation.id ? 'Working…' : action}
                            </button>
                          ))}
                          {paymentActions(operation).length === 0 && <span>terminal</span>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {payments && (
          <section className="ops-table-section">
            <div className="ops-section-heading">
              <h2>Sandbox Payment Health</h2>
              <span>{payments.checkedAt ? new Date(payments.checkedAt).toLocaleString() : ''}</span>
            </div>
            <div className="ops-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Status</th>
                    <th>Operations</th>
                    <th>Operation mismatches</th>
                    <th>Transaction mismatches</th>
                    <th>Event mismatches</th>
                    <th>Reserve mismatches</th>
                  </tr>
                </thead>
                <tbody>
                  {paymentStatusRows(payments).map(([status, count], index) => (
                    <tr key={status}>
                      <td>{status}</td>
                      <td>{count}</td>
                      <td>{index === 0 ? payments.mismatchCategories?.operations || 0 : ''}</td>
                      <td>{index === 0 ? payments.mismatchCategories?.transactions || 0 : ''}</td>
                      <td>{index === 0 ? payments.mismatchCategories?.events || 0 : ''}</td>
                      <td>{index === 0 ? payments.mismatchCategories?.reserves || 0 : ''}</td>
                    </tr>
                  ))}
                  {paymentStatusRows(payments).length === 0 && (
                    <tr>
                      <td>No operations</td>
                      <td>0</td>
                      <td>{payments.mismatchCategories?.operations || 0}</td>
                      <td>{payments.mismatchCategories?.transactions || 0}</td>
                      <td>{payments.mismatchCategories?.events || 0}</td>
                      <td>{payments.mismatchCategories?.reserves || 0}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

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

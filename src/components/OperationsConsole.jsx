import { useEffect, useMemo, useState } from 'react'
import {
  getAuditEvidence,
  getOperationsOverview,
  getPlayerAuthSessions,
  searchPlayers,
  getReconciliationEvidence,
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

function hasCapability(overview, capability) {
  const capabilities = Array.isArray(overview?.access?.capabilities) ? overview.access.capabilities : []
  return capabilities.includes('*') || capabilities.includes(capability)
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
  if (Number.isFinite(number)) return new Date(number).toLocaleString()
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleString() : '—'
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
  const [auditEvents, setAuditEvents] = useState([])
  const [evidenceReconciliation, setEvidenceReconciliation] = useState(null)
  const [evidenceError, setEvidenceError] = useState('')
  const [playerQuery, setPlayerQuery] = useState('')
  const [playerResults, setPlayerResults] = useState([])
  const [selectedPlayer, setSelectedPlayer] = useState(null)
  const [playerSessions, setPlayerSessions] = useState([])
  const [securityState, setSecurityState] = useState('idle')
  const [securityError, setSecurityError] = useState('')

  const requestTotals = useMemo(() => aggregateRequests(overview?.metrics), [overview])
  const payments = overview?.payments || null

  async function refreshFinanceQueue(currentOverview = overview) {
    setQueueError('')
    if (!hasCapability(currentOverview, 'payments.sandbox.manage')) {
      setQueue([])
      setQueueAccess('not-permitted')
      return
    }
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

  async function refreshEvidence(currentOverview = overview) {
    setEvidenceError('')
    const tasks = []

    if (hasCapability(currentOverview, 'audit.read')) {
      tasks.push(
        getAuditEvidence()
          .then(setAuditEvents)
          .catch((requestError) => {
            setAuditEvents([])
            if (requestError.status === 401) throw requestError
            setEvidenceError(requestError.message || 'Audit evidence could not be loaded.')
          }),
      )
    } else {
      setAuditEvents([])
    }

    if (hasCapability(currentOverview, 'reconciliation.read')) {
      tasks.push(
        getReconciliationEvidence()
          .then(setEvidenceReconciliation)
          .catch((requestError) => {
            setEvidenceReconciliation(null)
            if (requestError.status === 401) throw requestError
            setEvidenceError(requestError.message || 'Reconciliation evidence could not be loaded.')
          }),
      )
    } else {
      setEvidenceReconciliation(null)
    }

    await Promise.all(tasks)
  }

  async function handlePlayerSearch(event) {
    event.preventDefault()
    const query = playerQuery.trim()
    if (query.length < 2) {
      setSecurityError('Mindestens 2 Zeichen für die Player-Suche eingeben.')
      return
    }
    setSecurityState('loading')
    setSecurityError('')
    setSelectedPlayer(null)
    setPlayerSessions([])
    try {
      const players = await searchPlayers(query, { limit: 10 })
      setPlayerResults(players)
      setSecurityState('ready')
    } catch (requestError) {
      setPlayerResults([])
      setSecurityState('error')
      setSecurityError(requestError.message || 'Player-Suche fehlgeschlagen.')
    }
  }

  async function handlePlayerSelect(player) {
    setSelectedPlayer(player)
    setPlayerSessions([])
    setSecurityState('loading-sessions')
    setSecurityError('')
    try {
      const sessions = await getPlayerAuthSessions(player.id, { limit: 25 })
      setPlayerSessions(sessions)
      setSecurityState('ready')
    } catch (requestError) {
      setSecurityState('error')
      setSecurityError(requestError.message || 'Session-Metadaten konnten nicht geladen werden.')
    }
  }

  async function refresh() {
    setError('')
    try {
      const next = await getOperationsOverview()
      setOverview(next)
      setState('ready')
      await Promise.all([
        refreshFinanceQueue(next),
        refreshEvidence(next),
      ])
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
      await Promise.all([
        refreshFinanceQueue(result.overview),
        refreshEvidence(result.overview),
      ])
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
        getOperationsOverview().then((nextOverview) => {
          setOverview(nextOverview)
          return refreshFinanceQueue(nextOverview)
        }),
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
    setAuditEvents([])
    setEvidenceReconciliation(null)
    setEvidenceError('')
    setPlayerQuery('')
    setPlayerResults([])
    setSelectedPlayer(null)
    setPlayerSessions([])
    setSecurityState('idle')
    setSecurityError('')
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
          <span>Finance queue {queueAccess === 'allowed' ? 'enabled' : ['denied', 'not-permitted'].includes(queueAccess) ? 'not permitted' : queueAccess}</span>
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

        {evidenceError && <div className="ops-error">{evidenceError}</div>}

        {hasCapability(overview, 'player.read') && hasCapability(overview, 'session.read') && (
          <section className="ops-table-section">
            <div className="ops-section-heading">
              <div>
                <h2>Player Security Center</h2>
                <span>Read-only · sanitized account and auth-session metadata</span>
              </div>
            </div>

            <form className="ops-security-search" onSubmit={handlePlayerSearch}>
              <input
                type="search"
                value={playerQuery}
                onChange={(event) => setPlayerQuery(event.target.value.slice(0, 64))}
                minLength={2}
                maxLength={64}
                placeholder="Account ID or display-name prefix"
                aria-label="Player lookup"
              />
              <button type="submit" disabled={securityState === 'loading'}>
                {securityState === 'loading' ? 'Searching…' : 'Search'}
              </button>
            </form>

            {securityError && <div className="ops-error">{securityError}</div>}

            {playerResults.length > 0 && (
              <div className="ops-security-results">
                {playerResults.map((player) => (
                  <button
                    type="button"
                    key={player.id}
                    className={selectedPlayer?.id === player.id ? 'is-selected' : ''}
                    onClick={() => handlePlayerSelect(player)}
                  >
                    <strong>{player.displayName || 'Unnamed player'}</strong>
                    <span>{player.status} · created {formatDate(player.createdAt)}</span>
                  </button>
                ))}
              </div>
            )}

            {selectedPlayer && (
              <div className="ops-security-detail">
                <div className="ops-section-heading">
                  <div>
                    <h3>{selectedPlayer.displayName || 'Unnamed player'}</h3>
                    <span>Account status: {selectedPlayer.status} · session metadata only</span>
                  </div>
                  <span>{playerSessions.length} sessions</span>
                </div>
                <div className="ops-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Opaque session ref</th>
                        <th>State</th>
                        <th>Created</th>
                        <th>Last seen</th>
                        <th>Expires</th>
                        <th>Revoked</th>
                      </tr>
                    </thead>
                    <tbody>
                      {playerSessions.length === 0 ? (
                        <tr><td colSpan="6">No auth-session metadata available.</td></tr>
                      ) : playerSessions.map((session) => (
                        <tr key={session.sessionRef}>
                          <td>{session.sessionRef}</td>
                          <td>{session.state}</td>
                          <td>{formatDate(session.createdAt)}</td>
                          <td>{formatDate(session.lastSeenAt)}</td>
                          <td>{formatDate(session.expiresAt)}</td>
                          <td>{session.revokedAt ? formatDate(session.revokedAt) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>
        )}



        {hasCapability(overview, 'reconciliation.read') && evidenceReconciliation && (
          <section className="ops-table-section">
            <div className="ops-section-heading">
              <h2>Reconciliation Evidence</h2>
              <span>{formatDate(evidenceReconciliation.checkedAt)} · read-only</span>
            </div>
            <div className="ops-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Domain</th>
                    <th>Status</th>
                    <th>Checked</th>
                    <th>Mismatches</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Ledger</td>
                    <td>{evidenceReconciliation.ledger?.ok ? 'HEALTHY' : 'ANOMALY'}</td>
                    <td>{Number(evidenceReconciliation.ledger?.transactionsChecked || 0)} tx</td>
                    <td>{Number(evidenceReconciliation.ledger?.mismatchCount || 0)}</td>
                  </tr>
                  <tr>
                    <td>Payments</td>
                    <td>{evidenceReconciliation.payments?.ok ? 'HEALTHY' : evidenceReconciliation.payments ? 'ANOMALY' : 'N/A'}</td>
                    <td>{Number(evidenceReconciliation.payments?.operationsChecked || 0)} ops</td>
                    <td>{Number(evidenceReconciliation.payments?.mismatchCount || 0)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        )}

        {hasCapability(overview, 'audit.read') && (
          <section className="ops-table-section">
            <div className="ops-section-heading">
              <h2>Recent Audit Evidence</h2>
              <span>{auditEvents.length} sanitized events</span>
            </div>
            <div className="ops-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Occurred</th>
                    <th>Event</th>
                    <th>Request ID</th>
                    <th>Account context</th>
                    <th>Session context</th>
                  </tr>
                </thead>
                <tbody>
                  {auditEvents.length === 0 ? (
                    <tr><td colSpan="5">No audit events available.</td></tr>
                  ) : auditEvents.map((event, index) => (
                    <tr key={`${event.occurredAt}-${event.eventType}-${index}`}>
                      <td>{formatDate(event.occurredAt)}</td>
                      <td>{event.eventType}</td>
                      <td>{event.requestId || '—'}</td>
                      <td>{event.hasAccount ? 'yes' : 'no'}</td>
                      <td>{event.hasSession ? 'yes' : 'no'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

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

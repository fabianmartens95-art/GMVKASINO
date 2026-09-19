import React, { Component } from 'react'
import ReactDOM from 'react-dom/client'
import './styles.css'
import './account.css'

const rootElement = document.getElementById('root')
let appCommitted = false

function safeErrorMessage(error) {
  const raw = error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : 'Unbekannter Browserfehler'

  return String(raw || 'Unbekannter Browserfehler')
    .replace(/[\r\n\t]+/g, ' ')
    .slice(0, 220)
}

function BootstrapFallback({ error }) {
  const message = safeErrorMessage(error)

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: '24px',
        background: '#09080d',
        color: '#f7f5ef',
        fontFamily: '-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif',
        textAlign: 'center',
      }}
    >
      <section style={{ width: 'min(440px, 100%)' }}>
        <div
          style={{
            width: '52px',
            height: '52px',
            margin: '0 auto 18px',
            display: 'grid',
            placeItems: 'center',
            borderRadius: '14px',
            background: 'linear-gradient(145deg,#ffd97d,#9c641b)',
            color: '#1a1107',
            fontFamily: 'Georgia, serif',
            fontSize: '26px',
            fontWeight: 900,
          }}
        >
          G
        </div>
        <h1 style={{ margin: '0 0 10px', fontFamily: 'Georgia, serif' }}>GMVKASINO</h1>
        <p style={{ margin: '0 0 18px', color: '#b7b1ba', lineHeight: 1.55 }}>
          Die Browser-App konnte auf diesem Gerät nicht vollständig gestartet werden.
        </p>
        <div style={{ display: 'grid', gap: '10px' }}>
          <a
            href="/"
            style={{
              display: 'block',
              padding: '14px 18px',
              borderRadius: '12px',
              background: 'linear-gradient(180deg,#f6cc77,#bf7d25)',
              color: '#170f05',
              textDecoration: 'none',
              fontWeight: 900,
            }}
          >
            APP NEU LADEN
          </a>
          <a
            href="/play.html"
            style={{
              display: 'block',
              padding: '13px 18px',
              border: '1px solid rgba(255,255,255,.16)',
              borderRadius: '12px',
              color: '#f7f5ef',
              textDecoration: 'none',
              fontWeight: 800,
            }}
          >
            KOMPATIBLE DEMO ÖFFNEN
          </a>
        </div>
        <details style={{ marginTop: '18px', color: '#7f7983', fontSize: '12px', textAlign: 'left' }}>
          <summary style={{ cursor: 'pointer', textAlign: 'center' }}>Technische Diagnose</summary>
          <code style={{ display: 'block', marginTop: '10px', overflowWrap: 'anywhere' }}>{message}</code>
        </details>
        <p style={{ marginTop: '18px', color: '#625d66', fontSize: '11px' }}>
          DEMO Credits · Kein Echtgeld
        </p>
      </section>
    </main>
  )
}

class AppErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error) {
    console.error('GMVKASINO render failed', error)
  }

  componentDidMount() {
    if (!this.state.error) appCommitted = true
  }

  componentDidUpdate() {
    if (!this.state.error) appCommitted = true
  }

  render() {
    if (this.state.error) return <BootstrapFallback error={this.state.error} />
    return this.props.children
  }
}

function renderFatal(error) {
  console.error('GMVKASINO bootstrap failed', error)
  if (!rootElement) return

  try {
    ReactDOM.createRoot(rootElement).render(<BootstrapFallback error={error} />)
  } catch {
    rootElement.textContent = 'GMVKASINO konnte auf diesem Gerät nicht gestartet werden. Bitte /play.html öffnen.'
  }
}

if (!rootElement) {
  throw new Error('Missing #root element')
}

window.addEventListener('error', (event) => {
  if (!appCommitted) renderFatal(event.error || event.message)
})

window.addEventListener('unhandledrejection', (event) => {
  if (!appCommitted) renderFatal(event.reason)
})

import('./App.jsx')
  .then(({ default: App }) => {
    ReactDOM.createRoot(rootElement).render(
      <React.StrictMode>
        <AppErrorBoundary>
          <App />
        </AppErrorBoundary>
      </React.StrictMode>,
    )
  })
  .catch(renderFatal)

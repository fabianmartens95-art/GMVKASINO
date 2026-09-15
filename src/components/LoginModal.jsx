import { useState } from 'react'

export default function LoginModal({ onClose, onLogin }) {
  const [name, setName] = useState('')

  function submit(event) {
    event.preventDefault()
    const trimmedName = name.trim()
    if (!trimmedName) return
    onLogin(trimmedName.slice(0, 18))
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="login-modal" role="dialog" aria-modal="true" aria-labelledby="login-title" onMouseDown={(event) => event.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close login">×</button>
        <span className="brand-mark modal-mark">G</span>
        <h2 id="login-title">Demo player</h2>
        <p>This is a local UI mock. No account is created and no personal data is transmitted.</p>
        <form onSubmit={submit}>
          <label htmlFor="player-name">Display name</label>
          <input id="player-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Player name" autoFocus />
          <button className="primary-button modal-submit" type="submit">Enter demo</button>
        </form>
      </section>
    </div>
  )
}

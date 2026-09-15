import { useState } from 'react'
import Header from './components/Header.jsx'
import CasinoLobby from './components/CasinoLobby.jsx'
import SlotMachine from './components/SlotMachine.jsx'
import LoginModal from './components/LoginModal.jsx'

const STARTING_BALANCE = 1000

export default function App() {
  const [view, setView] = useState('lobby')
  const [balance, setBalance] = useState(STARTING_BALANCE)
  const [loginOpen, setLoginOpen] = useState(false)
  const [player, setPlayer] = useState('')

  function goHome() {
    setView('lobby')
  }

  function handleLogin(name) {
    setPlayer(name)
    setLoginOpen(false)
  }

  return (
    <div className="app-shell">
      <Header
        balance={balance}
        onHome={goHome}
        onOpenLogin={() => setLoginOpen(true)}
        player={player}
      />

      {view === 'lobby' ? (
        <CasinoLobby onPlay={() => setView('slot')} />
      ) : (
        <SlotMachine balance={balance} setBalance={setBalance} onBack={goHome} />
      )}

      <footer>
        <span>GMVKASINO · M1 PLAYABLE CORE</span>
        <span>Demo credits only · No monetary value</span>
      </footer>

      {loginOpen && <LoginModal onClose={() => setLoginOpen(false)} onLogin={handleLogin} />}
    </div>
  )
}

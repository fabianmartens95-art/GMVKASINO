import { useEffect, useState } from 'react'
import Header from './components/Header.jsx'
import CasinoLobby from './components/CasinoLobby.jsx'
import SlotMachine from './components/SlotMachine.jsx'
import LoginModal from './components/LoginModal.jsx'
import { usePersistentState } from './hooks/usePersistentState.js'

const STARTING_BALANCE = 1000
const DEMO_GAME_ID = 'golden-vault'

function routeFromHash() {
  return window.location.hash === `#game/${DEMO_GAME_ID}` ? 'slot' : 'lobby'
}

export default function App() {
  const [view, setView] = useState(routeFromHash)
  const [balance, setBalance] = usePersistentState('gmvkasino.demo.balance', STARTING_BALANCE)
  const [player, setPlayer] = usePersistentState('gmvkasino.demo.player', '')
  const [loginOpen, setLoginOpen] = useState(false)

  useEffect(() => {
    const onHashChange = () => setView(routeFromHash())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  function navigate(nextView) {
    window.location.hash = nextView === 'slot' ? `game/${DEMO_GAME_ID}` : 'lobby'
    setView(nextView)
  }

  function handleLogin(name) {
    setPlayer(name)
    setLoginOpen(false)
  }

  return (
    <div className="app-shell">
      <Header
        balance={balance}
        onHome={() => navigate('lobby')}
        onOpenLogin={() => setLoginOpen(true)}
        player={player}
      />

      {view === 'lobby' ? (
        <CasinoLobby onPlay={() => navigate('slot')} />
      ) : (
        <SlotMachine
          gameId={DEMO_GAME_ID}
          balance={balance}
          setBalance={setBalance}
          onBack={() => navigate('lobby')}
        />
      )}

      <footer>
        <span>GMVKASINO · M2 DEMO CORE</span>
        <span>Demo credits only · No monetary value</span>
      </footer>

      {loginOpen && <LoginModal onClose={() => setLoginOpen(false)} onLogin={handleLogin} />}
    </div>
  )
}

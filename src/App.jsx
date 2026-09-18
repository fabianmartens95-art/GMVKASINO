import { useEffect, useState } from 'react'
import Header from './components/Header.jsx'
import CasinoLobby from './components/CasinoLobby.jsx'
import SlotMachine from './components/SlotMachine.jsx'
import LoginModal from './components/LoginModal.jsx'
import OperationsConsole from './components/OperationsConsole.jsx'
import Cashier from './components/Cashier.jsx'
import AccountPanel from './components/AccountPanel.jsx'
import TransactionHistory from './components/TransactionHistory.jsx'
import GameDetails from './components/GameDetails.jsx'
import { openDemoSession, syncDemoPlayer } from './api/casinoApi.js'
import { usePersistentState } from './hooks/usePersistentState.js'
import { getGameById } from './config/games.js'

const STARTING_BALANCE = 1000
function detailsGameIdFromHash() {
  const match = window.location.hash.match(/^#details\/([a-z0-9-]+)$/)
  if (!match) return null
  return getGameById(match[1])?.id || null
}

function gameIdFromHash() {
  const match = window.location.hash.match(/^#game\/([a-z0-9-]+)$/)
  if (!match) return null
  const game = getGameById(match[1])
  return game?.status === 'playable' ? game.id : null
}

function routeFromHash() {
  if (window.location.hash === '#ops') return 'ops'
  if (window.location.hash === '#cashier') return 'cashier'
  if (window.location.hash === '#account') return 'account'
  if (window.location.hash === '#history') return 'history'
  if (detailsGameIdFromHash()) return 'details'
  return gameIdFromHash() ? 'slot' : 'lobby'
}

export default function App() {
  const [view, setView] = useState(routeFromHash)
  const [selectedGameId, setSelectedGameId] = useState(() => gameIdFromHash() || detailsGameIdFromHash())
  const [balance, setBalance] = useState(STARTING_BALANCE)
  const [player, setPlayer] = usePersistentState('gmvkasino.demo.player', '')
  const [loginOpen, setLoginOpen] = useState(false)
  const [serverState, setServerState] = useState('connecting')

  useEffect(() => {
    const onHashChange = () => {
      setSelectedGameId(gameIdFromHash() || detailsGameIdFromHash())
      setView(routeFromHash())
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  useEffect(() => {
    if (['ops', 'cashier', 'account', 'history', 'details'].includes(view)) return undefined

    let active = true
    setServerState('connecting')

    openDemoSession({ player })
      .then((session) => {
        if (!active) return
        setBalance(session.balance)
        if (!player && session.player) setPlayer(session.player)
        setServerState('online')
      })
      .catch(() => {
        if (active) setServerState('offline')
      })

    return () => {
      active = false
    }
  }, [view])

  function navigate(nextView, gameId = null) {
    if (nextView === 'ops') window.location.hash = 'ops'
    else if (nextView === 'cashier') window.location.hash = 'cashier'
    else if (nextView === 'account') window.location.hash = 'account'
    else if (nextView === 'history') window.location.hash = 'history'
    else if (nextView === 'details' && gameId) {
      const game = getGameById(gameId)
      if (!game) return
      setSelectedGameId(game.id)
      window.location.hash = `details/${game.id}`
    } else if (nextView === 'slot' && gameId) {
      const game = getGameById(gameId)
      if (game?.status !== 'playable') return
      setSelectedGameId(game.id)
      window.location.hash = `game/${game.id}`
    } else {
      setSelectedGameId(null)
      window.location.hash = 'lobby'
    }
    setView(nextView)
  }

  async function handleLogin(name) {
    setPlayer(name)
    setLoginOpen(false)

    try {
      const session = await syncDemoPlayer(name)
      setBalance(session.balance)
      setServerState('online')
    } catch {
      setServerState('offline')
    }
  }

  if (view === 'ops') {
    return <OperationsConsole onExit={() => navigate('lobby')} />
  }

  if (view === 'cashier') {
    return <Cashier onExit={() => navigate('lobby')} onBalanceChange={setBalance} />
  }

  if (view === 'history') {
    return (
      <TransactionHistory
        onExit={() => navigate('lobby')}
        onCashier={() => navigate('cashier')}
      />
    )
  }

  if (view === 'details' && selectedGameId) {
    const game = getGameById(selectedGameId)
    return game ? (
      <GameDetails
        game={game}
        onBack={() => navigate('lobby')}
        onPlay={(gameId) => navigate('slot', gameId)}
      />
    ) : null
  }

  if (view === 'account') {
    return (
      <AccountPanel
        onExit={() => navigate('lobby')}
        onCashier={() => navigate('cashier')}
        onBalanceChange={setBalance}
      />
    )
  }

  return (
    <div className="app-shell">
      <Header
        balance={balance}
        onHome={() => navigate('lobby')}
        onCashier={() => navigate('cashier')}
        onAccount={() => navigate('account')}
        onHistory={() => navigate('history')}
        onOpenLogin={() => setLoginOpen(true)}
        player={player}
      />

      {view === 'lobby' ? (
        <CasinoLobby
          onPlay={(gameId) => navigate('slot', gameId)}
          onDetails={(gameId) => navigate('details', gameId)}
        />
      ) : selectedGameId ? (
        <SlotMachine
          key={selectedGameId}
          gameId={selectedGameId}
          balance={balance}
          setBalance={setBalance}
          onBack={() => navigate('lobby')}
          serverState={serverState}
          setServerState={setServerState}
        />
      ) : (
        <CasinoLobby
          onPlay={(gameId) => navigate('slot', gameId)}
          onDetails={(gameId) => navigate('details', gameId)}
        />
      )}

      <footer>
        <span>GMVKASINO · M6 LEDGER FOUNDATION · {serverState.toUpperCase()}</span>
        <span>Demo credits only · No monetary value</span>
      </footer>

      {loginOpen && <LoginModal onClose={() => setLoginOpen(false)} onLogin={handleLogin} />}
    </div>
  )
}

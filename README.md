# GMVKASINO

GMVKASINO is currently an early playable casino-shell prototype.

## M1 — Playable Casino Shell ✅

- Responsive casino lobby
- Classic slot-machine visual direction
- Playable `Golden Vault` 3x3 slot demo
- Five fixed paylines
- Weighted demo RNG
- Demo-credit wallet with adjustable bet sizes
- Local login/profile mock
- Mobile layout
- Automated tests and GitHub CI

## M2 — Demo Core ✅

- Central game catalog/configuration
- Persistent local demo balance and player name
- Hash-based lobby/game routing without extra dependencies
- Injectable RNG for deterministic engine testing
- Client-side `casinoApi` boundary between UI and game engine
- API validation for unavailable games and invalid bets
- Expanded engine/API test coverage

> **Important:** This repository currently contains a demo only. Credits have no monetary value. There are no deposits, withdrawals, crypto payments, real-money wagering, KYC, or production authentication.

## Local development

```bash
npm install
npm run dev
```

Validation:

```bash
npm test
npm run build
```

## Current structure

```text
src/
├── api/
│   └── casinoApi.js
├── components/
│   ├── CasinoLobby.jsx
│   ├── Header.jsx
│   ├── LoginModal.jsx
│   └── SlotMachine.jsx
├── config/
│   └── games.js
├── game/
│   └── slotEngine.js
├── hooks/
│   └── usePersistentState.js
├── App.jsx
├── main.jsx
└── styles.css
```

## Next milestone

M3 should introduce a minimal server boundary, server-owned demo sessions and spin resolution, structured event logging, rate limiting, environment configuration, and deployment infrastructure. Real-money functionality remains out of scope until legal/compliance requirements are explicitly satisfied.

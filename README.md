# GMVKASINO

GMVKASINO is currently an early playable casino-shell prototype.

## M1 — Playable Casino Shell

Implemented in this milestone:

- Responsive casino lobby
- Classic slot-machine visual direction
- Playable `Golden Vault` 3x3 slot demo
- Five fixed paylines
- Weighted demo RNG using `crypto.getRandomValues` when available
- Demo-credit wallet with adjustable bet sizes
- Local login/profile mock
- Mobile layout
- Clear separation between UI and slot-engine logic

> **Important:** This repository currently contains a demo only. Credits have no monetary value. There are no deposits, withdrawals, crypto payments, real-money wagering, KYC, or production authentication.

## Local development

```bash
npm install
npm run dev
```

Production build:

```bash
npm run build
npm run preview
```

## Current structure

```text
src/
├── components/
│   ├── CasinoLobby.jsx
│   ├── Header.jsx
│   ├── LoginModal.jsx
│   └── SlotMachine.jsx
├── game/
│   └── slotEngine.js
├── App.jsx
├── main.jsx
└── styles.css
```

## Next milestone

M2 should add routing, persistent demo sessions, game metadata/configuration, deterministic test hooks for the slot engine, unit tests, and the first backend/API boundary before any payment or real-money functionality is considered.

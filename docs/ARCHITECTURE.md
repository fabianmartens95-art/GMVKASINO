# Architecture Snapshot

Current milestone: M3 Server Core.

The frontend is a React/Vite demo shell. The browser stores only a demo session identifier and player display name. Game balance and spin settlement are server-authoritative.

The Node server owns in-memory demo sessions, validates allowed bets and available demo credits, applies rate limits, resolves the slot engine, records structured audit events, and returns the authoritative balance.

Production persistence, identity, money movement, compliance controls, and real-money operation are intentionally not implemented.

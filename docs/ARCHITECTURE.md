# Architecture Snapshot

Current milestone: M4 Persistent Core.

The frontend is a React/Vite demo shell. The browser stores only a demo session token and player display name. Game balance and spin settlement remain server-authoritative.

The Node server validates allowed bets and available demo credits, applies per-session rate limits, resolves the slot engine, records structured audit events, and returns the authoritative balance.

M4 adds a persistence adapter between `SessionStore` and storage. The current adapter writes demo sessions atomically to a local JSON file so sessions survive server restarts. This is a transitional durable repository layer, not the final production database.

The HTTP contract is versioned under `/api/v1`. Every request receives an `X-Request-Id`, and structured HTTP logs contain request metadata without logging demo session tokens. Legacy `/api/*` aliases remain temporarily available during migration.

Production identity, financial ledgers, money movement, compliance controls, certified gaming infrastructure, and real-money operation are intentionally not implemented.

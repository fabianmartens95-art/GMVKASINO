# M3 Server Core

Status target: demo server boundary with server-owned session balance and spin settlement.

Done criteria:

- Browser cannot settle its own balance.
- Demo session is created/resumed by the server.
- Spin request validates session, game, allowed bet, funds, and rate limit.
- Spin result and balance are returned by the server.
- Audit events are emitted for session and spin activity.
- HTTP smoke tests cover session creation and spin settlement.
- `npm test` and `npm run build` pass in CI.

Out of scope: deposits, withdrawals, crypto payments, real-money wagering, KYC, production auth, certified RNG, and licensing implementation.

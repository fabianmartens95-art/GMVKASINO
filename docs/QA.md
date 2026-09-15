# QA Gate

Before M3 is merged to `main`:

1. `npm test` must pass.
2. `npm run build` must pass.
3. The HTTP smoke test must create a demo session and resolve a server-side spin.
4. The server service test must verify authoritative balance settlement, bet validation, insufficient-credit handling, and rate limiting.
5. No real-money functionality may be introduced in this milestone.

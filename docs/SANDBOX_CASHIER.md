# GMVKASINO Sandbox Cashier V1

Status: DEMO-only product surface.

The cashier is a player-facing UI for the existing sandbox payment domain. It must never imply that DEMO credits have monetary value and it must not introduce a real payment processor, payment instrument collection, crypto address, bank/card data, custody, or real-money activation.

## Player flow

Authenticated player account → Cashier → DEMO deposit intent or DEMO withdrawal request → status history.

Deposits remain `pending` until a Finance/Admin sandbox transition completes or fails them.

Withdrawals reserve DEMO credits immediately. The UI must explain that reservation changes available DEMO balance even before the operation is approved/completed.

## Staff flow

Finance/Admin → Operations Console → read-only queue summary/list → sandbox transition controls only for the state-machine actions already exposed by the backend.

The staff queue is a sandbox simulator. It is not a production payment operations tool.

## Security rules

- Player list/create APIs are scoped to the authenticated account.
- Staff queue requires `payments.sandbox.manage`.
- Transition endpoints remain capability protected and event-id deduplicated.
- No client is authoritative for balances or payment status.
- All balance effects remain ledger-backed and server authoritative.
- All transition actions remain auditable.
- Real-money production gate remains fail-closed.

# GMVKASINO Sandbox Payment Domain

Status: P0 technical foundation. **DEMO asset only. No real payment provider and no real-money activation.**

## Purpose

The sandbox payment domain exercises the same integrity controls required by a future regulated payment integration without moving money. It uses only the existing `DEMO` asset and keeps all authoritative state and ledger mutations on the server.

## Deposit state machine

`pending -> completed | failed`

Creating a deposit stores a persistent payment operation but does not change the wallet. A finance/admin sandbox transition with a unique event ID can complete the operation. Completion posts exactly one balanced `SANDBOX_DEPOSIT` ledger transaction from the sandbox payment-clearing system account into the player's available DEMO wallet.

Repeated create requests with the same account, kind and idempotency key replay the original operation when the request fingerprint is identical. Reusing the key with different parameters fails with an idempotency conflict.

Repeated transition events with the same event ID replay safely and do not create a second ledger posting.

## Withdrawal state machine

`reserved -> approved -> completed`

Alternative terminal paths:

- `reserved -> rejected`
- `reserved -> failed`
- `approved -> failed`

Creating a withdrawal immediately moves DEMO value from the player's `available` ledger account into a dedicated `withdrawal_reserved` ledger account. This reservation is a balanced ledger transaction and prevents the same DEMO value from being spent or withdrawn twice.

Approval changes only the payment-operation state. Completion moves the reserved DEMO value into the sandbox payment-clearing system account. Rejection or failure reverses the reservation back into the available wallet.

Every settlement/reversal ledger operation has its own deterministic idempotency key derived from the payment operation ID.

## API

All routes are sandbox-only and return `sandbox: true` and `mode: demo`.

Player/account routes:

- `POST /api/v1/sandbox/payments/deposits`
- `POST /api/v1/sandbox/payments/withdrawals`
- `GET /api/v1/sandbox/payments`

Create request body:

```json
{
  "amount": "25.00",
  "idempotencyKey": "client-generated-unique-key"
}
```

Finance/admin sandbox transition route:

- `POST /api/v1/sandbox/payments/:operationId/transition`

Transition request body:

```json
{
  "action": "complete",
  "eventId": "sandbox-provider-event-unique-id"
}
```

Players receive `payments.sandbox.create` and `payments.sandbox.read`. Finance receives `payments.sandbox.read` and `payments.sandbox.manage`. Admin inherits all capabilities. Provider accounts do not receive sandbox payment capabilities.

## Persistence

Migration `008_sandbox_payments.sql` adds:

- `payment_operations` for the authoritative payment state machine
- `payment_events` for unique event replay protection
- `sys_demo_payment_clearing` as the balanced DEMO ledger counterparty
- per-player `withdrawal_reserved` ledger accounts created on demand

The database constrains this domain to the `DEMO` asset. Fiat and crypto assets are not enabled by this implementation.

## Audit and observability

Operation creation and every accepted state transition are recorded in the application audit log with request/account/payment-operation correlation. HTTP request metrics use normalized sandbox-payment route labels.

No password hashes, auth bearer tokens, card data, bank details, wallet addresses or provider secrets are stored by this domain.

## Production gate

Because a deposit/withdrawal domain now exists in the codebase, the production workflow permanently evaluates `GATE_PAYMENT_DOMAIN_INTRODUCED=true`.

A future real-money production gate therefore requires explicit `passed` evidence for both deposit and withdrawal idempotency. The sandbox implementation itself is not evidence of legal, licensing, KYC/AML, provider, custody or production-payment readiness.

## Non-goals

This implementation does not include payment-provider SDKs, webhooks from external processors, blockchain transactions, card/bank processing, fiat/crypto asset activation, KYC decisions, AML controls, chargebacks, custody, payout signing or real-money activation.

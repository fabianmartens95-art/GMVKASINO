# GMVKASINO Sandbox Payment Reconciliation

Status: P0 read-only integrity control for the DEMO payment domain.

## Purpose

Payment reconciliation verifies that the authoritative payment state machine, event trail and ledger postings describe the same financial reality. It never repairs or mutates data.

`npm run payments:reconcile` exits non-zero when any payment anomaly is found, so CI and operational checks fail closed.

## Checks

For every sandbox payment operation the reconciler verifies:

- asset remains `DEMO`
- transaction pointers are present only when required by the current state
- referenced ledger transactions exist
- transaction type, payment-operation reference and asset match the expected posting
- each payment posting has the expected two ledger entries
- entry owners, purposes and atomic amounts match the operation
- each posting remains balanced
- terminal/approved states have the expected unique payment event
- completed withdrawals contain both approval and completion events

For withdrawals it also independently aggregates every operation still in `reserved` or `approved` status and compares that amount with the player's cached `withdrawal_reserved` ledger balance. This catches reserve drift even if the global ledger remains balanced.

## CI

CI runs payment reconciliation after generic DEMO-ledger reconciliation and before the database backup/restore drill.

Restore verification compares row counts for the payment tables and game-round table, then runs both generic ledger reconciliation and payment reconciliation against the restored database.

A reconciliation mismatch therefore blocks the pipeline rather than becoming an informational warning.

## Operations Console

The staff Ops overview receives only a sanitized aggregate:

- reconciliation healthy / anomaly state
- operations checked
- payment transactions checked
- counts by payment kind and status
- total mismatch count
- mismatch counts by category

The Ops response does not include player account IDs, emails, wallet IDs, bearer tokens, idempotency keys or individual payment records.

## No automatic repair

A detected anomaly is evidence for investigation, not permission to rewrite accounting data. Repair tooling, if ever introduced, must be separately designed, capability-protected, audited and reviewed. This reconciler remains read-only.

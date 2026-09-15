# Ledger Reconciliation

GMVKASINO M6 uses PostgreSQL double-entry accounting for the non-monetary `DEMO` asset. Reconciliation is a read-only operational control that verifies the cached ledger-account balances still agree with the immutable posting history.

## Run the check

```bash
DATABASE_URL=postgresql://... npm run ledger:reconcile
```

To restrict the report to one asset:

```bash
DATABASE_URL=postgresql://... LEDGER_RECONCILE_ASSET=DEMO npm run ledger:reconcile
```

The command prints a JSON report and exits with a non-zero status when any invariant fails.

## Invariants

The reconciliation command checks three independent layers:

1. **Ledger-account balance parity** — each `ledger_accounts.balance_atomic` value must exactly equal the sum of all `ledger_entries.amount_atomic` values posted to that ledger account.
2. **Transaction integrity** — each ledger transaction must have at least two entries, all entries must use ledger accounts for the transaction asset, and the signed entry sum must be exactly zero.
3. **Asset conservation** — the sum of cached balances across every ledger account for an asset must be exactly zero. User balances are offset by the corresponding system issuance/house balances.

All comparisons use integer atomic units. No JavaScript floating-point comparison is used for reconciliation.

## CI gate

The main CI workflow runs `npm run ledger:reconcile` against the ephemeral PostgreSQL test database after the full test suite. A reconciliation mismatch fails the workflow before the frontend build, smoke test and Docker image are accepted.

## Response to a mismatch

Do not automatically rewrite balances from the ledger during the first response. Preserve the database, capture the JSON reconciliation report and identify the affected ledger account or transaction. A mismatch can indicate application bugs, manual database modification, incomplete migrations or operational corruption.

Repairs should be explicit, reviewed and auditable. Prefer corrective ledger transactions or a controlled recovery procedure over editing financial-history rows. Even though the current asset is demo-only, this discipline is intentional preparation for stronger accounting guarantees later.

## Scope

This control currently covers the non-monetary `DEMO` ledger. It does not enable deposits, withdrawals, cryptocurrency, custody or real-money operation.

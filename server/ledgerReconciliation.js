function atomic(value) {
  return BigInt(String(value ?? '0'))
}

function mismatchDelta(cached, ledger) {
  return (atomic(cached) - atomic(ledger)).toString()
}

export class LedgerReconciler {
  constructor({ pool, now = Date.now } = {}) {
    if (!pool) throw new Error('LedgerReconciler requires a pool')
    this.pool = pool
    this.now = now
  }

  async reconcile({ assetCode = null } = {}) {
    const normalizedAsset = typeof assetCode === 'string' && assetCode.trim()
      ? assetCode.trim().toUpperCase()
      : null

    const accountsResult = await this.pool.query(
      `SELECT
         la.id,
         la.account_id,
         la.system_key,
         la.asset_code,
         la.purpose,
         la.balance_atomic::text AS cached_balance_atomic,
         COALESCE(SUM(le.amount_atomic), 0)::text AS ledger_balance_atomic
       FROM ledger_accounts la
       LEFT JOIN ledger_entries le ON le.ledger_account_id = la.id
       WHERE ($1::text IS NULL OR la.asset_code = $1)
       GROUP BY la.id, la.account_id, la.system_key, la.asset_code, la.purpose, la.balance_atomic
       ORDER BY la.asset_code, la.id`,
      [normalizedAsset],
    )

    const accountMismatches = accountsResult.rows
      .filter((row) => atomic(row.cached_balance_atomic) !== atomic(row.ledger_balance_atomic))
      .map((row) => ({
        ledgerAccountId: row.id,
        accountId: row.account_id,
        systemKey: row.system_key,
        assetCode: row.asset_code,
        purpose: row.purpose,
        cachedBalanceAtomic: row.cached_balance_atomic,
        ledgerBalanceAtomic: row.ledger_balance_atomic,
        deltaAtomic: mismatchDelta(row.cached_balance_atomic, row.ledger_balance_atomic),
      }))

    const transactionsResult = await this.pool.query(
      `SELECT
         lt.id,
         lt.asset_code,
         COUNT(le.id)::int AS entry_count,
         COALESCE(SUM(le.amount_atomic), 0)::text AS entry_sum_atomic,
         COUNT(le.id) FILTER (WHERE la.asset_code <> lt.asset_code)::int AS mixed_asset_entry_count
       FROM ledger_transactions lt
       LEFT JOIN ledger_entries le ON le.transaction_id = lt.id
       LEFT JOIN ledger_accounts la ON la.id = le.ledger_account_id
       WHERE ($1::text IS NULL OR lt.asset_code = $1)
       GROUP BY lt.id, lt.asset_code
       ORDER BY lt.id`,
      [normalizedAsset],
    )

    const transactionMismatches = transactionsResult.rows
      .filter((row) => (
        Number(row.entry_count) < 2
        || atomic(row.entry_sum_atomic) !== 0n
        || Number(row.mixed_asset_entry_count) > 0
      ))
      .map((row) => ({
        transactionId: row.id,
        assetCode: row.asset_code,
        entryCount: Number(row.entry_count),
        entrySumAtomic: row.entry_sum_atomic,
        mixedAssetEntryCount: Number(row.mixed_asset_entry_count),
      }))

    const assetsResult = await this.pool.query(
      `SELECT
         asset_code,
         COUNT(*)::int AS ledger_account_count,
         SUM(balance_atomic)::text AS cached_total_atomic
       FROM ledger_accounts
       WHERE ($1::text IS NULL OR asset_code = $1)
       GROUP BY asset_code
       ORDER BY asset_code`,
      [normalizedAsset],
    )

    const assetMismatches = assetsResult.rows
      .filter((row) => atomic(row.cached_total_atomic) !== 0n)
      .map((row) => ({
        assetCode: row.asset_code,
        ledgerAccountCount: Number(row.ledger_account_count),
        cachedTotalAtomic: row.cached_total_atomic,
      }))

    const checkedAt = new Date(this.now()).toISOString()
    const ok = accountMismatches.length === 0
      && transactionMismatches.length === 0
      && assetMismatches.length === 0

    return {
      ok,
      checkedAt,
      assetCode: normalizedAsset,
      accountsChecked: accountsResult.rows.length,
      transactionsChecked: transactionsResult.rows.length,
      assetsChecked: assetsResult.rows.length,
      accountMismatches,
      transactionMismatches,
      assetMismatches,
    }
  }
}

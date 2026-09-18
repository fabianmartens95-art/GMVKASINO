import { LedgerReconciler } from './ledgerReconciliation.js'

function normalizeLimit(value) {
  if (value === undefined || value === null || value === '') return 50
  const limit = Number(value)
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    const error = new Error('Evidence limit must be an integer between 1 and 100')
    error.code = 'INVALID_EVIDENCE_LIMIT'
    error.status = 400
    throw error
  }
  return limit
}

export class OperationalEvidenceReader {
  constructor({ pool, paymentReconciler = null, ledgerReconciler = null } = {}) {
    if (!pool) throw new Error('OperationalEvidenceReader requires a pool')
    this.pool = pool
    this.paymentReconciler = paymentReconciler
    this.ledgerReconciler = ledgerReconciler || new LedgerReconciler({ pool })
  }

  async recentAudit({ limit } = {}) {
    const safeLimit = normalizeLimit(limit)
    const result = await this.pool.query(
      `SELECT event_type, occurred_at, request_id,
              (account_id IS NOT NULL) AS has_account,
              (session_ref IS NOT NULL) AS has_session
       FROM audit_events
       ORDER BY occurred_at DESC, id DESC
       LIMIT $1`,
      [safeLimit],
    )

    return result.rows.map((row) => ({
      eventType: row.event_type,
      occurredAt: new Date(row.occurred_at).toISOString(),
      requestId: row.request_id || null,
      hasAccount: Boolean(row.has_account),
      hasSession: Boolean(row.has_session),
    }))
  }

  async reconciliationSummary() {
    const [ledger, payments] = await Promise.all([
      this.ledgerReconciler.reconcile({ assetCode: 'DEMO' }),
      this.paymentReconciler?.sanitizedSummary?.() || Promise.resolve(null),
    ])

    const referenceMismatches = Array.isArray(ledger.referenceMismatches) ? ledger.referenceMismatches : []
    const referenceDuplicates = Array.isArray(ledger.referenceDuplicates) ? ledger.referenceDuplicates : []
    const ledgerMismatchCount = ledger.accountMismatches.length
      + ledger.transactionMismatches.length
      + ledger.assetMismatches.length
      + referenceMismatches.length
      + referenceDuplicates.length

    return {
      checkedAt: ledger.checkedAt,
      mode: 'demo',
      ledger: {
        ok: ledger.ok,
        accountsChecked: ledger.accountsChecked,
        transactionsChecked: ledger.transactionsChecked,
        assetsChecked: ledger.assetsChecked,
        mismatchCount: ledgerMismatchCount,
        mismatchCategories: {
          accounts: ledger.accountMismatches.length,
          transactions: ledger.transactionMismatches.length,
          assets: ledger.assetMismatches.length,
          references: referenceMismatches.length + referenceDuplicates.length,
        },
      },
      payments: payments
        ? {
            ok: payments.ok,
            operationsChecked: payments.operationsChecked,
            paymentTransactionsChecked: payments.paymentTransactionsChecked,
            mismatchCount: payments.mismatchCount,
            mismatchCategories: payments.mismatchCategories,
          }
        : null,
    }
  }
}

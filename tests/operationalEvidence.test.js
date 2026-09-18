import test from 'node:test'
import assert from 'node:assert/strict'
import { OperationalEvidenceReader } from '../server/operationalEvidence.js'

test('audit evidence exposes metadata only', async () => {
  const reader = new OperationalEvidenceReader({
    pool: {
      async query(sql, params) {
        assert.equal(sql.includes('data'), false)
        assert.deepEqual(params, [5])
        return {
          rows: [{
            event_type: 'auth.logged_in',
            occurred_at: '2026-09-18T00:00:00.000Z',
            request_id: 'request-123',
            has_account: true,
            has_session: true,
          }],
        }
      },
    },
    ledgerReconciler: {
      async reconcile() {
        return {
          ok: true,
          checkedAt: '2026-09-18T00:00:00.000Z',
          accountsChecked: 1,
          transactionsChecked: 1,
          assetsChecked: 1,
          accountMismatches: [],
          transactionMismatches: [],
          assetMismatches: [],
        }
      },
    },
  })

  const events = await reader.recentAudit({ limit: 5 })
  assert.deepEqual(events, [{
    eventType: 'auth.logged_in',
    occurredAt: '2026-09-18T00:00:00.000Z',
    requestId: 'request-123',
    hasAccount: true,
    hasSession: true,
  }])
  const serialized = JSON.stringify(events)
  assert.equal(serialized.includes('accountId'), false)
  assert.equal(serialized.includes('sessionRef'), false)
  assert.equal(serialized.includes('password'), false)
})

test('reconciliation evidence collapses raw mismatches to counts', async () => {
  const reader = new OperationalEvidenceReader({
    pool: { query: async () => ({ rows: [] }) },
    ledgerReconciler: {
      async reconcile() {
        return {
          ok: false,
          checkedAt: '2026-09-18T00:00:00.000Z',
          accountsChecked: 2,
          transactionsChecked: 3,
          assetsChecked: 1,
          accountMismatches: [{ accountId: 'secret-player' }],
          transactionMismatches: [{ transactionId: 'secret-tx' }],
          assetMismatches: [],
        }
      },
    },
    paymentReconciler: {
      async sanitizedSummary() {
        return {
          ok: true,
          operationsChecked: 4,
          paymentTransactionsChecked: 5,
          mismatchCount: 0,
          mismatchCategories: { operations: 0, transactions: 0, events: 0, reserves: 0 },
        }
      },
    },
  })

  const result = await reader.reconciliationSummary()
  assert.equal(result.ledger.ok, false)
  assert.equal(result.ledger.mismatchCount, 2)
  assert.deepEqual(result.ledger.mismatchCategories, { accounts: 1, transactions: 1, assets: 0 })
  assert.equal(JSON.stringify(result).includes('secret-player'), false)
  assert.equal(JSON.stringify(result).includes('secret-tx'), false)
})

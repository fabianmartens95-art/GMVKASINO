import test from 'node:test'
import assert from 'node:assert/strict'
import { SandboxPaymentQueue } from '../server/sandboxPaymentQueue.js'

test('finance queue exposes only sanitized payment fields', async () => {
  const pool = {
    async query() {
      return {
        rows: [{
          id: 'operation-1',
          account_id: 'sensitive-account-id',
          kind: 'deposit',
          asset_code: 'DEMO',
          amount_atomic: '1250',
          status: 'pending',
          created_at: 1000,
          updated_at: 2000,
          idempotency_key: 'secret-key',
          settlement_transaction_id: 'secret-ledger-id',
        }],
      }
    },
  }

  const queue = new SandboxPaymentQueue({ pool })
  const [operation] = await queue.list()

  assert.equal(operation.id, 'operation-1')
  assert.equal(operation.kind, 'deposit')
  assert.equal(operation.amountExact, '12.50')
  assert.equal(operation.status, 'pending')
  assert.match(operation.accountRef, /^[a-f0-9]{12}$/)
  assert.equal('accountId' in operation, false)
  assert.equal('idempotencyKey' in operation, false)
  assert.equal('settlementTransactionId' in operation, false)
  assert.equal(JSON.stringify(operation).includes('sensitive-account-id'), false)
  assert.equal(JSON.stringify(operation).includes('secret-key'), false)
  assert.equal(JSON.stringify(operation).includes('secret-ledger-id'), false)
})

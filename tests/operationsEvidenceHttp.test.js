import test from 'node:test'
import assert from 'node:assert/strict'
import { createOperationsHttpServer } from '../server/operationsHttpServer.js'

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  return `http://127.0.0.1:${address.port}`
}

async function close(server) {
  await new Promise((resolve) => server.close(resolve))
}

test('ops evidence routes enforce separate audit and reconciliation capabilities', async () => {
  const profiles = {
    'support-token': { account: { id: 'support-1', roles: ['support'] }, wallet: { balance: 0 } },
    'compliance-token': { account: { id: 'compliance-1', roles: ['compliance'] }, wallet: { balance: 0 } },
    'finance-token': { account: { id: 'finance-1', roles: ['finance'] }, wallet: { balance: 0 } },
  }
  const authService = { profile: async (token) => profiles[token] || null }
  const auditEvents = []
  const operationalEvidence = {
    async recentAudit() {
      return [{
        eventType: 'auth.logged_in',
        occurredAt: '2026-09-18T00:00:00.000Z',
        requestId: 'request-1',
        hasAccount: true,
        hasSession: false,
      }]
    },
    async reconciliationSummary() {
      return {
        checkedAt: '2026-09-18T00:00:00.000Z',
        mode: 'demo',
        ledger: {
          ok: true,
          accountsChecked: 3,
          transactionsChecked: 4,
          assetsChecked: 1,
          mismatchCount: 0,
          mismatchCategories: { accounts: 0, transactions: 0, assets: 0 },
        },
        payments: {
          ok: true,
          operationsChecked: 2,
          paymentTransactionsChecked: 2,
          mismatchCount: 0,
          mismatchCategories: { operations: 0, transactions: 0, events: 0, reserves: 0 },
        },
      }
    },
  }
  const service = {
    metrics: null,
    authService,
    auditLog: { record(event, data) { auditEvents.push({ event, data }) } },
    checkReadiness: async () => ({ ok: true, backend: 'memory' }),
    getGames: () => [],
  }
  const server = createOperationsHttpServer({
    service,
    authService,
    operationalEvidence,
    config: { maxBodyBytes: 16_384, metricsToken: '', deploymentRevision: null },
    staticDir: '/tmp/gmvkasino-no-static',
    log: () => {},
  })
  const baseUrl = await listen(server)

  try {
    const supportAudit = await fetch(`${baseUrl}/api/v1/ops/audit`, {
      headers: { Authorization: 'Bearer support-token' },
    })
    assert.equal(supportAudit.status, 403)

    const complianceAudit = await fetch(`${baseUrl}/api/v1/ops/audit`, {
      headers: { Authorization: 'Bearer compliance-token' },
    })
    assert.equal(complianceAudit.status, 200)
    const auditPayload = await complianceAudit.json()
    assert.equal(auditPayload.events[0].eventType, 'auth.logged_in')
    assert.equal(JSON.stringify(auditPayload).includes('accountId'), false)

    const complianceReconciliation = await fetch(`${baseUrl}/api/v1/ops/reconciliation`, {
      headers: { Authorization: 'Bearer compliance-token' },
    })
    assert.equal(complianceReconciliation.status, 403)

    const financeReconciliation = await fetch(`${baseUrl}/api/v1/ops/reconciliation`, {
      headers: { Authorization: 'Bearer finance-token' },
    })
    assert.equal(financeReconciliation.status, 200)
    const reconPayload = await financeReconciliation.json()
    assert.equal(reconPayload.reconciliation.ledger.ok, true)
    assert.equal(reconPayload.reconciliation.payments.ok, true)

    assert.ok(auditEvents.some((entry) => entry.event === 'operations.audit_read'))
    assert.ok(auditEvents.some((entry) => entry.event === 'operations.reconciliation_read'))
  } finally {
    await close(server)
  }
})

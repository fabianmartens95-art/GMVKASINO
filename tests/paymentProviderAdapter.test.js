import test from 'node:test'
import assert from 'node:assert/strict'
import {
  PaymentProviderEventError,
  SandboxPaymentProviderAdapter,
  normalizePaymentProviderEvent,
} from '../server/paymentProviderAdapter.js'

test('sandbox provider adapter normalizes untrusted event input into payment transition inputs', () => {
  const adapter = new SandboxPaymentProviderAdapter()
  const transition = adapter.toTransition({
    provider: ' SANDBOX ',
    eventId: 'evt-001',
    operationId: 'payment-op-001',
    action: ' COMPLETE ',
    occurredAt: '2026-09-18T00:00:00.000Z',
    reference: 'sandbox-provider-ref',
  }, {
    actorAccountId: 'finance-account',
    requestId: 'request-001',
  })

  assert.deepEqual(transition, {
    operationId: 'payment-op-001',
    action: 'complete',
    eventId: 'sandbox:evt-001',
    actorAccountId: 'finance-account',
    requestId: 'request-001',
    providerEvent: {
      provider: 'sandbox',
      eventId: 'evt-001',
      operationId: 'payment-op-001',
      action: 'complete',
      occurredAt: '2026-09-18T00:00:00.000Z',
      reference: 'sandbox-provider-ref',
    },
  })
})

test('provider adapter fails closed on unknown actions and provider mismatch', () => {
  assert.throws(
    () => normalizePaymentProviderEvent({
      provider: 'sandbox',
      eventId: 'evt-002',
      operationId: 'payment-op-002',
      action: 'credit-wallet-directly',
    }),
    (error) => error instanceof PaymentProviderEventError
      && error.code === 'UNSUPPORTED_PROVIDER_ACTION',
  )

  const adapter = new SandboxPaymentProviderAdapter()
  assert.throws(
    () => adapter.normalizeEvent({
      provider: 'other-provider',
      eventId: 'evt-003',
      operationId: 'payment-op-003',
      action: 'fail',
    }),
    (error) => error instanceof PaymentProviderEventError
      && error.code === 'PROVIDER_MISMATCH',
  )
})

test('provider adapter rejects unknown fields instead of trusting provider-specific wallet data', () => {
  const adapter = new SandboxPaymentProviderAdapter()
  assert.throws(
    () => adapter.normalizeEvent({
      provider: 'sandbox',
      eventId: 'evt-004',
      operationId: 'payment-op-004',
      action: 'complete',
      walletBalance: '999999.00',
    }),
    (error) => error instanceof PaymentProviderEventError
      && error.code === 'INVALID_PROVIDER_EVENT',
  )
})

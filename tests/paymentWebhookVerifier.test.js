import test from 'node:test'
import assert from 'node:assert/strict'
import {
  PaymentWebhookVerificationError,
  signPaymentWebhookEnvelope,
  verifyPaymentWebhookEnvelope,
} from '../server/paymentWebhookVerifier.js'

const secret = 'sandbox-webhook-secret-that-is-at-least-32-bytes'
const timestamp = '1789689600'
const now = () => 1_789_689_600_000
const rawBody = '{"eventId":"evt-1","action":"complete"}'

test('signed provider webhook envelope verifies exact raw body and timestamp', () => {
  const signature = signPaymentWebhookEnvelope({ secret, timestamp, rawBody })
  const result = verifyPaymentWebhookEnvelope({
    secret,
    timestamp,
    rawBody,
    signature,
    now,
  })

  assert.equal(result.verified, true)
  assert.equal(result.timestampMs, 1_789_689_600_000)
  assert.equal(result.ageMs, 0)
})

test('webhook verification is sensitive to raw-body changes', () => {
  const signature = signPaymentWebhookEnvelope({ secret, timestamp, rawBody })
  assert.throws(
    () => verifyPaymentWebhookEnvelope({
      secret,
      timestamp,
      rawBody: '{"eventId":"evt-1","action":"fail"}',
      signature,
      now,
    }),
    (error) => error instanceof PaymentWebhookVerificationError
      && error.code === 'WEBHOOK_SIGNATURE_MISMATCH',
  )
})

test('stale and future webhook timestamps fail closed', () => {
  const signature = signPaymentWebhookEnvelope({ secret, timestamp, rawBody })

  assert.throws(
    () => verifyPaymentWebhookEnvelope({
      secret,
      timestamp,
      rawBody,
      signature,
      now: () => 1_789_690_000_001,
      toleranceSeconds: 300,
    }),
    (error) => error.code === 'WEBHOOK_TIMESTAMP_OUT_OF_RANGE',
  )

  assert.throws(
    () => verifyPaymentWebhookEnvelope({
      secret,
      timestamp,
      rawBody,
      signature,
      now: () => 1_789_689_000_000,
      toleranceSeconds: 300,
    }),
    (error) => error.code === 'WEBHOOK_TIMESTAMP_OUT_OF_RANGE',
  )
})

test('malformed signatures, short secrets and parsed objects are rejected', () => {
  assert.throws(
    () => verifyPaymentWebhookEnvelope({
      secret: 'too-short',
      timestamp,
      rawBody,
      signature: 'sha256=' + '0'.repeat(64),
      now,
    }),
    (error) => error.code === 'INVALID_WEBHOOK_SECRET',
  )

  assert.throws(
    () => verifyPaymentWebhookEnvelope({
      secret,
      timestamp,
      rawBody,
      signature: 'not-a-signature',
      now,
    }),
    (error) => error.code === 'INVALID_WEBHOOK_SIGNATURE',
  )

  assert.throws(
    () => signPaymentWebhookEnvelope({
      secret,
      timestamp,
      rawBody: { eventId: 'evt-1' },
    }),
    (error) => error.code === 'INVALID_WEBHOOK_BODY',
  )
})

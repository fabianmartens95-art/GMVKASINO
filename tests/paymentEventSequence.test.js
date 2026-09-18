import test from 'node:test'
import assert from 'node:assert/strict'
import { validatePaymentEventSequence } from '../server/paymentEventSequence.js'

const event = (eventType, createdAt = 1, eventId = eventType) => ({ eventType, createdAt, eventId })

test('healthy deposit and withdrawal event histories are accepted', () => {
  assert.deepEqual(
    validatePaymentEventSequence({ kind: 'deposit', status: 'completed' }, [event('complete')]),
    [],
  )
  assert.deepEqual(
    validatePaymentEventSequence(
      { kind: 'withdrawal', status: 'completed' },
      [event('approve', 1), event('complete', 2)],
    ),
    [],
  )
  assert.deepEqual(
    validatePaymentEventSequence(
      { kind: 'withdrawal', status: 'failed' },
      [event('approve', 1), event('fail', 2)],
    ),
    [],
  )
})

test('withdrawal completion without approval is rejected', () => {
  const mismatches = validatePaymentEventSequence(
    { kind: 'withdrawal', status: 'completed' },
    [event('complete')],
  )
  assert.ok(mismatches.some((item) => item.code === 'event_sequence_mismatch'))
})

test('events after terminal state and duplicate event types are rejected', () => {
  const mismatches = validatePaymentEventSequence(
    { kind: 'withdrawal', status: 'completed' },
    [event('approve', 1, 'a'), event('complete', 2, 'b'), event('complete', 3, 'c')],
  )
  assert.ok(mismatches.some((item) => item.code === 'duplicate_event_type'))
  assert.ok(mismatches.some((item) => item.code === 'event_after_terminal'))
  assert.ok(mismatches.some((item) => item.code === 'event_sequence_mismatch'))
})

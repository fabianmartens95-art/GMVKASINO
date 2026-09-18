const TERMINAL_EVENTS = new Set(['complete', 'reject', 'fail'])
const KNOWN_EVENTS = new Set(['approve', 'complete', 'reject', 'fail'])

function eventCounts(events) {
  const counts = new Map()
  for (const event of events) counts.set(event.eventType, (counts.get(event.eventType) || 0) + 1)
  return counts
}

function exactCounts(counts, expected, total) {
  if ([...counts.values()].reduce((sum, count) => sum + count, 0) !== total) return false
  for (const [type, count] of Object.entries(expected)) {
    if ((counts.get(type) || 0) !== count) return false
  }
  for (const [type, count] of counts.entries()) {
    if (!Object.hasOwn(expected, type) && count > 0) return false
  }
  return true
}

export function validatePaymentEventSequence(operation, events = []) {
  const mismatches = []
  const normalizedEvents = events.map((event) => ({
    eventType: String(event?.eventType || ''),
    createdAt: Number(event?.createdAt || 0),
  }))
  const counts = eventCounts(normalizedEvents)

  for (const [eventType, count] of counts.entries()) {
    if (!KNOWN_EVENTS.has(eventType)) {
      mismatches.push({ code: 'unknown_event_type', eventType })
    }
    if (count > 1) {
      mismatches.push({ code: 'duplicate_event_type', eventType })
    }
  }

  const terminalEvents = normalizedEvents.filter((event) => TERMINAL_EVENTS.has(event.eventType))
  if (terminalEvents.length) {
    const firstTerminalAt = Math.min(...terminalEvents.map((event) => event.createdAt))
    if (normalizedEvents.some((event) => event.createdAt > firstTerminalAt)) {
      mismatches.push({
        code: 'event_after_terminal',
        terminalAt: firstTerminalAt,
      })
    }
  }

  let validShape = false
  if (operation.kind === 'deposit') {
    if (operation.status === 'pending') validShape = exactCounts(counts, {}, 0)
    if (operation.status === 'completed') validShape = exactCounts(counts, { complete: 1 }, 1)
    if (operation.status === 'failed') validShape = exactCounts(counts, { fail: 1 }, 1)
  } else if (operation.kind === 'withdrawal') {
    if (operation.status === 'reserved') validShape = exactCounts(counts, {}, 0)
    if (operation.status === 'approved') validShape = exactCounts(counts, { approve: 1 }, 1)
    if (operation.status === 'completed') validShape = exactCounts(counts, { approve: 1, complete: 1 }, 2)
    if (operation.status === 'rejected') validShape = exactCounts(counts, { reject: 1 }, 1)
    if (operation.status === 'failed') {
      validShape = exactCounts(counts, { fail: 1 }, 1)
        || exactCounts(counts, { approve: 1, fail: 1 }, 2)
    }
  }

  if (!validShape) {
    mismatches.push({
      code: 'event_sequence_mismatch',
      kind: operation.kind,
      status: operation.status,
      eventCounts: Object.fromEntries([...counts.entries()].sort(([a], [b]) => a.localeCompare(b))),
    })
  }

  if (operation.kind === 'withdrawal' && ['completed', 'failed'].includes(operation.status)) {
    const approval = normalizedEvents.find((event) => event.eventType === 'approve')
    const terminal = normalizedEvents.find((event) => (
      event.eventType === (operation.status === 'completed' ? 'complete' : 'fail')
    ))
    if (approval && terminal && approval.createdAt > terminal.createdAt) {
      mismatches.push({
        code: 'event_out_of_order',
        firstExpected: 'approve',
        secondExpected: terminal.eventType,
      })
    }
  }

  return mismatches
}

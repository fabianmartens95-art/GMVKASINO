const TERMINAL_EVENTS = new Set(['complete', 'reject', 'fail'])
const KNOWN_EVENTS = new Set(['approve', 'complete', 'reject', 'fail'])

function sequenceKey(events) {
  return events.map((event) => event.eventType).join('>')
}

function duplicateTypes(events) {
  const counts = new Map()
  for (const event of events) counts.set(event.eventType, (counts.get(event.eventType) || 0) + 1)
  return [...counts.entries()].filter(([, count]) => count > 1).map(([type]) => type).sort()
}

export function validatePaymentEventSequence(operation, events = []) {
  const mismatches = []
  const normalizedEvents = events.map((event) => ({
    eventType: String(event?.eventType || ''),
    createdAt: Number(event?.createdAt || 0),
    eventId: String(event?.eventId || ''),
  }))

  const unknown = normalizedEvents.filter((event) => !KNOWN_EVENTS.has(event.eventType))
  for (const event of unknown) {
    mismatches.push({ code: 'unknown_event_type', eventType: event.eventType })
  }

  for (const eventType of duplicateTypes(normalizedEvents)) {
    mismatches.push({ code: 'duplicate_event_type', eventType })
  }

  const firstTerminalIndex = normalizedEvents.findIndex((event) => TERMINAL_EVENTS.has(event.eventType))
  if (firstTerminalIndex >= 0 && firstTerminalIndex < normalizedEvents.length - 1) {
    mismatches.push({
      code: 'event_after_terminal',
      terminalEventType: normalizedEvents[firstTerminalIndex].eventType,
    })
  }

  const actual = sequenceKey(normalizedEvents)
  let allowed = []

  if (operation.kind === 'deposit') {
    if (operation.status === 'pending') allowed = ['']
    if (operation.status === 'completed') allowed = ['complete']
    if (operation.status === 'failed') allowed = ['fail']
  } else if (operation.kind === 'withdrawal') {
    if (operation.status === 'reserved') allowed = ['']
    if (operation.status === 'approved') allowed = ['approve']
    if (operation.status === 'completed') allowed = ['approve>complete']
    if (operation.status === 'rejected') allowed = ['reject']
    if (operation.status === 'failed') allowed = ['fail', 'approve>fail']
  }

  if (!allowed.includes(actual)) {
    mismatches.push({
      code: 'event_sequence_mismatch',
      kind: operation.kind,
      status: operation.status,
      actualSequence: actual,
      allowedSequences: allowed,
    })
  }

  return mismatches
}

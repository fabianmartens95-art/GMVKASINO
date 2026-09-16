import { randomUUID } from 'node:crypto'

function eventData(event) {
  const { id, type, at, ...data } = event
  return { id, type, at, data }
}

export class PostgresAuditEventStore {
  constructor({ pool } = {}) {
    if (!pool) throw new Error('pool is required')
    this.pool = pool
  }

  async append(event) {
    const { id, type, at, data } = eventData(event)
    await this.pool.query(
      `INSERT INTO audit_events (
        id,
        event_type,
        occurred_at,
        account_id,
        request_id,
        session_ref,
        data
      ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [
        id,
        type,
        at,
        typeof data.accountId === 'string' ? data.accountId : null,
        typeof data.requestId === 'string' ? data.requestId : null,
        typeof data.sessionRef === 'string' ? data.sessionRef : null,
        JSON.stringify(data),
      ],
    )
  }
}

export class AuditLog {
  constructor({ maxEvents = 1000, now = Date.now, sink = console.log, store = null } = {}) {
    this.maxEvents = maxEvents
    this.now = now
    this.sink = sink
    this.store = store
    this.events = []
    this.pendingWrites = new Set()
  }

  record(type, data = {}) {
    const event = {
      id: randomUUID(),
      type,
      at: new Date(this.now()).toISOString(),
      ...data,
    }

    this.events.push(event)
    if (this.events.length > this.maxEvents) {
      this.events.splice(0, this.events.length - this.maxEvents)
    }

    this.sink(JSON.stringify({ scope: 'gmvkasino.audit', ...event }))

    if (this.store) {
      const write = Promise.resolve()
        .then(() => this.store.append(event))
        .catch((error) => {
          this.sink(JSON.stringify({
            scope: 'gmvkasino.audit.persistence_error',
            auditEventId: event.id,
            auditEventType: event.type,
            error: error instanceof Error ? error.message : 'unknown_error',
          }))
        })
        .finally(() => this.pendingWrites.delete(write))
      this.pendingWrites.add(write)
    }

    return { ...event }
  }

  recent(limit = 50) {
    return this.events.slice(-limit).map((event) => ({ ...event }))
  }

  async flush() {
    await Promise.allSettled([...this.pendingWrites])
  }
}

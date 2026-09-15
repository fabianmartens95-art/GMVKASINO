import { randomUUID } from 'node:crypto'

export class AuditLog {
  constructor({ maxEvents = 1000, now = Date.now, sink = console.log } = {}) {
    this.maxEvents = maxEvents
    this.now = now
    this.sink = sink
    this.events = []
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
    return { ...event }
  }

  recent(limit = 50) {
    return this.events.slice(-limit).map((event) => ({ ...event }))
  }
}

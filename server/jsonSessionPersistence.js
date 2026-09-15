import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

function normalizeSessions(value) {
  if (!Array.isArray(value)) return []
  return value.filter((session) => (
    session &&
    typeof session.id === 'string' &&
    Number.isFinite(session.balance) &&
    Number.isFinite(session.createdAt) &&
    Number.isFinite(session.lastSeenAt)
  ))
}

export class JsonSessionPersistence {
  constructor({ filePath = '.data/demo-sessions.json' } = {}) {
    this.filePath = resolve(filePath)
  }

  load() {
    if (!existsSync(this.filePath)) return []

    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8'))
      return normalizeSessions(parsed.sessions).map((session) => ({ ...session }))
    } catch {
      return []
    }
  }

  save(sessions) {
    mkdirSync(dirname(this.filePath), { recursive: true })
    const tempPath = `${this.filePath}.tmp`
    const payload = JSON.stringify({
      version: 1,
      savedAt: new Date().toISOString(),
      sessions: sessions.map((session) => ({ ...session })),
    }, null, 2)

    writeFileSync(tempPath, payload, 'utf8')
    renameSync(tempPath, this.filePath)
  }
}

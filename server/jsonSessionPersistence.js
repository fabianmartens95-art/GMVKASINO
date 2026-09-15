import { accessSync, constants, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
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

function nearestExistingParent(path) {
  let current = resolve(path)
  while (!existsSync(current)) {
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return current
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

  check() {
    if (existsSync(this.filePath)) {
      accessSync(this.filePath, constants.R_OK | constants.W_OK)
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8'))
      if (!parsed || !Array.isArray(parsed.sessions)) {
        throw new Error('Session persistence payload is invalid')
      }
      return { ok: true, backend: 'json' }
    }

    const parent = nearestExistingParent(dirname(this.filePath))
    accessSync(parent, constants.W_OK)
    return { ok: true, backend: 'json' }
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

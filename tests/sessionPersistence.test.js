import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { JsonSessionPersistence } from '../server/jsonSessionPersistence.js'
import { SessionStore } from '../server/sessionStore.js'

test('demo session survives a store restart with authoritative balance intact', () => {
  const directory = mkdtempSync(join(tmpdir(), 'gmvkasino-session-'))
  const filePath = join(directory, 'sessions.json')

  try {
    const firstStore = new SessionStore({
      startingBalance: 1000,
      persistence: new JsonSessionPersistence({ filePath }),
    })

    const created = firstStore.create({ player: 'Persistent QA' })
    const settled = firstStore.applySpin(created.id, { bet: 25, payout: 7 })
    assert.equal(settled.balance, 982)
    assert.equal(settled.spins, 1)

    const restartedStore = new SessionStore({
      startingBalance: 1000,
      persistence: new JsonSessionPersistence({ filePath }),
    })
    const restored = restartedStore.get(created.id)

    assert.equal(restored.id, created.id)
    assert.equal(restored.player, 'Persistent QA')
    assert.equal(restored.balance, 982)
    assert.equal(restored.spins, 1)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('expired persisted sessions are pruned when the store starts', () => {
  const directory = mkdtempSync(join(tmpdir(), 'gmvkasino-expired-'))
  const filePath = join(directory, 'sessions.json')
  let now = 1_000

  try {
    const persistence = new JsonSessionPersistence({ filePath })
    const firstStore = new SessionStore({
      persistence,
      ttlMs: 100,
      now: () => now,
    })
    const created = firstStore.create()

    now = 1_101
    const restartedStore = new SessionStore({
      persistence,
      ttlMs: 100,
      now: () => now,
    })

    assert.equal(restartedStore.get(created.id), null)
    assert.equal(persistence.load().length, 0)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

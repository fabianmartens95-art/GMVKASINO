import test from 'node:test'
import assert from 'node:assert/strict'
import { cyberVaultEngine, resolveCyberVault } from '../src/game/cyberVaultEngine.js'
import { GameRegistry } from '../server/gameRegistry.js'
import { cyberVaultGameAdapter } from '../server/gameAdapters/cyberVault.js'

test('Cyber Vault consumes sticky-Wild Feature Slot V1 configuration', () => {
  assert.equal(cyberVaultEngine.rows, 3)
  assert.equal(cyberVaultEngine.reels, 5)
  assert.equal(cyberVaultEngine.stickyWild, true)
  assert.equal(cyberVaultEngine.expandingWild, false)
  assert.equal(cyberVaultEngine.bonusMultiplier, 2)
  assert.equal(cyberVaultEngine.freeSpins.spins, 5)
})

test('Cyber Vault deterministic base fixture is cent-exact', () => {
  const result = resolveCyberVault({ bet: 1, rng: () => 0 })
  assert.equal(result.totalWin, 180)
  assert.equal(result.wins.length, 10)
  assert.equal(result.features.freeSpinsAwarded, 0)
})

test('Cyber Vault awards shared Free Spins and bonus multiplier', () => {
  const values = [0.999, 0.999, 0.999, ...Array(100).fill(0)]
  let index = 0
  const result = resolveCyberVault({ bet: 1, rng: () => values[index++] ?? 0 })

  assert.equal(result.scatter.count, 3)
  assert.equal(result.features.freeSpinsAwarded, 5)
  assert.equal(result.features.freeSpinsPlayed, 5)
  assert.equal(result.features.stickyWild, true)
  assert.equal(result.features.bonusMultiplier, 2)
})

test('Cyber Vault adapter satisfies shared normalized result contract', async () => {
  const registry = new GameRegistry([cyberVaultGameAdapter])
  const result = await registry.resolve('cyber-vault', { bet: 1, rng: () => 0 })

  assert.equal(result.totalWin, 180)
  assert.equal(Object.hasOwn(result, 'balance'), false)
  assert.equal(Object.hasOwn(result, 'spinId'), false)
})

test('Cyber Vault simulation remains finite, non-negative and cent-exact', () => {
  for (let sample = 1; sample <= 100; sample += 1) {
    let state = sample * 211
    const rng = () => {
      state = (state * 48271) % 0x7fffffff
      return state / 0x7fffffff
    }
    const result = resolveCyberVault({ bet: 5, rng })
    assert.equal(Number.isFinite(result.totalWin), true)
    assert.ok(result.totalWin >= 0)
    assert.equal(Number.isInteger(result.totalWin * 100), true)
  }
})

import { FEATURE_5X3_PAYLINES, createFeatureSlotEngine } from './featureSlotEngine.js'

export const CYBER_VAULT_SYMBOLS = Object.freeze([
  Object.freeze({ id: 'quantum-chip', label: 'Q', weight: 6, multiplier: 18 }),
  Object.freeze({ id: 'cyber-core', label: '◈', weight: 10, multiplier: 11 }),
  Object.freeze({ id: 'laser-key', label: '⌁', weight: 14, multiplier: 7 }),
  Object.freeze({ id: 'data-cube', label: '▣', weight: 18, multiplier: 5 }),
  Object.freeze({ id: 'credit-node', label: '●', weight: 24, multiplier: 3 }),
  Object.freeze({ id: 'neon-wild', label: 'W', weight: 8, multiplier: 20, kind: 'wild' }),
  Object.freeze({ id: 'access-scatter', label: 'A', weight: 5, multiplier: 0, kind: 'scatter' }),
])

export const CYBER_VAULT_PAYLINES = FEATURE_5X3_PAYLINES

export const cyberVaultEngine = createFeatureSlotEngine({
  name: 'Cyber Vault',
  symbols: CYBER_VAULT_SYMBOLS,
  paylines: CYBER_VAULT_PAYLINES,
  freeSpins: { triggerCount: 3, spins: 5 },
  scatterPayouts: { 3: 2, 4: 6, 5: 15 },
  expandingWild: false,
  stickyWild: true,
  bonusMultiplier: 2,
})

export function createCyberVaultGrid(rng = Math.random) {
  return cyberVaultEngine.createGrid(rng)
}

export function evaluateCyberVaultGrid(grid, bet, options) {
  return cyberVaultEngine.evaluateGrid(grid, bet, options)
}

export function resolveCyberVault({ bet, rng = Math.random } = {}) {
  return cyberVaultEngine.resolve({ bet, rng })
}

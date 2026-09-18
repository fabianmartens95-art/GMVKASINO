import { resolveCyberVault } from '../../src/game/cyberVaultEngine.js'

export const cyberVaultGameAdapter = Object.freeze({
  id: 'cyber-vault',
  resolve({ bet, rng }) {
    return resolveCyberVault({ bet, rng })
  },
})

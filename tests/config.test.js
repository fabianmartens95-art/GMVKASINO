import test from 'node:test'
import assert from 'node:assert/strict'
import { loadServerConfig } from '../server/config.js'

test('server config uses safe defaults for an empty environment', () => {
  const config = loadServerConfig({})

  assert.equal(config.host, '0.0.0.0')
  assert.equal(config.port, 8787)
  assert.equal(config.startingBalance, 1000)
  assert.equal(config.sessionIdleTtlMs, 86_400_000)
  assert.equal(config.sessionAbsoluteTtlMs, 604_800_000)
  assert.equal(config.sessionStorePath, '.data/demo-sessions.json')
})

test('server config accepts Railway-style runtime values', () => {
  const config = loadServerConfig({
    HOST: '0.0.0.0',
    PORT: '12345',
    DEMO_STARTING_BALANCE: '2500.5',
    DEMO_SESSION_IDLE_TTL_MS: '60000',
    DEMO_SESSION_ABSOLUTE_TTL_MS: '3600000',
    DEMO_SESSION_STORE_PATH: '/data/demo-sessions.json',
    SPIN_RATE_LIMIT_WINDOW_MS: '5000',
    SPIN_RATE_LIMIT_MAX: '10',
    MAX_JSON_BODY_BYTES: '8192',
    AUDIT_MAX_EVENTS: '500',
  })

  assert.equal(config.port, 12345)
  assert.equal(config.startingBalance, 2500.5)
  assert.equal(config.sessionIdleTtlMs, 60000)
  assert.equal(config.sessionAbsoluteTtlMs, 3600000)
  assert.equal(config.sessionStorePath, '/data/demo-sessions.json')
})

test('legacy DEMO_SESSION_TTL_MS remains an idle-TTL fallback', () => {
  const config = loadServerConfig({ DEMO_SESSION_TTL_MS: '120000' })
  assert.equal(config.sessionIdleTtlMs, 120000)
})

test('server config fails fast on invalid numeric deployment settings', () => {
  assert.throws(
    () => loadServerConfig({ PORT: 'not-a-port' }),
    /Invalid PORT/,
  )
  assert.throws(
    () => loadServerConfig({ PORT: '70000' }),
    /Invalid PORT/,
  )
  assert.throws(
    () => loadServerConfig({ SPIN_RATE_LIMIT_MAX: '1.5' }),
    /Invalid SPIN_RATE_LIMIT_MAX/,
  )
  assert.throws(
    () => loadServerConfig({ DEMO_SESSION_ABSOLUTE_TTL_MS: '0' }),
    /Invalid DEMO_SESSION_ABSOLUTE_TTL_MS/,
  )
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { loadServerConfig } from '../server/config.js'
import { createPostgresPoolConfig } from '../server/index.js'

test('PostgreSQL SSL verifies certificates by default when enabled', () => {
  const config = loadServerConfig({
    DATABASE_URL: 'postgresql://demo:demo@example.invalid/gmvkasino',
    DATABASE_SSL: 'true',
  })

  const poolConfig = createPostgresPoolConfig(config)
  assert.equal(poolConfig.connectionString, config.databaseUrl)
  assert.deepEqual(poolConfig.ssl, { rejectUnauthorized: true })
})

test('PostgreSQL SSL accepts an explicit CA with escaped newlines', () => {
  const config = loadServerConfig({
    DATABASE_URL: 'postgresql://demo:demo@example.invalid/gmvkasino',
    DATABASE_SSL: 'true',
    DATABASE_SSL_CA: '-----BEGIN CERTIFICATE-----\\nCA-DATA\\n-----END CERTIFICATE-----',
  })

  const poolConfig = createPostgresPoolConfig(config)
  assert.equal(
    poolConfig.ssl.ca,
    '-----BEGIN CERTIFICATE-----\nCA-DATA\n-----END CERTIFICATE-----',
  )
  assert.equal(poolConfig.ssl.rejectUnauthorized, true)
})

test('PostgreSQL SSL is omitted when disabled', () => {
  const config = loadServerConfig({
    DATABASE_URL: 'postgresql://demo:demo@127.0.0.1/gmvkasino',
  })

  const poolConfig = createPostgresPoolConfig(config)
  assert.equal('ssl' in poolConfig, false)
})

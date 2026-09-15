import test from 'node:test'
import assert from 'node:assert/strict'
import { createHttpServer } from '../server/httpServer.js'

const REVISION = '0123456789abcdef0123456789abcdef01234567'

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  return `http://127.0.0.1:${address.port}`
}

async function close(server) {
  await new Promise((resolve) => server.close(resolve))
}

test('liveness and readiness expose the configured deployment revision', async () => {
  const service = {
    checkReadiness: async () => ({ ok: true, backend: 'memory' }),
  }
  const server = createHttpServer({
    service,
    config: {
      deploymentRevision: REVISION,
      maxBodyBytes: 16_384,
      metricsToken: '',
    },
    staticDir: '/tmp/gmvkasino-no-static',
    log: () => {},
  })

  try {
    const baseUrl = await listen(server)
    const live = await (await fetch(`${baseUrl}/api/v1/health/live`)).json()
    const ready = await (await fetch(`${baseUrl}/api/v1/health/ready`)).json()

    assert.equal(live.revision, REVISION)
    assert.equal(ready.revision, REVISION)
    assert.equal(ready.persistence, 'memory')
  } finally {
    if (server.listening) await close(server)
  }
})

test('health revision is null when no deployment revision is available', async () => {
  const service = {
    checkReadiness: async () => ({ ok: true, backend: 'memory' }),
  }
  const server = createHttpServer({
    service,
    config: {
      deploymentRevision: '',
      maxBodyBytes: 16_384,
      metricsToken: '',
    },
    staticDir: '/tmp/gmvkasino-no-static',
    log: () => {},
  })

  try {
    const baseUrl = await listen(server)
    const live = await (await fetch(`${baseUrl}/api/v1/health/live`)).json()
    assert.equal(live.revision, null)
  } finally {
    if (server.listening) await close(server)
  }
})

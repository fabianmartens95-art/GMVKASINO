import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const PROJECT_ROOT = fileURLToPath(new URL('..', import.meta.url))
const remoteBaseUrl = process.env.SMOKE_BASE_URL?.replace(/\/+$/, '')

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function assertHealth(baseUrl, path, expectedStatus) {
  const response = await fetch(`${baseUrl}${path}`)
  if (!response.ok) throw new Error(`${path} failed with HTTP ${response.status}`)

  const payload = await response.json()
  if (
    payload.ok !== true
    || payload.mode !== 'demo'
    || payload.apiVersion !== 'v1'
    || payload.status !== expectedStatus
  ) {
    throw new Error(`${path} payload is not the expected GMVKASINO ${expectedStatus} response`)
  }

  return payload
}

async function assertDeployment(baseUrl) {
  await assertHealth(baseUrl, '/api/v1/health/live', 'live')
  await assertHealth(baseUrl, '/api/v1/health/ready', 'ready')

  const frontendResponse = await fetch(`${baseUrl}/`)
  if (!frontendResponse.ok) throw new Error(`Frontend smoke check failed with HTTP ${frontendResponse.status}`)

  const contentType = frontendResponse.headers.get('content-type') || ''
  const html = await frontendResponse.text()
  if (!contentType.includes('text/html') || !html.includes('id="root"')) {
    throw new Error('Frontend smoke check did not return the built application shell')
  }

  console.log(`Smoke check passed: ${baseUrl}`)
}

async function waitUntilReady(baseUrl, child) {
  let lastError
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`GMVKASINO server exited before becoming ready (code ${child.exitCode})`)
    }
    try {
      const response = await fetch(`${baseUrl}/api/v1/health/ready`)
      if (response.ok) return
    } catch (error) {
      lastError = error
    }
    await delay(250)
  }
  throw lastError || new Error('GMVKASINO server did not become ready in time')
}

async function runLocalSmoke() {
  const port = Number(process.env.SMOKE_PORT || 8790)
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) throw new Error('SMOKE_PORT must be a valid TCP port')

  const directory = mkdtempSync(join(tmpdir(), 'gmvkasino-smoke-'))
  const baseUrl = `http://127.0.0.1:${port}`
  let output = ''
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      DATABASE_URL: '',
      DATABASE_SSL: 'false',
      DEMO_SESSION_STORE_PATH: join(directory, 'demo-sessions.json'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  child.stdout.on('data', (chunk) => { output += chunk.toString() })
  child.stderr.on('data', (chunk) => { output += chunk.toString() })

  try {
    await waitUntilReady(baseUrl, child)
    await assertDeployment(baseUrl)
  } catch (error) {
    if (output) console.error(output)
    throw error
  } finally {
    if (child.exitCode === null) child.kill('SIGTERM')
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      delay(2_000),
    ])
    rmSync(directory, { recursive: true, force: true })
  }
}

if (remoteBaseUrl) await assertDeployment(remoteBaseUrl)
else await runLocalSmoke()

import { pathToFileURL } from 'node:url'

function normalizedSha(value, name) {
  const revision = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (!/^[0-9a-f]{40}$/.test(revision)) {
    throw new Error(`${name} must be a full 40-character git SHA`)
  }
  return revision
}

function healthUrl(baseUrl) {
  let url
  try {
    url = new URL(baseUrl)
  } catch {
    throw new Error('PRODUCTION_BASE_URL must be a valid URL')
  }
  if (url.protocol !== 'https:') throw new Error('PRODUCTION_BASE_URL must use HTTPS')
  url.pathname = '/api/v1/health/live'
  url.search = ''
  url.hash = ''
  return url
}

export async function verifyProductionRevision({
  baseUrl,
  expectedRevision,
  fetchImpl = fetch,
} = {}) {
  const expected = normalizedSha(expectedRevision, 'EXPECTED_REVISION')
  const response = await fetchImpl(healthUrl(baseUrl), {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) {
    throw new Error(`Production liveness returned HTTP ${response.status}`)
  }

  const payload = await response.json()
  if (payload?.ok !== true || payload?.status !== 'live' || payload?.mode !== 'demo') {
    throw new Error('Production must remain in demo mode until the real-money gate passes')
  }

  const deployed = normalizedSha(payload.revision, 'deployed revision')
  if (deployed !== expected) {
    throw new Error(`Production revision mismatch: expected ${expected}, deployed ${deployed}`)
  }

  return { ok: true, revision: deployed, mode: 'demo' }
}

async function main() {
  const result = await verifyProductionRevision({
    baseUrl: process.env.PRODUCTION_BASE_URL,
    expectedRevision: process.env.EXPECTED_REVISION,
  })
  console.log(JSON.stringify(result))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(JSON.stringify({
      ok: false,
      error: error?.message || 'Production revision verification failed',
    }))
    process.exitCode = 1
  })
}

import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { evaluateLoadReport } from './loadBaselinePolicy.mjs'

function envNumber(name, fallback) {
  const value = process.env[name]
  return value === undefined || value === '' ? fallback : Number(value)
}

async function main() {
  const path = process.argv[2]
  if (!path) throw new Error('Usage: npm run load:evaluate -- <report.json>')

  const report = JSON.parse(await readFile(path, 'utf8'))
  const result = evaluateLoadReport(report, {
    maxErrorRate: envNumber('LOAD_MAX_ERROR_RATE', 0.01),
    maxP95Ms: envNumber('LOAD_MAX_P95_MS', 1500),
    maxP99Ms: envNumber('LOAD_MAX_P99_MS', 2500),
  })

  console.log(JSON.stringify(result, null, 2))
  if (!result.ok) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(JSON.stringify({
      ok: false,
      error: error?.message || 'Load baseline evaluation failed',
    }))
    process.exitCode = 1
  })
}

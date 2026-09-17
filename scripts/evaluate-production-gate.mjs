import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

function normalized(value) {
  return typeof value === 'string' ? value.trim() : ''
}

export function evaluateProductionGate(policy, env = process.env) {
  const results = []

  for (const check of policy.requiredStatuses || []) {
    const actual = normalized(env[check.env])
    const passed = actual === check.expected
    results.push({
      id: check.id,
      kind: 'status',
      env: check.env,
      expected: check.expected,
      actual: actual || null,
      passed,
    })
  }

  for (const check of policy.requiredEvidence || []) {
    const actual = normalized(env[check.env])
    const minLength = Number.isInteger(check.minLength) ? check.minLength : 1
    const passed = actual.length >= minLength
    results.push({
      id: check.id,
      kind: 'evidence',
      env: check.env,
      minLength,
      actual: passed ? '[provided]' : null,
      passed,
    })
  }

  for (const check of policy.conditionalStatuses || []) {
    const conditionActual = normalized(env[check.conditionEnv])
    const active = conditionActual === check.conditionValue
    if (!active) {
      results.push({
        id: check.id,
        kind: 'conditional-status',
        active: false,
        passed: true,
      })
      continue
    }

    const actual = normalized(env[check.env])
    const passed = actual === check.expected
    results.push({
      id: check.id,
      kind: 'conditional-status',
      active: true,
      env: check.env,
      expected: check.expected,
      actual: actual || null,
      passed,
    })
  }

  const failed = results.filter((result) => !result.passed)
  return {
    ok: failed.length === 0,
    decision: failed.length === 0 ? 'GO' : (policy.defaultDecision || 'BLOCK'),
    failedChecks: failed.map((result) => result.id),
    results,
  }
}

async function loadPolicy(path) {
  const raw = await readFile(path, 'utf8')
  return JSON.parse(raw)
}

async function main() {
  const policyPath = process.env.PRODUCTION_GATE_POLICY || 'config/production-gate.json'
  const policy = await loadPolicy(policyPath)
  const result = evaluateProductionGate(policy)
  console.log(JSON.stringify(result, null, 2))
  if (!result.ok) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(JSON.stringify({
      ok: false,
      decision: 'BLOCK',
      error: error?.message || 'Production gate evaluation failed',
    }))
    process.exitCode = 1
  })
}

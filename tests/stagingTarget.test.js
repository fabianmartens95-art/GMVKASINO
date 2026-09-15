import test from 'node:test'
import assert from 'node:assert/strict'
import { validateStagingTargets } from '../scripts/validateStagingTarget.mjs'

test('staging target validation accepts distinct HTTPS deployment origins', () => {
  const result = validateStagingTargets({
    stagingBaseUrl: 'https://staging.example.com',
    primaryBaseUrl: 'https://demo.example.com/',
  })

  assert.equal(result.stagingOrigin, 'https://staging.example.com')
  assert.equal(result.primaryOrigin, 'https://demo.example.com')
})

test('staging target validation rejects missing, insecure or credential-bearing URLs', () => {
  assert.throws(() => validateStagingTargets({}), /STAGING_BASE_URL is required/)
  assert.throws(
    () => validateStagingTargets({ stagingBaseUrl: 'http://staging.example.com' }),
    /must use https/,
  )
  assert.throws(
    () => validateStagingTargets({ stagingBaseUrl: 'https://user:pass@staging.example.com' }),
    /embedded credentials/,
  )
})

test('staging target validation rejects paths, query strings and fragments', () => {
  assert.throws(
    () => validateStagingTargets({ stagingBaseUrl: 'https://staging.example.com/app' }),
    /without a path/,
  )
  assert.throws(
    () => validateStagingTargets({ stagingBaseUrl: 'https://staging.example.com/?token=secret' }),
    /query parameters or fragments/,
  )
  assert.throws(
    () => validateStagingTargets({ stagingBaseUrl: 'https://staging.example.com/#secret' }),
    /query parameters or fragments/,
  )
})

test('staging target validation rejects the primary deployment origin even with slash differences', () => {
  assert.throws(
    () => validateStagingTargets({
      stagingBaseUrl: 'https://demo.example.com/',
      primaryBaseUrl: 'https://demo.example.com',
    }),
    /different origins/,
  )
})

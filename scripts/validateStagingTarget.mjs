export function validateStagingTargets({ stagingBaseUrl, primaryBaseUrl = '' } = {}) {
  const rawStaging = String(stagingBaseUrl || '').trim()
  const rawPrimary = String(primaryBaseUrl || '').trim()

  if (!rawStaging) throw new Error('STAGING_BASE_URL is required')

  const staging = parseDeploymentUrl(rawStaging, 'STAGING_BASE_URL')
  const primary = rawPrimary ? parseDeploymentUrl(rawPrimary, 'PRIMARY_BASE_URL') : null

  if (primary && staging.origin === primary.origin) {
    throw new Error('Staging and primary base URLs must resolve to different origins')
  }

  return {
    stagingOrigin: staging.origin,
    primaryOrigin: primary?.origin || null,
  }
}

function parseDeploymentUrl(value, name) {
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    throw new Error(`${name} must be a valid absolute URL`)
  }

  if (parsed.protocol !== 'https:') throw new Error(`${name} must use https://`)
  if (parsed.username || parsed.password) throw new Error(`${name} must not contain embedded credentials`)
  if (parsed.search || parsed.hash) throw new Error(`${name} must not contain query parameters or fragments`)
  if (parsed.pathname !== '/' && parsed.pathname !== '') {
    throw new Error(`${name} must point to the deployment origin without a path`)
  }

  return parsed
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const result = validateStagingTargets({
      stagingBaseUrl: process.env.STAGING_BASE_URL,
      primaryBaseUrl: process.env.PRIMARY_BASE_URL,
    })
    console.log(`Validated staging origin: ${result.stagingOrigin}`)
  } catch (error) {
    console.error(error.message)
    process.exit(1)
  }
}

import { pathToFileURL } from 'node:url'

function issueIsProductionBlocker(issue) {
  if (issue.pull_request) return false
  const title = String(issue.title || '')
  const labels = Array.isArray(issue.labels)
    ? issue.labels.map((label) => typeof label === 'string' ? label : label?.name).filter(Boolean)
    : []
  return title.includes('[PROD-BLOCKER]') || labels.includes('production-blocker')
}

export async function findOpenProductionBlockers({
  repository = process.env.GITHUB_REPOSITORY,
  token = process.env.GITHUB_TOKEN,
  fetchImpl = fetch,
} = {}) {
  if (!repository || !/^[^/]+\/[^/]+$/.test(repository)) {
    throw new Error('GITHUB_REPOSITORY must be owner/name')
  }
  if (!token) throw new Error('GITHUB_TOKEN is required')

  const blockers = []
  for (let page = 1; page <= 10; page += 1) {
    const response = await fetchImpl(
      `https://api.github.com/repos/${repository}/issues?state=open&per_page=100&page=${page}`,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': '2022-11-28',
        },
        signal: AbortSignal.timeout(15_000),
      },
    )
    if (!response.ok) {
      throw new Error(`GitHub issues lookup failed with HTTP ${response.status}`)
    }
    const issues = await response.json()
    if (!Array.isArray(issues)) throw new Error('GitHub issues lookup returned an invalid payload')
    blockers.push(...issues.filter(issueIsProductionBlocker).map((issue) => ({
      number: issue.number,
      title: issue.title,
      url: issue.html_url,
    })))
    if (issues.length < 100) break
  }

  return blockers
}

async function main() {
  const blockers = await findOpenProductionBlockers()
  if (blockers.length > 0) {
    console.error(JSON.stringify({ ok: false, blockers }, null, 2))
    process.exitCode = 1
    return
  }
  console.log(JSON.stringify({ ok: true, blockers: [] }))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(JSON.stringify({ ok: false, error: error?.message || 'Production blocker check failed' }))
    process.exitCode = 1
  })
}

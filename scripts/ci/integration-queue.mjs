import { appendFileSync } from "node:fs";

const repository = process.env.GITHUB_REPOSITORY;
const token = process.env.GITHUB_TOKEN;
const requiredCheck = process.env.QUEUE_REQUIRED_CHECK;
const defaultBranch = process.env.QUEUE_BASE_BRANCH || "main";

if (!repository || !token || !requiredCheck) {
  console.error("integration-queue: GITHUB_REPOSITORY, GITHUB_TOKEN and QUEUE_REQUIRED_CHECK are required");
  process.exit(2);
}

const apiBase = `https://api.github.com/repos/${repository}`;
const allowedAssociations = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
const blockingLabels = new Set(["queue:hold", "gate:production", "gate:founder", "do-not-merge"]);

function summary(message) {
  console.log(message);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${message}\n`);
  }
}

function field(body, name) {
  const escaped = name.replace(/[.*+?^$()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped}:\\s*(.+?)\\s*$`, "im").exec(body)?.[1]?.trim() ?? "";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function github(path, options = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "gmv-automatic-integration-queue",
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text };
    }
  }

  return { ok: response.ok, status: response.status, data };
}

function isExplicitlyQueueEligible(pull) {
  const body = typeof pull.body === "string" ? pull.body : "";
  const labels = new Set((pull.labels || []).map((label) => label.name).filter(Boolean));

  if (pull.base?.ref !== defaultBranch) return false;
  if (pull.draft) return false;
  if (pull.head?.repo?.full_name !== repository) return false;
  if (!allowedAssociations.has(pull.author_association)) return false;
  if ([...labels].some((label) => blockingLabels.has(label))) return false;
  if (field(body, "Auto merge").toLowerCase() !== "yes") return false;
  if (field(body, "Integration wave").toLowerCase() === "yes") return false;
  if (field(body, "Production gate").toLowerCase() !== "no") return false;
  if (field(body, "Founder decision").toLowerCase() !== "no") return false;

  return true;
}

async function dependenciesSatisfied(pull) {
  const body = typeof pull.body === "string" ? pull.body : "";
  const dependencyLine = field(body, "Depends on");

  if (!dependencyLine || /^none$/i.test(dependencyLine)) {
    return { ok: true, reason: "no dependencies" };
  }

  const numbers = [...new Set([...dependencyLine.matchAll(/#(\d+)/g)].map((match) => Number(match[1])))]
    .filter((number) => number !== pull.number);

  if (!numbers.length) {
    return { ok: false, reason: "Depends on must be 'none' or reference #numbers" };
  }

  for (const number of numbers) {
    const dependencyPr = await github(`/pulls/${number}`);
    if (dependencyPr.ok) {
      if (!dependencyPr.data?.merged_at) {
        return { ok: false, reason: `dependency PR #${number} is not merged` };
      }
      continue;
    }

    if (dependencyPr.status !== 404) {
      throw new Error(`dependency lookup for #${number} failed with ${dependencyPr.status}`);
    }

    const dependencyIssue = await github(`/issues/${number}`);
    if (!dependencyIssue.ok || dependencyIssue.data?.state !== "closed") {
      return { ok: false, reason: `dependency issue #${number} is not closed` };
    }
  }

  return { ok: true, reason: "dependencies satisfied" };
}

async function checksReady(sha) {
  const checks = await github(`/commits/${sha}/check-runs?per_page=100`);
  if (!checks.ok) throw new Error(`check-runs lookup failed with ${checks.status}`);

  const latest = new Map();
  for (const check of checks.data?.check_runs || []) {
    const previous = latest.get(check.name);
    if (!previous || Number(check.id) > Number(previous.id)) latest.set(check.name, check);
  }

  const baseline = latest.get(requiredCheck);
  if (!baseline) {
    return { ok: false, reason: `required check '${requiredCheck}' has not started` };
  }
  if (baseline.status !== "completed") {
    return { ok: false, reason: `required check '${requiredCheck}' is ${baseline.status}` };
  }
  if (baseline.conclusion !== "success") {
    return { ok: false, reason: `required check '${requiredCheck}' concluded ${baseline.conclusion}` };
  }

  const accepted = new Set(["success", "neutral", "skipped"]);
  for (const check of latest.values()) {
    if (check.status !== "completed") {
      return { ok: false, reason: `check '${check.name}' is ${check.status}` };
    }
    if (!accepted.has(check.conclusion)) {
      return { ok: false, reason: `check '${check.name}' concluded ${check.conclusion}` };
    }
  }

  const statuses = await github(`/commits/${sha}/status`);
  if (!statuses.ok) throw new Error(`combined status lookup failed with ${statuses.status}`);
  if ((statuses.data?.statuses || []).length > 0 && statuses.data?.state !== "success") {
    return { ok: false, reason: `combined commit status is ${statuses.data?.state}` };
  }

  return { ok: true, reason: "all current checks green" };
}

async function reviewsReady(number) {
  const reviews = await github(`/pulls/${number}/reviews?per_page=100`);
  if (!reviews.ok) throw new Error(`reviews lookup for #${number} failed with ${reviews.status}`);

  const latestByReviewer = new Map();
  for (const review of reviews.data || []) {
    const login = review.user?.login;
    if (!login) continue;
    const previous = latestByReviewer.get(login);
    if (!previous || Number(review.id) > Number(previous.id)) latestByReviewer.set(login, review);
  }

  for (const review of latestByReviewer.values()) {
    if (review.state === "CHANGES_REQUESTED") {
      return { ok: false, reason: `changes requested by ${review.user.login}` };
    }
  }

  return { ok: true, reason: "no active change request" };
}

async function freshPull(number) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await github(`/pulls/${number}`);
    if (!response.ok) throw new Error(`PR #${number} lookup failed with ${response.status}`);
    if (response.data?.mergeable !== null) return response.data;
    await sleep(1000);
  }
  const response = await github(`/pulls/${number}`);
  if (!response.ok) throw new Error(`PR #${number} lookup failed with ${response.status}`);
  return response.data;
}

async function updateBranch(pull) {
  const response = await github(`/pulls/${pull.number}/update-branch`, {
    method: "PUT",
    body: JSON.stringify({ expected_head_sha: pull.head.sha }),
    headers: { "Content-Type": "application/json" },
  });

  if (!response.ok) {
    summary(`Queue: could not update #${pull.number} onto current ${defaultBranch} (HTTP ${response.status}).`);
    return false;
  }

  summary(`Queue: updated #${pull.number} onto current ${defaultBranch}; fresh CI will decide the next action.`);
  return true;
}

async function mergePull(pull) {
  const response = await github(`/pulls/${pull.number}/merge`, {
    method: "PUT",
    body: JSON.stringify({
      sha: pull.head.sha,
      merge_method: "squash",
      commit_title: `${pull.title} (#${pull.number})`,
    }),
    headers: { "Content-Type": "application/json" },
  });

  if (!response.ok || response.data?.merged !== true) {
    summary(`Queue: merge of #${pull.number} was refused (HTTP ${response.status}); leaving it open.`);
    return false;
  }

  summary(`Queue: merged #${pull.number} at verified head ${pull.head.sha}.`);
  return true;
}

async function main() {
  const response = await github(`/pulls?state=open&base=${encodeURIComponent(defaultBranch)}&sort=created&direction=asc&per_page=100`);
  if (!response.ok) throw new Error(`open PR lookup failed with ${response.status}`);

  const candidates = (response.data || []).filter(isExplicitlyQueueEligible);
  if (!candidates.length) {
    summary("Queue: no explicitly eligible PRs.");
    return;
  }

  let behindCandidate = null;

  for (const pull of candidates) {
    const dependencies = await dependenciesSatisfied(pull);
    if (!dependencies.ok) {
      summary(`Queue: #${pull.number} waiting — ${dependencies.reason}.`);
      continue;
    }

    const checks = await checksReady(pull.head.sha);
    if (!checks.ok) {
      summary(`Queue: #${pull.number} waiting — ${checks.reason}.`);
      continue;
    }

    const reviews = await reviewsReady(pull.number);
    if (!reviews.ok) {
      summary(`Queue: #${pull.number} blocked — ${reviews.reason}.`);
      continue;
    }

    const fresh = await freshPull(pull.number);
    if (fresh.head?.sha !== pull.head.sha) {
      summary(`Queue: #${pull.number} changed during evaluation; waiting for fresh CI.`);
      continue;
    }

    if (fresh.mergeable_state === "dirty") {
      summary(`Queue: #${pull.number} has merge conflicts and needs intervention.`);
      continue;
    }

    if (fresh.mergeable_state === "behind") {
      behindCandidate ??= fresh;
      continue;
    }

    if (fresh.mergeable !== true) {
      summary(`Queue: #${pull.number} is not currently mergeable (state: ${fresh.mergeable_state}).`);
      continue;
    }

    if (await mergePull(fresh)) return;
  }

  if (behindCandidate) {
    await updateBranch(behindCandidate);
    return;
  }

  summary("Queue: no merge or branch update is safe right now.");
}

main().catch((error) => {
  console.error(error);
  summary(`Queue: failed closed — ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});

import { appendFileSync, readFileSync } from "node:fs";

const repository = process.env.GITHUB_REPOSITORY;
const token = process.env.GITHUB_TOKEN;
const runId = process.env.GITHUB_RUN_ID || "manual";
const configPath = process.env.WAVE_CONFIG;

if (!repository || !token || !configPath) {
  console.error("integration-wave-v2: GITHUB_REPOSITORY, GITHUB_TOKEN and WAVE_CONFIG are required");
  process.exit(2);
}

const config = JSON.parse(readFileSync(configPath, "utf8"));
const apiBase = `https://api.github.com/repos/${repository}`;
const allowedAssociations = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
const blockingLabels = new Set(["queue:hold", "gate:production", "gate:founder", "do-not-merge", "wave:hold"]);

function summary(message) {
  console.log(message);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${message}\n`);
}

function field(body, name) {
  const wanted = `${name.toLowerCase()}:`;
  const line = String(body || "").split(/\r?\n/).find((value) => value.trim().toLowerCase().startsWith(wanted));
  if (!line) return "";
  return line.trim().slice(line.indexOf(":") + 1).trim();
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
      "User-Agent": "gmv-integration-wave-v2",
      ...(options.headers || {}),
    },
  });
  const raw = await response.text();
  let data = null;
  if (raw) {
    try { data = JSON.parse(raw); }
    catch { data = { message: raw }; }
  }
  return { ok: response.ok, status: response.status, data };
}

async function checksReady(sha) {
  const checks = await github(`/commits/${sha}/check-runs?per_page=100`);
  if (!checks.ok) throw new Error(`check-runs lookup failed with ${checks.status}`);

  const latest = new Map();
  for (const check of checks.data?.check_runs || []) {
    const previous = latest.get(check.name);
    if (!previous || Number(check.id) > Number(previous.id)) latest.set(check.name, check);
  }

  const baseline = latest.get(config.requiredCheck);
  if (!baseline) return { ok:false, reason:`required check '${config.requiredCheck}' has not started` };
  if (baseline.status !== "completed") return { ok:false, reason:`required check '${config.requiredCheck}' is ${baseline.status}` };
  if (baseline.conclusion !== "success") return { ok:false, reason:`required check '${config.requiredCheck}' concluded ${baseline.conclusion}` };

  const accepted = new Set(["success", "neutral", "skipped"]);
  for (const check of latest.values()) {
    if (check.status !== "completed") return { ok:false, reason:`check '${check.name}' is ${check.status}` };
    if (!accepted.has(check.conclusion)) return { ok:false, reason:`check '${check.name}' concluded ${check.conclusion}` };
  }

  const statuses = await github(`/commits/${sha}/status`);
  if (!statuses.ok) throw new Error(`combined status lookup failed with ${statuses.status}`);
  if ((statuses.data?.statuses || []).length && statuses.data?.state !== "success") {
    return { ok:false, reason:`combined commit status is ${statuses.data?.state}` };
  }
  return { ok:true, reason:"all current checks green" };
}

async function requiredCheckReady(sha) {
  const checks = await github(`/commits/${sha}/check-runs?per_page=100`);
  if (!checks.ok) throw new Error(`check-runs lookup failed with ${checks.status}`);

  const latest = new Map();
  for (const check of checks.data?.check_runs || []) {
    const previous = latest.get(check.name);
    if (!previous || Number(check.id) > Number(previous.id)) latest.set(check.name, check);
  }

  const baseline = latest.get(config.requiredCheck);
  if (!baseline) return { ok:false, state:"missing", reason:`required check '${config.requiredCheck}' has not started` };
  if (baseline.status !== "completed") return { ok:false, state:"pending", reason:`required check '${config.requiredCheck}' is ${baseline.status}` };
  if (baseline.conclusion !== "success") return { ok:false, state:"failed", reason:`required check '${config.requiredCheck}' concluded ${baseline.conclusion}` };
  return { ok:true, state:"success", reason:`required check '${config.requiredCheck}' is green` };
}

function verificationBranchName(wave) {
  return `integration/verify-wave-v2-${wave.number}`;
}

async function dispatchVerificationCi(wave, verificationSha) {
  const branch = verificationBranchName(wave);
  const create = await github("/git/refs", {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body:JSON.stringify({ ref:`refs/heads/${branch}`, sha:verificationSha }),
  });

  if (!create.ok && create.status !== 422) {
    throw new Error(`verification branch creation failed with ${create.status}`);
  }

  if (!create.ok && create.status === 422) {
    const update = await github(`/git/refs/heads/${branch}`, {
      method:"PATCH",
      headers:{ "Content-Type":"application/json" },
      body:JSON.stringify({ sha:verificationSha, force:true }),
    });
    if (!update.ok) throw new Error(`verification branch update failed with ${update.status}`);
  }

  const dispatched = await github("/actions/workflows/ci.yml/dispatches", {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body:JSON.stringify({ ref:branch }),
  });
  if (!dispatched.ok) throw new Error(`verification CI dispatch failed with ${dispatched.status}`);

  summary(`Wave: dispatched combined CI for #${wave.number} on GitHub merge commit ${verificationSha}.`);
}

async function reviewsReady(number) {
  const reviews = await github(`/pulls/${number}/reviews?per_page=100`);
  if (!reviews.ok) throw new Error(`reviews lookup for #${number} failed with ${reviews.status}`);
  const latest = new Map();
  for (const review of reviews.data || []) {
    const login = review.user?.login;
    if (!login) continue;
    const previous = latest.get(login);
    if (!previous || Number(review.id) > Number(previous.id)) latest.set(login, review);
  }
  for (const review of latest.values()) {
    if (review.state === "CHANGES_REQUESTED") return { ok:false, reason:`changes requested by ${review.user.login}` };
  }
  return { ok:true };
}

async function dependenciesReady(pull) {
  const dependencyLine = field(pull.body, "Depends on");
  if (!dependencyLine || /^none$/i.test(dependencyLine)) return { ok:true };

  const numbers = [...new Set([...dependencyLine.matchAll(/#(\d+)/g)].map((match) => Number(match[1])))]
    .filter((number) => number !== pull.number);
  if (!numbers.length) return { ok:false, reason:"Depends on must be 'none' or reference #numbers" };

  for (const number of numbers) {
    const dependencyPr = await github(`/pulls/${number}`);
    if (dependencyPr.ok) {
      if (!dependencyPr.data?.merged_at) return { ok:false, reason:`dependency PR #${number} is not merged` };
      continue;
    }
    if (dependencyPr.status !== 404) throw new Error(`dependency lookup for #${number} failed with ${dependencyPr.status}`);
    const issue = await github(`/issues/${number}`);
    if (!issue.ok || issue.data?.state !== "closed") return { ok:false, reason:`dependency #${number} is not closed` };
  }
  return { ok:true };
}

function eligible(pull) {
  const labels = new Set((pull.labels || []).map((label) => label.name).filter(Boolean));
  if (pull.base?.ref !== config.baseBranch || pull.draft) return false;
  if (pull.head?.repo?.full_name !== repository) return false;
  if (!allowedAssociations.has(pull.author_association)) return false;
  if ([...labels].some((label) => blockingLabels.has(label))) return false;
  if (field(pull.body, "Auto merge").toLowerCase() !== "yes") return false;
  if (field(pull.body, "Integration wave").toLowerCase() !== "yes") return false;
  if (field(pull.body, "Production gate").toLowerCase() !== "no") return false;
  if (field(pull.body, "Founder decision").toLowerCase() !== "no") return false;
  return true;
}

function blockedFile(path) {
  return config.blockedPaths.some((entry) => entry.endsWith("/") ? path.startsWith(entry) : path === entry);
}

async function filesForPull(number) {
  const response = await github(`/pulls/${number}/files?per_page=100`);
  if (!response.ok) throw new Error(`file lookup for #${number} failed with ${response.status}`);
  const files = response.data || [];
  if (files.length >= 100) return { ok:false, reason:"100+ changed files are not wave-eligible" };
  if (files.length > config.maxFilesPerPr) return { ok:false, reason:`${files.length} files exceed wave limit ${config.maxFilesPerPr}` };
  const names = files.map((file) => file.filename);
  const blocked = names.find(blockedFile);
  if (blocked) return { ok:false, reason:`protected/shared-core path: ${blocked}` };
  return { ok:true, names };
}

async function openWaves() {
  const pulls = await github(`/pulls?state=open&base=${encodeURIComponent(config.baseBranch)}&per_page=100`);
  if (!pulls.ok) throw new Error(`open PR lookup failed with ${pulls.status}`);
  return (pulls.data || []).filter((pull) => pull.head?.ref?.startsWith(config.branchPrefix));
}

function waveMetadata(body) {
  const match = String(body || "").match(/<!-- integration-wave-v2: (.+) -->/);
  if (!match) return null;
  try { return JSON.parse(match[1]); }
  catch { return null; }
}

async function deleteBranch(branch) {
  const response = await github(`/git/refs/heads/${branch}`, { method:"DELETE" });
  if (!response.ok && response.status !== 422 && response.status !== 404) {
    summary(`Wave: could not delete branch ${branch} (HTTP ${response.status}).`);
  }
}

async function invalidateWave(wave, reason) {
  await github(`/issues/${wave.number}/comments`, {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body:JSON.stringify({ body:`Integration Wave V2 invalidated: ${reason}. A fresh wave will be rebuilt from current PR heads.` }),
  });
  await github(`/pulls/${wave.number}`, {
    method:"PATCH",
    headers:{ "Content-Type":"application/json" },
    body:JSON.stringify({ state:"closed" }),
  });
  await deleteBranch(wave.head.ref);
  await deleteBranch(verificationBranchName(wave));
  summary(`Wave: invalidated #${wave.number} — ${reason}.`);
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

async function promoteWave(wave) {
  const metadata = waveMetadata(wave.body);
  if (!metadata?.sources?.length) {
    await invalidateWave(wave, "missing or invalid source metadata");
    return;
  }

  for (const source of metadata.sources) {
    const current = await github(`/pulls/${source.number}`);
    if (!current.ok || current.data?.state !== "open") {
      await invalidateWave(wave, `source PR #${source.number} is no longer open`);
      return;
    }
    if (current.data?.head?.sha !== source.sha) {
      await invalidateWave(wave, `source PR #${source.number} head changed`);
      return;
    }
    if (!eligible(current.data)) {
      await invalidateWave(wave, `source PR #${source.number} is no longer wave-eligible`);
      return;
    }
  }

  let currentWave = await freshPull(wave.number);
  if (currentWave.mergeable_state === "dirty") {
    await invalidateWave(currentWave, "integration branch conflicts with current main");
    return;
  }

  if (currentWave.mergeable_state === "behind") {
    const update = await github(`/pulls/${currentWave.number}/update-branch`, {
      method:"PUT",
      headers:{ "Content-Type":"application/json" },
      body:JSON.stringify({ expected_head_sha: currentWave.head.sha }),
    });
    if (!update.ok) throw new Error(`wave branch update failed with ${update.status}`);
    summary(`Wave: updated #${currentWave.number} onto current ${config.baseBranch}; fresh merge verification required.`);
    return;
  }

  if (currentWave.mergeable !== true) {
    summary(`Wave: #${currentWave.number} is not structurally mergeable yet (state: ${currentWave.mergeable_state}).`);
    return;
  }

  const verificationSha = currentWave.merge_commit_sha;
  if (!verificationSha) {
    summary(`Wave: #${currentWave.number} has no GitHub merge commit yet; waiting.`);
    return;
  }

  const verification = await requiredCheckReady(verificationSha);
  if (!verification.ok) {
    if (verification.state === "missing") {
      await dispatchVerificationCi(currentWave, verificationSha);
      return;
    }
    summary(`Wave: #${currentWave.number} waiting — ${verification.reason} on merge commit ${verificationSha}.`);
    return;
  }

  const refreshed = await freshPull(currentWave.number);
  if (refreshed.head?.sha !== currentWave.head?.sha || refreshed.merge_commit_sha !== verificationSha) {
    summary(`Wave: #${currentWave.number} merge commit changed during verification; fresh CI required.`);
    return;
  }
  currentWave = refreshed;

  const merged = await github(`/pulls/${currentWave.number}/merge`, {
    method:"PUT",
    headers:{ "Content-Type":"application/json" },
    body:JSON.stringify({
      sha:currentWave.head.sha,
      merge_method:"merge",
      commit_title:`Integration Wave V2 (#${currentWave.number})`,
    }),
  });

  if (!merged.ok || merged.data?.merged !== true) {
    summary(`Wave: promotion of #${currentWave.number} was refused (HTTP ${merged.status}); leaving it open fail-closed.`);
    return;
  }

  for (const source of metadata.sources) {
    await github(`/issues/${source.number}/comments`, {
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body:JSON.stringify({ body:`Integrated through Integration Wave V2 PR #${currentWave.number} at ${merged.data.sha}.` }),
    });
    const current = await github(`/pulls/${source.number}`);
    if (current.ok && current.data?.state === "open") {
      await github(`/pulls/${source.number}`, {
        method:"PATCH",
        headers:{ "Content-Type":"application/json" },
        body:JSON.stringify({ state:"closed" }),
      });
    }
  }

  await deleteBranch(currentWave.head.ref);
  await deleteBranch(verificationBranchName(currentWave));
  summary(`Wave: promoted #${currentWave.number} with ${metadata.sources.length} source PRs at ${merged.data.sha} after exact merge-commit CI.`);
}

async function buildWave() {
  const pulls = await github(`/pulls?state=open&base=${encodeURIComponent(config.baseBranch)}&sort=created&direction=asc&per_page=100`);
  if (!pulls.ok) throw new Error(`open PR lookup failed with ${pulls.status}`);

  const candidates = [];
  const occupiedFiles = new Set();

  for (const pull of (pulls.data || []).filter(eligible)) {
    if (candidates.length >= config.maxBatch) break;

    const dependencies = await dependenciesReady(pull);
    if (!dependencies.ok) {
      summary(`Wave: #${pull.number} waiting — ${dependencies.reason}.`);
      continue;
    }

    const reviews = await reviewsReady(pull.number);
    if (!reviews.ok) {
      summary(`Wave: #${pull.number} blocked — ${reviews.reason}.`);
      continue;
    }

    const checks = await checksReady(pull.head.sha);
    if (!checks.ok) {
      summary(`Wave: #${pull.number} waiting — ${checks.reason}.`);
      continue;
    }

    const fileResult = await filesForPull(pull.number);
    if (!fileResult.ok) {
      summary(`Wave: #${pull.number} skipped — ${fileResult.reason}.`);
      continue;
    }

    const overlap = fileResult.names.find((name) => occupiedFiles.has(name));
    if (overlap) {
      summary(`Wave: #${pull.number} skipped — overlaps selected PR on ${overlap}.`);
      continue;
    }

    candidates.push({ ...pull, waveFiles:fileResult.names });
    for (const name of fileResult.names) occupiedFiles.add(name);
  }

  if (candidates.length < config.minBatch) {
    summary(`Wave: ${candidates.length} eligible compatible PR(s); need at least ${config.minBatch}.`);
    return;
  }

  const base = await github(`/branches/${encodeURIComponent(config.baseBranch)}`);
  if (!base.ok) throw new Error(`base branch lookup failed with ${base.status}`);
  const baseSha = base.data?.commit?.sha;
  if (!baseSha) throw new Error("base branch SHA missing");

  const branch = `${config.branchPrefix}${runId}`;
  const created = await github("/git/refs", {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body:JSON.stringify({ ref:`refs/heads/${branch}`, sha:baseSha }),
  });
  if (!created.ok) throw new Error(`wave branch creation failed with ${created.status}`);

  const included = [];
  for (const pull of candidates) {
    const merged = await github("/merges", {
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body:JSON.stringify({
        base:branch,
        head:pull.head.sha,
        commit_message:`Integration Wave V2: include #${pull.number}`,
      }),
    });
    if (merged.ok && merged.status !== 204) {
      included.push({ number:pull.number, sha:pull.head.sha, title:pull.title });
      continue;
    }
    summary(`Wave: #${pull.number} could not be combined cleanly (HTTP ${merged.status}); skipped.`);
  }

  if (included.length < config.minBatch) {
    await deleteBranch(branch);
    summary(`Wave: only ${included.length} PR(s) combined cleanly; temporary branch removed.`);
    return;
  }

  const metadata = { version:2, baseSha, sources:included };
  const title = `Integration Wave V2: ${included.map((source) => `#${source.number}`).join(" + ")}`;
  const body = `## Build contract

Lane: integration
Priority: P0
Depends on: ${included.map((source) => `#${source.number}`).join(" ")}
Auto merge: no
Integration wave: control
Production gate: no
Founder decision: no

## Integration Wave V2

This PR is generated by the trusted Integration Wave V2 control plane. It contains only source PR heads that passed their individual CI/review/dependency gates and compatibility screening.

Source PRs:
${included.map((source) => `- #${source.number} — ${source.title} — \`${source.sha}\``).join("\n")}

Promotion requires the complete repository CI on this combined revision and an up-to-date base branch. The wave is merged with a merge commit so source commits remain traceable.

<!-- integration-wave-v2: ${JSON.stringify(metadata)} -->`;

  const pr = await github("/pulls", {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body:JSON.stringify({ title, head:branch, base:config.baseBranch, body }),
  });

  if (!pr.ok) {
    await deleteBranch(branch);
    throw new Error(`integration PR creation failed with ${pr.status}`);
  }

  summary(`Wave: created #${pr.data.number} from ${included.map((source) => `#${source.number}`).join(", ")}; exact GitHub merge-commit CI will be dispatched by the promotion pass.`);
}

async function main() {
  const waves = await openWaves();
  if (waves.length > 1) {
    summary(`Wave: fail-closed — ${waves.length} open Integration Wave V2 PRs exist.`);
    process.exit(1);
  }
  if (waves.length === 1) {
    await promoteWave(waves[0]);
    return;
  }
  await buildWave();
}

main().catch((error) => {
  console.error(error);
  summary(`Wave: failed closed — ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});

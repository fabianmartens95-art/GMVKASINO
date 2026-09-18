import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);

const tokenPatterns = [
  ["private-key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["github-classic-token", /gh[pousr]_[A-Za-z0-9]{20,}/],
  ["github-fine-grained-token", /github_pat_[A-Za-z0-9_]{20,}/],
  ["aws-access-key", /AKIA[0-9A-Z]{16}/],
  ["openai-api-key", /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/],
  ["slack-token", /xox[baprs]-[A-Za-z0-9-]{10,}/],
];

const sensitiveAssignment =
  /^\s*(?:export\s+)?(SUPABASE_SERVICE_ROLE_KEY|NOTION_TOKEN|TIKTOK_CLIENT_SECRET|OPENAI_API_KEY|METRICS_TOKEN)\s*=\s*(.+?)\s*$/;

function normalizeAssignmentValue(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function isPlaceholder(value) {
  if (!value) return true;
  if (value.startsWith("$")) return true;
  if (/^<.*>$/.test(value)) return true;
  return /^(?:example|changeme|replace[-_ ]?me|dummy|test|placeholder)$/i.test(value);
}

const findings = [];

for (const file of files) {
  let stat;
  try {
    stat = statSync(file);
  } catch {
    continue;
  }

  if (!stat.isFile() || stat.size > 2_000_000) continue;

  const buffer = readFileSync(file);
  if (buffer.includes(0)) continue;

  const lines = buffer.toString("utf8").split(/\r?\n/);

  lines.forEach((line, index) => {
    for (const [name, pattern] of tokenPatterns) {
      if (pattern.test(line)) {
        findings.push({ file, line: index + 1, rule: name });
      }
    }

    const assignment = sensitiveAssignment.exec(line);
    if (assignment) {
      const value = normalizeAssignmentValue(assignment[2]);
      if (!isPlaceholder(value)) {
        findings.push({
          file,
          line: index + 1,
          rule: `non-empty-${assignment[1].toLowerCase()}`,
        });
      }
    }
  });
}

if (findings.length) {
  console.error("Potential committed secret material detected:");
  for (const finding of findings) {
    console.error(`- ${finding.file}:${finding.line} [${finding.rule}]`);
  }
  console.error("Rotate real credentials before removing them from Git history.");
  process.exit(1);
}

console.log(`Secret hygiene scan passed for ${files.length} tracked files.`);

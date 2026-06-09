/**
 * Generate local issue markdown files for a plan.
 *
 * Usage:
 *   npx tsx generate-issues.ts <plan-dir> <issues-json>
 *
 * Issues JSON format:
 *   [
 *     {
 *       "title": "Issue Title",
 *       "type": "afk" | "hitl",
 *       "dependencies": [0, 1],  // indices of blocking issues
 *       "description": "What to build...",
 *       "acceptanceCriteria": ["Criterion 1", "Criterion 2"]
 *     }
 *   ]
 */

import * as fs from "node:fs";
import * as path from "node:path";

interface IssueInput {
  title: string;
  type?: "afk" | "hitl";
  dependencies?: number[];
  description?: string;
  acceptanceCriteria?: string[];
}

function generateIssueFile(issue: IssueInput, index: number, issueIds: string[]): string {
  const id = issueIds[index]!;
  const type = issue.type ?? "afk";
  const deps = (issue.dependencies ?? [])
    .map((i) => issueIds[i])
    .filter(Boolean);

  const lines: string[] = [];

  // Frontmatter
  lines.push("---");
  lines.push(`id: ${id}`);
  lines.push(`type: ${type}`);
  lines.push(`order: ${index}`);
  if (deps.length > 0) {
    lines.push(`dependencies: [${deps.map((d) => `"${d}"`).join(", ")}]`);
  } else {
    lines.push("dependencies: []");
  }
  lines.push("---");
  lines.push("");

  // Title
  lines.push(`# ${issue.title}`);
  lines.push("");

  // Description
  if (issue.description) {
    lines.push("## What to build");
    lines.push("");
    lines.push(issue.description);
    lines.push("");
  }

  // Acceptance criteria
  if (issue.acceptanceCriteria && issue.acceptanceCriteria.length > 0) {
    lines.push("## Acceptance criteria");
    lines.push("");
    for (const criterion of issue.acceptanceCriteria) {
      lines.push(`- [ ] ${criterion}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
}

function generateId(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return Math.abs(hash).toString(36).padStart(8, "0");
}

// ── Main ─────────────────────────────────────────────────

const planDir = process.argv[2];
const issuesJson = process.argv[3];

if (!planDir || !issuesJson) {
  console.error("Usage: npx tsx generate-issues.ts <plan-dir> <issues-json>");
  process.exit(1);
}

const issues: IssueInput[] = JSON.parse(issuesJson);

// Generate deterministic IDs from plan dir + title
const planId = generateId(planDir);
const issueIds = issues.map((issue, i) =>
  generateId(`${planId}:${i}:${issue.title}`),
);

// Create issues directory
const issuesDir = path.join(planDir, "issues");
fs.mkdirSync(issuesDir, { recursive: true });

// Write each issue file
for (let i = 0; i < issues.length; i++) {
  const issue = issues[i]!;
  const paddedIndex = String(i + 1).padStart(2, "0");
  const slug = slugify(issue.title);
  const filename = `${paddedIndex}-${slug}.md`;
  const filePath = path.join(issuesDir, filename);

  const content = generateIssueFile(issue, i, issueIds);
  fs.writeFileSync(filePath, content, "utf-8");
  console.log(`Created: ${filename}`);
}

console.log(`\nGenerated ${issues.length} issue files in ${issuesDir}`);
console.log(`Plan ID: ${planId}`);

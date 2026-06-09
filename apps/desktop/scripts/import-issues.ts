/**
 * Convert /tmp/issue-*.md files (from /to-issues) to local issue format.
 *
 * Usage:
 *   npx tsx import-issues.ts <plan-dir> [source-glob]
 *
 * Example:
 *   npx tsx import-issues.ts plans/phase-1-overlay /tmp/issue-*.md
 */

import * as fs from "node:fs";
import * as path from "node:path";

function generateId(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return Math.abs(hash).toString(36).padStart(8, "0");
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
}

interface ParsedIssue {
  title: string;
  type: "afk" | "hitl";
  description: string;
  acceptanceCriteria: string[];
  blockedBy: string | null;
}

function parseTmpIssue(content: string, filePath: string): ParsedIssue {
  // Extract title from filename (issue-1-overlay-lifecycle.md -> Overlay Lifecycle)
  const filename = path.basename(filePath, ".md");
  const titleFromFilename = filename
    .replace(/^\d+-/, "")  // remove leading number
    .replace(/^issue-\d+-/, "")  // remove issue-N- prefix
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
  
  // Also check for H1 in content as fallback
  const h1Match = content.match(/^#\s+(.+)$/m);
  const title = h1Match?.[1]?.trim() ?? titleFromFilename ?? "Untitled Issue";

  // Detect HITL vs AFK from content
  const isHitl =
    content.toLowerCase().includes("hitl") ||
    content.toLowerCase().includes("human-in-the-loop") ||
    content.toLowerCase().includes("requires human") ||
    content.toLowerCase().includes("needs human review");
  const type = isHitl ? "hitl" : "afk";

  // Extract What to build section
  const whatMatch = content.match(
    /##\s+What to build\s*\n([\s\S]*?)(?=\n##|$)/i,
  );
  const description = whatMatch?.[1]?.trim() ?? "";

  // Extract acceptance criteria
  const criteria: string[] = [];
  const criteriaSection = content.match(
    /##\s+Acceptance criteria\s*\n([\s\S]*?)(?=\n##|$)/i,
  );
  if (criteriaSection) {
    const itemPattern = /^-\s+\[[ x]\]\s+(.+)$/gm;
    let match: RegExpExecArray | null;
    while ((match = itemPattern.exec(criteriaSection[1]!)) !== null) {
      criteria.push(match[1]!.trim());
    }
  }

  // Extract blocked by
  const blockedMatch = content.match(
    /##\s+Blocked by\s*\n([\s\S]*?)(?=\n##|$)/i,
  );
  const blockedByText = blockedMatch?.[1]?.trim() ?? "";
  const blockedBy =
    blockedByText.toLowerCase().includes("none") ||
    blockedByText.toLowerCase().includes("can start immediately")
      ? null
      : blockedByText;

  return { title, type, description, acceptanceCriteria: criteria, blockedBy };
}

// ── Main ─────────────────────────────────────────────────

const planDir = process.argv[2];
const sourceFiles = process.argv.slice(3);

if (!planDir || sourceFiles.length === 0) {
  console.error("Usage: npx tsx import-issues.ts <plan-dir> <source-files...>");
  console.error("Example: npx tsx import-issues.ts plans/phase-1-overlay /tmp/issue-*.md");
  process.exit(1);
}

// Create issues directory
const issuesDir = path.join(planDir, "issues");
fs.mkdirSync(issuesDir, { recursive: true });

// Parse all source files first to resolve dependencies
const parsed: (ParsedIssue & { filePath: string })[] = [];
for (const filePath of sourceFiles) {
  if (!fs.existsSync(filePath)) {
    console.warn(`Skipping missing file: ${filePath}`);
    continue;
  }
  const content = fs.readFileSync(filePath, "utf-8");
  parsed.push({ ...parseTmpIssue(content, filePath), filePath });
}

// Build title-to-id map for dependency resolution
const planId = generateId(planDir);
const titleToId = new Map<string, string>();
for (let i = 0; i < parsed.length; i++) {
  const id = generateId(`${planId}:${i}:${parsed[i]!.title}`);
  titleToId.set(parsed[i]!.title.toLowerCase(), id);
}

// Generate local issue files
for (let i = 0; i < parsed.length; i++) {
  const issue = parsed[i]!;
  const id = generateId(`${planId}:${i}:${issue.title}`);

  // Resolve dependencies from "Blocked by" text
  const dependencies: string[] = [];
  if (issue.blockedBy) {
    // Try to find matching issue by title
    for (const [title, depId] of titleToId) {
      if (issue.blockedBy.toLowerCase().includes(title)) {
        dependencies.push(depId);
      }
    }
  }

  const paddedIndex = String(i + 1).padStart(2, "0");
  const slug = slugify(issue.title);
  const filename = `${paddedIndex}-${slug}.md`;
  const filePath = path.join(issuesDir, filename);

  const lines: string[] = [];
  lines.push("---");
  lines.push(`id: ${id}`);
  lines.push(`type: ${issue.type}`);
  lines.push(`order: ${i}`);
  if (dependencies.length > 0) {
    lines.push(`dependencies: [${dependencies.map((d) => `"${d}"`).join(", ")}]`);
  } else {
    lines.push("dependencies: []");
  }
  lines.push("---");
  lines.push("");
  lines.push(`# ${issue.title}`);
  lines.push("");

  if (issue.description) {
    lines.push("## What to build");
    lines.push("");
    lines.push(issue.description);
    lines.push("");
  }

  if (issue.acceptanceCriteria.length > 0) {
    lines.push("## Acceptance criteria");
    lines.push("");
    for (const criterion of issue.acceptanceCriteria) {
      lines.push(`- [ ] ${criterion}`);
    }
    lines.push("");
  }

  fs.writeFileSync(filePath, lines.join("\n"), "utf-8");
  console.log(`Created: ${filename} (${issue.type.toUpperCase()})`);
}

console.log(`\nImported ${parsed.length} issues to ${issuesDir}`);

import * as fs from "node:fs";
import * as path from "node:path";
import type { PlanIssueRecord, PlanRecord, PlanSummary } from "../src/plan-types";

// ── Parsing helpers ──────────────────────────────────────

function extractH1(content: string): string | undefined {
  const match = content.match(/^#\s+(.+)$/m);
  return match?.[1]?.trim();
}

function generateId(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return Math.abs(hash).toString(36).padStart(8, "0");
}

// ── Frontmatter parsing ─────────────────────────────────

interface IssueFrontmatter {
  id?: string;
  type?: "afk" | "hitl";
  dependencies?: string[];
  order?: number;
}

function parseFrontmatter(content: string): { frontmatter: IssueFrontmatter; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: content };

  const yamlBlock = match[1]!;
  const body = match[2]!;
  const frontmatter: IssueFrontmatter = {};

  // Simple YAML parser for our needs
  for (const line of yamlBlock.split("\n")) {
    const kvMatch = line.match(/^(\w+):\s*(.+)$/);
    if (!kvMatch) continue;

    const key = kvMatch[1]!;
    let value: string | string[] | number = kvMatch[2]!.trim();

    // Parse arrays: [item1, item2]
    if (value.startsWith("[") && value.endsWith("]")) {
      const arrayContent = value.slice(1, -1).trim();
      value = arrayContent === "" ? [] : arrayContent
        .split(",")
        .map((s) => s.trim().replace(/^["']|["']$/g, ""));
    }
    // Parse numbers
    else if (/^\d+$/.test(value)) {
      value = parseInt(value, 10);
    }
    // Strip quotes
    else {
      value = value.replace(/^["']|["']$/g, "");
    }

    (frontmatter as Record<string, unknown>)[key] = value;
  }

  return { frontmatter, body };
}

function extractAcceptanceCriteria(content: string): string[] {
  const criteria: string[] = [];
  const sectionMatch = content.match(
    /##\s+Acceptance criteria\s*\n([\s\S]*?)(?=\n##|$)/i,
  );
  if (!sectionMatch) return criteria;

  const section = sectionMatch[1]!;
  const itemPattern = /^-\s+\[[ x]\]\s+(.+)$/gm;
  let match: RegExpExecArray | null;

  while ((match = itemPattern.exec(section)) !== null) {
    criteria.push(match[1]!.trim());
  }

  return criteria;
}

// ── Issue file discovery ─────────────────────────────────

/**
 * Parse a single issue markdown file.
 * Expects frontmatter with id, type, dependencies, order.
 * Body should have a title (H1) and description.
 */
function parseIssueFile(filePath: string, planId: string): PlanIssueRecord | undefined {
  if (!fs.existsSync(filePath)) return undefined;

  const content = fs.readFileSync(filePath, "utf-8");
  const { frontmatter, body } = parseFrontmatter(content);

  const title = extractH1(body) ?? path.basename(filePath, ".md");
  const id = frontmatter.id ?? generateId(`${planId}:${title}`);
  const type = frontmatter.type ?? "afk";
  const order = frontmatter.order ?? 0;
  const dependencies = frontmatter.dependencies ?? [];
  const acceptanceCriteria = extractAcceptanceCriteria(body);

  // Strip the H1 from the description
  const description = body.replace(/^#\s+.+$/m, "").trim();

  return {
    id,
    planId,
    title,
    description,
    type,
    order,
    dependencies,
    status: "pending",
    acceptanceCriteria,
  };
}

/**
 * Read all issue files from a plan's issues/ directory.
 * Files are sorted by name (01-xxx.md, 02-xxx.md, etc.)
 */
function readIssueFiles(planDir: string, planId: string): PlanIssueRecord[] {
  const issuesDir = path.join(planDir, "issues");
  if (!fs.existsSync(issuesDir)) return [];

  const files = fs
    .readdirSync(issuesDir)
    .filter((f) => f.endsWith(".md"))
    .sort();

  const issues: PlanIssueRecord[] = [];

  for (const file of files) {
    const filePath = path.join(issuesDir, file);
    const issue = parseIssueFile(filePath, planId);
    if (issue) {
      issues.push(issue);
    }
  }

  // Auto-fix dependencies: if no explicit dependencies, chain sequentially
  return issues.map((issue, index) => ({
    ...issue,
    dependencies:
      issue.dependencies.length > 0
        ? issue.dependencies
        : index > 0
          ? [issues[index - 1]!.id]
          : [],
  }));
}

// ── Legacy plan.md milestones parsing ────────────────────

function extractMilestones(content: string): { title: string; body: string }[] {
  const milestones: { title: string; body: string }[] = [];

  const milestonesSectionMatch = content.match(
    /^##\s+(?:Milestones|Implementation Milestones|Issues|Tasks)\s*$/im,
  );
  if (!milestonesSectionMatch) return milestones;

  const sectionStart = milestonesSectionMatch.index! + milestonesSectionMatch[0].length;
  const rest = content.slice(sectionStart);

  const sectionEnd = rest.match(/^##\s/m);
  const sectionContent = sectionEnd ? rest.slice(0, sectionEnd.index) : rest;

  const h3Pattern = /^###\s+(.+)$/gm;
  let match: RegExpExecArray | null;
  const positions: { title: string; index: number }[] = [];

  while ((match = h3Pattern.exec(sectionContent)) !== null) {
    positions.push({ title: match[1]!.trim(), index: match.index });
  }

  for (let i = 0; i < positions.length; i++) {
    const start = positions[i]!.index;
    const end = i + 1 < positions.length ? positions[i + 1]!.index : sectionContent.length;
    const body = sectionContent.slice(start, end).trim();
    milestones.push({ title: positions[i]!.title, body });
  }

  return milestones;
}

// ── Public API ───────────────────────────────────────────

export interface ParsedPlan {
  readonly title: string;
  readonly issues: { title: string; description: string; type: "afk" | "hitl" }[];
}

/**
 * Parse a plan.md file into structured data.
 * Extracts H1 as title, finds Milestones section, parses H3s as issues.
 */
function parsePlanMarkdown(content: string): ParsedPlan {
  const title = extractH1(content) ?? "Untitled Plan";
  const milestones = extractMilestones(content);

  return {
    title,
    issues: milestones.map((m) => ({
      title: m.title,
      description: m.body,
      type: "afk" as const,
    })),
  };
}

/**
 * Build a PlanRecord from a plan directory.
 *
 * Resolution order:
 * 1. If issues/ directory exists with .md files, use those (preferred)
 * 2. Otherwise, fall back to plan.md milestones
 */
export function buildPlanRecord(
  directoryPath: string,
  workspaceId: string,
  existingPlan?: PlanRecord,
): PlanRecord | undefined {
  const planMdPath = path.join(directoryPath, "plan.md");
  if (!fs.existsSync(planMdPath)) return undefined;

  const content = fs.readFileSync(planMdPath, "utf-8");
  const planTitle = extractH1(content) ?? "Untitled Plan";
  const planId = existingPlan?.id ?? generateId(directoryPath);
  const now = new Date().toISOString();

  // Try issues/ directory first, fall back to plan.md milestones
  let issues = readIssueFiles(directoryPath, planId);

  if (issues.length === 0) {
    // Legacy mode: parse milestones from plan.md
    const parsed = parsePlanMarkdown(content);
    issues = parsed.issues.map((issue, index) => {
      const issueId = generateId(`${planId}:${index}:${issue.title}`);
      const existingIssue = existingPlan?.issues.find((ei) => ei.order === index);

      return {
        id: existingIssue?.id ?? issueId,
        planId,
        title: issue.title,
        description: issue.description,
        type: issue.type,
        order: index,
        dependencies: index > 0 ? [generateId(`${planId}:${index - 1}:${parsed.issues[index - 1]!.title}`)] : [],
        status: existingIssue?.status ?? "pending",
        sessionId: existingIssue?.sessionId,
        startedAt: existingIssue?.startedAt,
        completedAt: existingIssue?.completedAt,
        error: existingIssue?.error,
      };
    });

    // Fix dependency references to use actual issue ids
    issues = issues.map((issue, index) => ({
      ...issue,
      dependencies: index > 0 ? [issues[index - 1]!.id] : [],
    }));
  } else {
    // Preserve existing issue state from plan refresh
    issues = issues.map((issue) => {
      const existingIssue = existingPlan?.issues.find((ei) => ei.id === issue.id);
      if (!existingIssue) return issue;
      return {
        ...issue,
        status: existingIssue.status,
        sessionId: existingIssue.sessionId,
        startedAt: existingIssue.startedAt,
        completedAt: existingIssue.completedAt,
        error: existingIssue.error,
      };
    });
  }

  return {
    id: planId,
    title: planTitle,
    directoryPath,
    workspaceId,
    status: existingPlan?.status ?? "idle",
    issues,
    createdAt: existingPlan?.createdAt ?? now,
    updatedAt: now,
    startedAt: existingPlan?.startedAt,
    completedAt: existingPlan?.completedAt,
    currentIssueId: existingPlan?.currentIssueId,
    maxIterations: existingPlan?.maxIterations ?? 10,
    iteration: existingPlan?.iteration ?? 0,
  };
}

/**
 * Discover all plan directories under a workspace path.
 */
export function discoverPlanDirectories(workspacePath: string): string[] {
  const plansDir = path.join(workspacePath, "plans");
  if (!fs.existsSync(plansDir)) return [];

  const entries = fs.readdirSync(plansDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(plansDir, entry.name))
    .filter((dirPath) => fs.existsSync(path.join(dirPath, "plan.md")));
}

/**
 * Build plan summaries for a workspace (lightweight, for sidebar display).
 */
function listPlans(workspacePath: string, workspaceId: string): PlanSummary[] {
  const directories = discoverPlanDirectories(workspacePath);

  return directories
    .map((dir) => {
      const record = buildPlanRecord(dir, workspaceId);
      if (!record) return undefined;

      const completedIssues = record.issues.filter((i) => i.status === "completed").length;
      return {
        id: record.id,
        title: record.title,
        directoryPath: record.directoryPath,
        totalIssues: record.issues.length,
        completedIssues,
        status: record.status,
      };
    })
    .filter((s): s is PlanSummary => Boolean(s));
}

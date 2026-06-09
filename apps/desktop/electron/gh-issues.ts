import { execGh } from "./git-runner";
import type { GhIssueRecord, GhLoopRecord } from "../src/gh-types";

export async function ghAvailable(cwd: string): Promise<boolean> {
  const { code } = await execGh(["auth", "status"], cwd);
  return code === 0;
}

/**
 * A "loop" is a parent issue that has sub-issues. Each open parent issue with at
 * least one sub-issue is surfaced as a runnable loop.
 */
export async function listLoops(cwd: string): Promise<GhLoopRecord[]> {
  const { stdout, code } = await execGh(
    [
      "api",
      "repos/{owner}/{repo}/issues?state=open&per_page=100",
      "--jq",
      "[.[] | select(.pull_request == null) | select((.sub_issues_summary.total // 0) > 0) | " +
        "{number, title, body: (.body // \"\"), " +
        "total: .sub_issues_summary.total, completed: .sub_issues_summary.completed}]",
    ],
    cwd,
  );
  if (code !== 0) return [];
  let raw: Array<{ number: number; title: string; body: string; total: number; completed: number }>;
  try {
    raw = JSON.parse(stdout);
  } catch {
    return [];
  }
  const results: GhLoopRecord[] = [];
  for (const p of raw) {
    const subIssues = await listSubIssues(cwd, p.number);
    results.push({
      number: p.number,
      title: p.title,
      body: p.body,
      openSubIssues: p.total - p.completed,
      closedSubIssues: p.completed,
      subIssues,
    });
  }
  return results.sort((a, b) => a.number - b.number);
}

/** Sub-issues of a parent issue, in GitHub's defined order. */
export async function listSubIssues(cwd: string, parentNumber: number): Promise<GhIssueRecord[]> {
  const { stdout, code } = await execGh(
    [
      "api",
      `repos/{owner}/{repo}/issues/${parentNumber}/sub_issues?per_page=100`,
      "--jq",
      "[.[] | {number, title, body: (.body // \"\"), " +
        "labels: [.labels[].name], state, url: .html_url}]",
    ],
    cwd,
  );
  if (code !== 0) return [];
  try {
    const raw: Array<{
      number: number;
      title: string;
      body: string;
      labels: string[];
      url: string;
      state: string;
    }> = JSON.parse(stdout);
    return raw.map((i) => ({
      number: i.number,
      title: i.title,
      body: i.body,
      labels: i.labels,
      state: (i.state === "closed" ? "closed" : "open") as "open" | "closed",
      url: i.url,
    }));
  } catch {
    return [];
  }
}

export async function getIssueState(cwd: string, num: number): Promise<"open" | "closed" | "unknown"> {
  const { stdout, code } = await execGh(
    ["issue", "view", String(num), "--json", "state", "--jq", ".state"],
    cwd,
  );
  if (code !== 0) return "unknown";
  const trimmed = stdout.trim().toLowerCase();
  if (trimmed === "open" || trimmed === "closed") return trimmed;
  return "unknown";
}

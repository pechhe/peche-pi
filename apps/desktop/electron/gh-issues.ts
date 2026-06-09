import { execGh } from "./git-runner";
import type { GhIssueRecord, GhMilestoneRecord } from "../src/gh-types";

export async function ghAvailable(cwd: string): Promise<boolean> {
  const { code } = await execGh(["auth", "status"], cwd);
  return code === 0;
}

export async function listMilestones(cwd: string): Promise<GhMilestoneRecord[]> {
  const { stdout, code } = await execGh(
    [
      "api",
      "repos/{owner}/{repo}/milestones?state=open&sort=due_on&direction=asc",
      "--jq",
      '[.[] | {number, title, description: (.description // ""), openIssues: .open_issues, closedIssues: .closed_issues}]',
    ],
    cwd,
  );
  if (code !== 0) return [];
  let raw: Array<{ number: number; title: string; description: string; openIssues: number; closedIssues: number }>;
  try {
    raw = JSON.parse(stdout);
  } catch {
    return [];
  }
  const results: GhMilestoneRecord[] = [];
  for (const m of raw) {
    const issues = await listRunnableIssues(cwd, m.title);
    results.push({
      number: m.number,
      title: m.title,
      description: m.description,
      openIssues: m.openIssues,
      closedIssues: m.closedIssues,
      issues,
    });
  }
  return results;
}

export async function listRunnableIssues(cwd: string, milestoneTitle: string): Promise<GhIssueRecord[]> {
  const { stdout, code } = await execGh(
    [
      "issue",
      "list",
      "--milestone",
      milestoneTitle,
      "--label",
      "ready-for-agent",
      "--state",
      "open",
      "--json",
      "number,title,body,labels,url,state",
      "--limit",
      "200",
    ],
    cwd,
  );
  if (code !== 0) return [];
  try {
    const raw: Array<{
      number: number;
      title: string;
      body: string;
      labels: Array<{ name: string }>;
      url: string;
      state: string;
    }> = JSON.parse(stdout);
    return raw
      .map((i) => ({
        number: i.number,
        title: i.title,
        body: i.body,
        labels: i.labels.map((l) => l.name),
        state: (i.state === "CLOSED" ? "closed" : "open") as "open" | "closed",
        url: i.url,
      }))
      .sort((a, b) => a.number - b.number);
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

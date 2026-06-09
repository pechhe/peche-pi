export interface GhIssueRecord {
  readonly number: number;
  readonly title: string;
  readonly body: string;
  readonly labels: readonly string[];
  readonly state: "open" | "closed";
  readonly url: string;
}

export interface GhMilestoneRecord {
  readonly number: number;
  readonly title: string;
  readonly description: string;
  readonly openIssues: number;
  readonly closedIssues: number;
  /** Open, ready-for-agent issues in run order (ascending number). */
  readonly issues: readonly GhIssueRecord[];
}

export type GhRunStatus = "idle" | "running" | "cancelling" | "done" | "error";

export type GhIssueResult = "pending" | "running" | "completed" | "blocked" | "failed" | "skipped";

export interface GhIssueOutcome {
  readonly number: number;
  readonly title: string;
  readonly result: GhIssueResult;
  readonly sessionId?: string;
}

export interface GhRunnerState {
  readonly status: GhRunStatus;
  readonly workspaceId?: string;
  readonly milestoneNumber?: number;
  readonly milestoneTitle?: string;
  readonly currentIssueNumber?: number;
  readonly outcomes: readonly GhIssueOutcome[];
  readonly error?: string;
  readonly startedAt?: string;
  readonly finishedAt?: string;
}

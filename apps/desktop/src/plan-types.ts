/**
 * Plan-driven implementation system.
 *
 * Plans are directories containing a plan.md with milestones/issues.
 * Each milestone becomes an issue that gets its own nested session.
 * Issues execute sequentially (or parallel when dependencies allow).
 */

export type PlanStatus = "idle" | "running" | "completed" | "failed" | "paused";
export type PlanIssueStatus = "pending" | "running" | "completed" | "failed" | "skipped";

export interface PlanIssueRecord {
  readonly id: string;
  readonly planId: string;
  readonly title: string;
  readonly description: string;
  /** Issue type: AFK (automated) or HITL (needs human input). */
  readonly type: "afk" | "hitl";
  /** Order within the plan (0-indexed). */
  readonly order: number;
  /** IDs of issues that must complete before this one starts. */
  readonly dependencies: readonly string[];
  readonly status: PlanIssueStatus;
  /** Session created for this issue. */
  readonly sessionId?: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly error?: string;
  /** Acceptance criteria from the issue file. */
  readonly acceptanceCriteria?: readonly string[];
}

export interface PlanRecord {
  readonly id: string;
  readonly title: string;
  /** Absolute path to the plan directory (e.g. plans/phase-1-codex-parity). */
  readonly directoryPath: string;
  /** Workspace this plan belongs to. */
  readonly workspaceId: string;
  readonly status: PlanStatus;
  readonly issues: readonly PlanIssueRecord[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
  /** Currently executing issue. */
  readonly currentIssueId?: string;
  readonly maxIterations: number;
  readonly iteration: number;
}

/** Lightweight summary for workspace-level display (like RalphPlanSummary). */
export interface PlanSummary {
  readonly id: string;
  readonly title: string;
  readonly directoryPath: string;
  readonly totalIssues: number;
  readonly completedIssues: number;
  readonly status: PlanStatus;
}

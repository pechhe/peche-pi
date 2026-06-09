/**
 * Plan orchestrator — executes a plan's issues sequentially as nested sessions.
 *
 * Each issue gets its own pi session. The orchestrator:
 * 1. Creates a session for the next pending issue
 * 2. Sends the issue description as the initial prompt
 * 3. Waits for the session to complete (runCompleted / runFailed)
 * 4. Advances to the next issue
 *
 * Plan state is persisted in DesktopAppState.plans and written to disk
 * as plan-status.json in the plan directory.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { sessionKey } from "@pi-gui/pi-sdk-driver";
import type { SessionRef } from "@pi-gui/session-driver";
import type { PlanIssueRecord, PlanRecord } from "../src/plan-types";
import type { AppStoreInternals, RefreshStateOptions } from "./app-store-internals";
import { buildPlanRecord } from "./plan-parser";

// ── Plan state persistence ───────────────────────────────

interface PlanStatusFile {
  planId: string;
  status: PlanRecord["status"];
  currentIssueId?: string;
  iteration: number;
  issues: {
    id: string;
    status: PlanIssueRecord["status"];
    sessionId?: string;
    startedAt?: string;
    completedAt?: string;
    error?: string;
  }[];
  startedAt?: string;
  completedAt?: string;
  updatedAt: string;
}

function planStatusPath(planDir: string): string {
  return path.join(planDir, "plan-status.json");
}

function readPlanStatus(planDir: string): PlanStatusFile | undefined {
  const statusPath = planStatusPath(planDir);
  if (!fs.existsSync(statusPath)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(statusPath, "utf-8")) as PlanStatusFile;
  } catch {
    return undefined;
  }
}

function writePlanStatus(planDir: string, status: PlanStatusFile): void {
  fs.writeFileSync(planStatusPath(planDir), JSON.stringify(status, null, 2), "utf-8");
}

function planToStatusFile(plan: PlanRecord): PlanStatusFile {
  return {
    planId: plan.id,
    status: plan.status,
    currentIssueId: plan.currentIssueId,
    iteration: plan.iteration,
    issues: plan.issues.map((issue) => ({
      id: issue.id,
      status: issue.status,
      sessionId: issue.sessionId,
      startedAt: issue.startedAt,
      completedAt: issue.completedAt,
      error: issue.error,
    })),
    startedAt: plan.startedAt,
    completedAt: plan.completedAt,
    updatedAt: plan.updatedAt,
  };
}

function mergeStatusIntoPlan(plan: PlanRecord, status: PlanStatusFile): PlanRecord {
  return {
    ...plan,
    status: status.status,
    currentIssueId: status.currentIssueId,
    iteration: status.iteration,
    startedAt: status.startedAt,
    completedAt: status.completedAt,
    updatedAt: status.updatedAt,
    issues: plan.issues.map((issue) => {
      const saved = status.issues.find((s) => s.id === issue.id);
      if (!saved) return issue;
      return {
        ...issue,
        status: saved.status,
        sessionId: saved.sessionId,
        startedAt: saved.startedAt,
        completedAt: saved.completedAt,
        error: saved.error,
      };
    }),
  };
}

// ── Orchestrator ─────────────────────────────────────────

export interface PlanModelConfig {
  provider?: string;
  modelId?: string;
  thinkingLevel?: string;
}

export interface PlanOrchestratorHandle {
  readonly planId: string;
  /** Pause after the current issue completes. */
  pause(): void;
  /** Resume execution. */
  resume(): void;
  /** Stop entirely. */
  cancel(): void;
}

// Global registry of active orchestrators
const activeOrchestrators = new Map<string, { handle: PlanOrchestratorHandle; abort: AbortController }>();

export function getActiveOrchestrator(planId: string): PlanOrchestratorHandle | undefined {
  return activeOrchestrators.get(planId)?.handle;
}

function getActiveOrchestratorIds(): string[] {
  return [...activeOrchestrators.keys()];
}

/**
 * Start executing a plan. Returns a handle to control the orchestrator.
 */
export function startPlanExecution(
  store: AppStoreInternals,
  planDir: string,
  workspaceId: string,
  modelConfig?: PlanModelConfig,
): PlanOrchestratorHandle {
  // Build or refresh the plan record
  const existingPlan = store.state.plans?.find((p) => p.directoryPath === planDir);
  let plan = buildPlanRecord(planDir, workspaceId, existingPlan);
  if (!plan) {
    throw new Error(`No plan.md found in ${planDir}`);
  }

  // Merge any saved progress from disk
  const savedStatus = readPlanStatus(planDir);
  if (savedStatus) {
    plan = mergeStatusIntoPlan(plan, savedStatus);
  }

  const planId = plan.id;
  const abortController = new AbortController();
  let paused = false;

  // Store model config for resume
  let savedModelConfig = modelConfig;

  const handle: PlanOrchestratorHandle = {
    planId,
    pause() {
      paused = true;
      updatePlanState(store, planId, { status: "paused" });
    },
    resume() {
      if (paused) {
        paused = false;
        updatePlanState(store, planId, { status: "running" });
        void runNextIssue(store, planId, abortController.signal, () => paused, savedModelConfig);
      }
    },
    cancel() {
      abortController.abort();
      activeOrchestrators.delete(planId);
      updatePlanState(store, planId, { status: "idle" });
    },
  };

  activeOrchestrators.set(planId, { handle, abort: abortController });

  // Start execution
  updatePlanState(store, planId, {
    status: "running",
    startedAt: plan.startedAt ?? new Date().toISOString(),
  });

  void runNextIssue(store, planId, abortController.signal, () => paused, modelConfig);

  return handle;
}

// ── Internal execution loop ──────────────────────────────

async function runNextIssue(
  store: AppStoreInternals,
  planId: string,
  signal: AbortSignal,
  isPaused: () => boolean,
  modelConfig?: PlanModelConfig,
): Promise<void> {
  if (signal.aborted || isPaused()) return;

  const plan = store.state.plans?.find((p) => p.id === planId);
  if (!plan) return;

  // Find the next pending issue whose dependencies are satisfied
  const nextIssue = findNextIssue(plan);
  if (!nextIssue) {
    // All issues done
    completePlan(store, planId);
    return;
  }

  // Mark issue as running
  updateIssueState(store, planId, nextIssue.id, {
    status: "running",
    startedAt: new Date().toISOString(),
  });
  updatePlanState(store, planId, { currentIssueId: nextIssue.id });

  try {
    // Create a session for this issue
    const session = await createIssueSession(store, plan, nextIssue, modelConfig);
    if (signal.aborted) return;

    // Update issue with session id
    updateIssueState(store, planId, nextIssue.id, { sessionId: session.sessionId });

    // Wait for the session to complete
    await waitForSessionCompletion(store, session, signal);

    if (signal.aborted) return;

    // Mark issue as completed
    updateIssueState(store, planId, nextIssue.id, {
      status: "completed",
      completedAt: new Date().toISOString(),
    });

    // Persist progress to disk
    persistPlanState(store, planId);

    // Continue to next issue
    if (!isPaused()) {
      await runNextIssue(store, planId, signal, isPaused, modelConfig);
    }
  } catch (error) {
    if (signal.aborted) return;

    // Mark issue as failed
    updateIssueState(store, planId, nextIssue.id, {
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
      completedAt: new Date().toISOString(),
    });

    // Stop execution on failure
    updatePlanState(store, planId, { status: "failed" });
    activeOrchestrators.delete(planId);
    persistPlanState(store, planId);
  }
}

function findNextIssue(plan: PlanRecord): PlanIssueRecord | undefined {
  for (const issue of plan.issues) {
    if (issue.status !== "pending") continue;
    // Check if all dependencies are completed
    const depsSatisfied = issue.dependencies.every((depId) => {
      const dep = plan.issues.find((i) => i.id === depId);
      return dep?.status === "completed";
    });
    if (depsSatisfied) return issue;
  }
  return undefined;
}

function completePlan(store: AppStoreInternals, planId: string): void {
  updatePlanState(store, planId, {
    status: "completed",
    completedAt: new Date().toISOString(),
  });
  activeOrchestrators.delete(planId);
  persistPlanState(store, planId);
}

// ── Session management ───────────────────────────────────

async function createIssueSession(
  store: AppStoreInternals,
  plan: PlanRecord,
  issue: PlanIssueRecord,
  modelConfig?: PlanModelConfig,
): Promise<SessionRef> {
  const workspace = store.workspaceRefFromState(plan.workspaceId);
  if (!workspace) throw new Error(`Workspace not found: ${plan.workspaceId}`);

  const createOptions = (await store.buildCreateSessionOptions(plan.workspaceId)) ?? {};
  const session = await store.driver.createSession(workspace, {
    ...createOptions,
    title: issue.title,
    // Apply model config if provided
    ...(modelConfig?.provider && { provider: modelConfig.provider }),
    ...(modelConfig?.modelId && { modelId: modelConfig.modelId }),
    ...(modelConfig?.thinkingLevel && { thinkingLevel: modelConfig.thinkingLevel }),
  });

  // Set up transcript cache
  const key = sessionKey(session.ref);
  store.sessionState.transcriptCache.set(key, []);
  store.sessionState.loadedTranscriptKeys.add(key);
  store.updateSessionConfig(session.ref, session.config);
  store.setThreadType(session.ref.sessionId, "plan-issue");

  // Build the prompt from the issue description
  const prompt = buildIssuePrompt(plan, issue);

  // Send the issue as the initial message
  await store.driver.sendUserMessage(session.ref, {
    text: prompt,
    deliverAs: "steer",
  });

  return session.ref;
}

function buildIssuePrompt(plan: PlanRecord, issue: PlanIssueRecord): string {
  const lines: string[] = [];

  lines.push(`# Issue: ${issue.title}`);
  lines.push("");
  lines.push(`**Plan:** ${plan.title}`);
  lines.push(`**Issue ${issue.order + 1} of ${plan.issues.length}**`);
  lines.push(`**Type:** ${issue.type.toUpperCase()}`);
  lines.push("");

  // Include completed issues as context
  const completedBefore = plan.issues.filter(
    (i) => i.status === "completed" && i.order < issue.order,
  );
  if (completedBefore.length > 0) {
    lines.push("## Previously Completed Issues");
    for (const prev of completedBefore) {
      lines.push(`- **${prev.title}** (completed)`);
    }
    lines.push("");
  }

  lines.push("## What to build");
  lines.push(issue.description);
  lines.push("");

  // Include acceptance criteria if available
  if (issue.acceptanceCriteria && issue.acceptanceCriteria.length > 0) {
    lines.push("## Acceptance Criteria");
    for (const criterion of issue.acceptanceCriteria) {
      lines.push(`- [ ] ${criterion}`);
    }
    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push("Complete this task. When done, commit your changes and ensure typecheck and tests pass.");

  return lines.join("\n");
}

async function waitForSessionCompletion(
  store: AppStoreInternals,
  sessionRef: SessionRef,
  signal: AbortSignal,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const key = sessionKey(sessionRef);
    let resolved = false;

    const cleanup = () => {
      signal.removeEventListener("abort", onAbort);
      // Remove our event listener
      const subscriptions = store.sessionState.sessionSubscriptions;
      if (subscriptions.has(`${key}:plan-orchestrator`)) {
        subscriptions.get(`${key}:plan-orchestrator`)?.();
        subscriptions.delete(`${key}:plan-orchestrator`);
      }
    };

    const onAbort = () => {
      if (!resolved) {
        resolved = true;
        cleanup();
        reject(new Error("Orchestrator aborted"));
      }
    };

    signal.addEventListener("abort", onAbort);

    // Poll for completion — check session status periodically
    // Session state is tracked via individual maps in SessionStateMap
    const checkInterval = setInterval(() => {
      if (resolved || signal.aborted) {
        clearInterval(checkInterval);
        return;
      }

      const isRunning = store.sessionState.runningSinceBySession.has(key);
      const hasError = store.sessionState.sessionErrorsBySession.has(key);

      // Session completed if it was running before and now is not
      if (!isRunning && wasRunning) {
        resolved = true;
        clearInterval(checkInterval);
        cleanup();

        if (hasError) {
          const error = store.sessionState.sessionErrorsBySession.get(key);
          reject(new Error(error ?? "Session failed"));
        } else {
          resolve();
        }
      }
    }, 1000);

    // Track if the session was ever running
    let wasRunning = store.sessionState.runningSinceBySession.has(key);

    // If not running yet, wait for it to start
    if (!wasRunning) {
      const startCheck = setInterval(() => {
        if (resolved || signal.aborted) {
          clearInterval(startCheck);
          return;
        }
        if (store.sessionState.runningSinceBySession.has(key)) {
          wasRunning = true;
          clearInterval(startCheck);
        }
      }, 500);
    }

    // Also check immediately in case the session already completed
    const isCurrentlyRunning = store.sessionState.runningSinceBySession.has(key);
    const hasCurrentError = store.sessionState.sessionErrorsBySession.has(key);
    if (!isCurrentlyRunning && !hasCurrentError) {
      // Session might be idle already (completed before we started watching)
      // This is OK - resolve immediately
      resolved = true;
      clearInterval(checkInterval);
      cleanup();
      resolve();
    }
  });
}

// ── State update helpers ─────────────────────────────────

function updatePlanState(
  store: AppStoreInternals,
  planId: string,
  updates: Partial<Pick<PlanRecord, "status" | "currentIssueId" | "startedAt" | "completedAt" | "iteration">>,
): void {
  const plans = store.state.plans ?? [];
  const index = plans.findIndex((p) => p.id === planId);
  if (index === -1) return;

  const plan = plans[index]!;
  const updated: PlanRecord = {
    ...plan,
    ...updates,
    updatedAt: new Date().toISOString(),
  };

  const newPlans = [...plans];
  newPlans[index] = updated;
  store.state = { ...store.state, plans: newPlans };
  store.emit();
}

function updateIssueState(
  store: AppStoreInternals,
  planId: string,
  issueId: string,
  updates: Partial<Pick<PlanIssueRecord, "status" | "sessionId" | "startedAt" | "completedAt" | "error">>,
): void {
  const plans = store.state.plans ?? [];
  const planIndex = plans.findIndex((p) => p.id === planId);
  if (planIndex === -1) return;

  const plan = plans[planIndex]!;
  const issueIndex = plan.issues.findIndex((i) => i.id === issueId);
  if (issueIndex === -1) return;

  const issue = plan.issues[issueIndex]!;
  const updatedIssue: PlanIssueRecord = { ...issue, ...updates };

  const newIssues = [...plan.issues];
  newIssues[issueIndex] = updatedIssue;

  const updatedPlan: PlanRecord = {
    ...plan,
    issues: newIssues,
    updatedAt: new Date().toISOString(),
  };

  const newPlans = [...plans];
  newPlans[planIndex] = updatedPlan;
  store.state = { ...store.state, plans: newPlans };
  store.emit();
}

function persistPlanState(store: AppStoreInternals, planId: string): void {
  const plan = store.state.plans?.find((p) => p.id === planId);
  if (!plan) return;
  try {
    writePlanStatus(plan.directoryPath, planToStatusFile(plan));
  } catch (error) {
    console.error(`[plan-orchestrator] Failed to persist plan state:`, error);
  }
}

// ── Plan discovery (for app-store integration) ───────────

/**
 * Discover plans in a workspace and add them to state.
 * Called during workspace sync.
 */
export function discoverAndRegisterPlans(
  store: AppStoreInternals,
  workspacePath: string,
  workspaceId: string,
): void {
  const { discoverPlanDirectories, buildPlanRecord } = require("./plan-parser");
  const directories = discoverPlanDirectories(workspacePath);
  const existingPlans = store.state.plans ?? [];

  const newPlans: PlanRecord[] = [];

  for (const dir of directories) {
    const existing = existingPlans.find((p) => p.directoryPath === dir);
    let plan = buildPlanRecord(dir, workspaceId, existing);
    if (!plan) continue;

    // Merge saved progress
    const saved = readPlanStatus(dir);
    if (saved) {
      plan = mergeStatusIntoPlan(plan, saved);
    }

    newPlans.push(plan);
  }

  // Keep plans from other workspaces, replace this workspace's plans
  const otherPlans = existingPlans.filter((p) => p.workspaceId !== workspaceId);
  store.state = { ...store.state, plans: [...otherPlans, ...newPlans] };
}

import { sessionKey } from "@pi-gui/pi-sdk-driver";
import type { SessionRef } from "@pi-gui/session-driver";
import { ghAvailable, getIssueState, listMilestones, listRunnableIssues } from "./gh-issues";
import type { AppStoreInternals } from "./app-store-internals";
import type { DesktopAppState } from "../src/desktop-state";
import type {
  GhIssueOutcome,
  GhIssueRecord,
  GhMilestoneRecord,
  GhRunnerState,
} from "../src/gh-types";

let cancelRequested = false;

function setRunner(store: AppStoreInternals, patch: Partial<GhRunnerState>): void {
  const prev = store.state.ghRunnerState ?? { status: "idle" as const, outcomes: [] };
  store.state = {
    ...store.state,
    ghRunnerState: { ...prev, ...patch },
    revision: store.state.revision + 1,
  };
  store.emit();
}

function workspacePath(store: AppStoreInternals, workspaceId: string): string | undefined {
  return store.state.workspaces.find((w) => w.id === workspaceId)?.path;
}

export async function refreshMilestones(
  store: AppStoreInternals,
  workspaceId: string,
): Promise<DesktopAppState> {
  const cwd = workspacePath(store, workspaceId);
  let milestones: GhMilestoneRecord[] = [];
  if (cwd && (await ghAvailable(cwd))) {
    milestones = await listMilestones(cwd);
  }
  store.state = {
    ...store.state,
    ghMilestones: milestones,
    revision: store.state.revision + 1,
  };
  return store.emit();
}

export async function runMilestone(
  store: AppStoreInternals,
  workspaceId: string,
  milestoneNumber: number,
): Promise<void> {
  const cwd = workspacePath(store, workspaceId);
  if (!cwd) return;
  const milestone = (store.state.ghMilestones ?? []).find((m) => m.number === milestoneNumber);
  if (!milestone) return;

  const issues = await listRunnableIssues(cwd, milestone.title);
  cancelRequested = false;

  setRunner(store, {
    status: "running",
    workspaceId,
    milestoneNumber,
    milestoneTitle: milestone.title,
    currentIssueNumber: undefined,
    error: undefined,
    startedAt: new Date().toISOString(),
    finishedAt: undefined,
    outcomes: issues.map((i) => ({ number: i.number, title: i.title, result: "pending" as const })),
  });

  for (const issue of issues) {
    if (cancelRequested) {
      markRemaining(store, "skipped");
      break;
    }

    updateOutcome(store, issue.number, { result: "running" });
    setRunner(store, { currentIssueNumber: issue.number });

    let ref: SessionRef | undefined;
    try {
      ref = await startIssueSession(store, workspaceId, issue);
      updateOutcome(store, issue.number, { sessionId: ref.sessionId });

      const runResult = await waitForCompletion(store, ref);
      const issueState = await getIssueState(cwd, issue.number);
      const result =
        runResult === "failed" ? "failed" : issueState === "closed" ? "completed" : "blocked";
      updateOutcome(store, issue.number, { result });
    } catch {
      updateOutcome(store, issue.number, { result: "failed" });
    }
  }

  setRunner(store, {
    status: "done",
    currentIssueNumber: undefined,
    finishedAt: new Date().toISOString(),
  });
}

export function cancelRun(store: AppStoreInternals): void {
  cancelRequested = true;
  setRunner(store, { status: "cancelling" });
}

/* ── Helpers ────────────────────────────────────────────── */

function updateOutcome(
  store: AppStoreInternals,
  number: number,
  patch: Partial<Pick<GhIssueOutcome, "result" | "sessionId">>,
): void {
  const current = store.state.ghRunnerState?.outcomes ?? [];
  const outcomes = current.map((o) => (o.number === number ? { ...o, ...patch } : o));
  setRunner(store, { outcomes });
}

function markRemaining(store: AppStoreInternals, result: GhIssueOutcome["result"]): void {
  const current = store.state.ghRunnerState?.outcomes ?? [];
  const outcomes = current.map((o) =>
    o.result === "pending" || o.result === "running" ? { ...o, result } : o,
  );
  setRunner(store, { outcomes });
}

async function startIssueSession(
  store: AppStoreInternals,
  workspaceId: string,
  issue: GhIssueRecord,
): Promise<SessionRef> {
  const ws = store.workspaceRefFromState(workspaceId);
  if (!ws) throw new Error("no workspace");

  const createOptions = await store.buildCreateSessionOptions(workspaceId);
  const snapshot = await store.driver.createSession(ws, {
    ...createOptions,
    title: `#${issue.number} ${issue.title}`.slice(0, 120),
  });
  const key = sessionKey(snapshot.ref);
  store.sessionState.transcriptCache.set(key, []);
  store.sessionState.loadedTranscriptKeys.add(key);
  store.updateSessionConfig(snapshot.ref, snapshot.config);

  await store.driver.sendUserMessage(snapshot.ref, {
    text: buildIssuePrompt(issue),
    deliverAs: "steer",
  });

  await store.refreshState({});
  return snapshot.ref;
}

function waitForCompletion(
  store: AppStoreInternals,
  ref: SessionRef,
): Promise<"completed" | "failed"> {
  return new Promise((resolve) => {
    const target = sessionKey(ref);
    const unsub = store.subscribeToSessionEvents((event, _state) => {
      if (sessionKey(event.sessionRef) !== target) return;
      if (event.type === "runCompleted") {
        unsub();
        resolve("completed");
      } else if (event.type === "runFailed") {
        unsub();
        resolve("failed");
      }
    });
  });
}

function buildIssuePrompt(issue: GhIssueRecord): string {
  return `# Issue #${issue.number}: ${issue.title}

${issue.body}

## How to work this issue
- Work ONLY on this issue. Do not start any other issue.
- Explore the codebase first; make the smallest change that satisfies the issue.
- Verify before committing: run the project's typecheck and tests.
- Commit to the CURRENT branch. Do NOT create a new branch.
- When committed and green, close the issue:
  \`gh issue close ${issue.number} --comment "<short summary of what you did>"\`
- If blocked, comment the blocker with \`gh issue comment ${issue.number}\` and DO NOT close it.`;
}

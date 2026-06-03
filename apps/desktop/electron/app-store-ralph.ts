import type { SessionRef } from "@pi-gui/session-driver";
import type { RalphLoopStatus, TranscriptMessage, WorkspaceRecord } from "../src/desktop-state";
import type { AppStoreInternals } from "./app-store-internals";
import { readRalphLoopStatus } from "./ralph-loop-status";

/**
 * Build a composite transcript for a loop thread by stitching the
 * parentSession iteration chain, inserting a divider before each iteration.
 * Returns null when the session is not a loop iteration, so callers fall
 * back to a plain transcript.
 */
export async function loadLoopTranscript(
  store: AppStoreInternals,
  sessionRef: SessionRef,
): Promise<TranscriptMessage[] | null> {
  const iterations = await store.driver.getLoopIterations(sessionRef);
  if (!iterations) {
    return null;
  }
  const rows: TranscriptMessage[] = [];
  for (const iteration of iterations) {
    rows.push({
      kind: "summary",
      id: `loop-divider-${iteration.sessionId}`,
      createdAt: iteration.messages[0]?.createdAt ?? new Date().toISOString(),
      label: iteration.label,
      presentation: "divider",
    });
    rows.push(...iteration.messages);
  }
  return rows;
}

/**
 * Read the Ralph loop status (if any) for the selected workspace so the
 * renderer can lock the loop thread's composer and surface loop controls.
 * Returns undefined when no `.ralph/loop.md` exists.
 */
export function resolveSelectedLoopStatus(
  _store: AppStoreInternals,
  workspaces: readonly { id: string; path: string }[],
  selectedWorkspaceId: string,
  selectedSessionId: string,
): RalphLoopStatus | undefined {
  if (!selectedWorkspaceId || !selectedSessionId) {
    return undefined;
  }
  const workspace = workspaces.find((entry) => entry.id === selectedWorkspaceId);
  if (!workspace) {
    return undefined;
  }
  return readRalphLoopStatus(workspace.path, selectedSessionId) ?? undefined;
}

/**
 * Whether the selected chat is the one that wrote the workspace's Ralph plan,
 * so the "Begin Ralph loop" banner shows only there. Gated to avoid scanning
 * session entries unless there is actually a plan to run and the thread is
 * not already a loop thread.
 */
export async function resolveSelectedSessionCreatedRalphPlan(
  store: AppStoreInternals,
  workspaces: readonly WorkspaceRecord[],
  selectedWorkspaceId: string,
  selectedSessionId: string,
  selectedLoopStatus: RalphLoopStatus | undefined,
): Promise<boolean> {
  if (!selectedWorkspaceId || !selectedSessionId || selectedLoopStatus?.isSelectedSessionActive) {
    return false;
  }
  const workspace = workspaces.find((entry) => entry.id === selectedWorkspaceId);
  if (!workspace?.ralphPlans?.length) {
    return false;
  }
  try {
    return await store.driver.sessionEditedRalphPlan({
      workspaceId: selectedWorkspaceId,
      sessionId: selectedSessionId,
    });
  } catch {
    return false;
  }
}

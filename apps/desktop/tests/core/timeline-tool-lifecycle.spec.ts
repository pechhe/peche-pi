import { expect, test, type Page } from "@playwright/test";
import type { SessionDriverEvent, SessionRef, SessionSnapshot } from "@pi-gui/session-driver";
import {
  createNamedThread,
  emitTestSessionEvent,
  getDesktopState,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
} from "../helpers/electron-app";

async function selectedSessionRef(window: Page): Promise<SessionRef> {
  const state = await getDesktopState(window);
  if (!state.selectedWorkspaceId || !state.selectedSessionId) {
    throw new Error("Expected a selected session");
  }
  return { workspaceId: state.selectedWorkspaceId, sessionId: state.selectedSessionId };
}

function runningSnapshot(sessionRef: SessionRef, workspacePath: string): SessionSnapshot {
  return {
    ref: sessionRef,
    workspace: {
      workspaceId: sessionRef.workspaceId,
      path: workspacePath,
      displayName: "Timeline lifecycle workspace",
    },
    title: "Tool lifecycle",
    status: "running",
    runningRunId: "run-tool-lifecycle",
    updatedAt: new Date().toISOString(),
    preview: "Working",
  };
}

test("tool activity uses Codex-style running, completed, and grouped states", async () => {
  test.setTimeout(45_000);

  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("timeline-tool-lifecycle-workspace");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Tool lifecycle");
    const sessionRef = await selectedSessionRef(window);
    const timestamp = new Date().toISOString();

    await emitTestSessionEvent(harness, {
      type: "sessionUpdated",
      sessionRef,
      timestamp,
      snapshot: runningSnapshot(sessionRef, workspacePath),
    });

    const firstStarted: Extract<SessionDriverEvent, { type: "toolStarted" }> = {
      type: "toolStarted",
      sessionRef,
      timestamp,
      callId: "read-1",
      toolName: "read",
      input: { path: "src/foo.ts" },
    };
    await emitTestSessionEvent(harness, firstStarted);

    await expect(window.getByTestId("timeline-working")).toHaveCount(0);
    const runningTool = window.locator(".timeline-tool--running").first();
    await expect(runningTool.locator(".timeline-tool__label")).toHaveText("Reading src/foo.ts");

    const firstFinished: Extract<SessionDriverEvent, { type: "toolFinished" }> = {
      type: "toolFinished",
      sessionRef,
      timestamp,
      callId: "read-1",
      success: true,
      output: "foo contents",
    };
    await emitTestSessionEvent(harness, firstFinished);
    await expect(window.locator(".timeline-tool--running")).toHaveCount(0);
    await expect(window.locator(".timeline-tool .timeline-tool__label").first()).toHaveText("Read src/foo.ts");

    await emitTestSessionEvent(harness, {
      type: "toolStarted",
      sessionRef,
      timestamp,
      callId: "read-2",
      toolName: "read",
      input: { path: "src/bar.ts" },
    });
    await emitTestSessionEvent(harness, {
      type: "toolFinished",
      sessionRef,
      timestamp,
      callId: "read-2",
      success: true,
      output: "bar contents",
    });
    await emitTestSessionEvent(harness, {
      type: "assistantDelta",
      sessionRef,
      timestamp,
      text: "Done.",
    });

    await expect(window.locator(".timeline-tool-burst__label")).toHaveText("Explored 2 files");
    await window.locator(".timeline-tool-burst__header").click();
    await expect(window.locator(".timeline-tool-burst__body .timeline-tool__label")).toHaveText([
      "Read src/foo.ts",
      "Read src/bar.ts",
    ]);

    await emitTestSessionEvent(harness, {
      type: "toolStarted",
      sessionRef,
      timestamp,
      callId: "edit-1",
      toolName: "edit",
      input: {
        file_path: "src/live.ts",
        diff: "@@ -1 +1,2 @@\n-old\n+new\n+line\n",
      },
    });
    await emitTestSessionEvent(harness, {
      type: "toolFinished",
      sessionRef,
      timestamp,
      callId: "edit-1",
      success: true,
      output: { diff: "@@ -1 +1,2 @@\n-old\n+new\n+line\n" },
    });
    await emitTestSessionEvent(harness, {
      type: "assistantDelta",
      sessionRef,
      timestamp,
      text: " Edited live file.",
    });
    await expect(window.locator(".timeline-item--assistant", { hasText: "Edited live file." })).toBeVisible();
    const editCard = window.locator(".timeline-tool--write", { hasText: "Edited src/live.ts" });
    await expect(editCard.locator(".timeline-tool__label")).toHaveText("Edited src/live.ts");
    await expect(editCard.locator(".timeline-tool__stat-add")).toHaveText("+2");
    await expect(editCard.locator(".timeline-tool__stat-del")).toHaveText("-1");
  } finally {
    await harness.close();
  }
});

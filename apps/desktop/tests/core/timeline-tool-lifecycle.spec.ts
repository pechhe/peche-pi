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
    // The edit stays inline as a quiet line (no prominent box), and the
    // prominent edited-files box is brought out after the assistant reply.
    await expect(window.locator(".timeline-tool--write")).toHaveCount(0);
    const editBox = window.getByTestId("timeline-edited-files");
    await expect(editBox.locator(".timeline-edited-files__title")).toHaveText("Edited src/live.ts");
    await expect(editBox.locator(".timeline-tool__stat-add")).toHaveText("+2");
    await expect(editBox.locator(".timeline-tool__stat-del")).toHaveText("-1");
  } finally {
    await harness.close();
  }
});

test("multiple edits collapse into one Codex-style edited-files card", async () => {
  test.setTimeout(45_000);

  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("timeline-edited-files-card-workspace");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Edited files card");
    const sessionRef = await selectedSessionRef(window);
    const timestamp = new Date().toISOString();

    await emitTestSessionEvent(harness, {
      type: "sessionUpdated",
      sessionRef,
      timestamp,
      snapshot: runningSnapshot(sessionRef, workspacePath),
    });

    const edits: ReadonlyArray<{ callId: string; path: string; diff: string }> = [
      { callId: "edit-a", path: "src/a.ts", diff: "@@ -1 +1,3 @@\n-old\n+one\n+two\n+three\n" },
      { callId: "edit-b", path: "src/b.ts", diff: "@@ -1,2 +1 @@\n-gone\n-also\n+kept\n" },
    ];
    for (const edit of edits) {
      await emitTestSessionEvent(harness, {
        type: "toolStarted",
        sessionRef,
        timestamp,
        callId: edit.callId,
        toolName: "edit",
        input: { file_path: edit.path, diff: edit.diff },
      });
      await emitTestSessionEvent(harness, {
        type: "toolFinished",
        sessionRef,
        timestamp,
        callId: edit.callId,
        success: true,
        output: { diff: edit.diff },
      });
    }
    await emitTestSessionEvent(harness, {
      type: "assistantDelta",
      sessionRef,
      timestamp,
      text: " Edited two files.",
    });
    await expect(window.locator(".timeline-item--assistant", { hasText: "Edited two files." })).toBeVisible();

    const editBox = window.getByTestId("timeline-edited-files");
    await expect(editBox.locator(".timeline-edited-files__title")).toHaveText("Edited 2 files");
    await expect(editBox.getByTestId("timeline-edited-files-review")).toBeVisible();
    const rows = editBox.getByTestId("timeline-edited-files-row");
    await expect(rows).toHaveCount(2);
    await expect(rows.locator(".timeline-edited-files__path")).toHaveText(["src/a.ts", "src/b.ts"]);
  } finally {
    await harness.close();
  }
});

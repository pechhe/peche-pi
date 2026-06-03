import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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

test("undo reverts a turn's edits on disk", async () => {
  test.setTimeout(45_000);

  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("timeline-undo-workspace");
  // Simulate the post-edit working-tree state on disk.
  const filePath = join(workspacePath, "src/edited.ts");
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, "export const value = OMEGA;\n", "utf8");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Undo edits");
    const sessionRef = await selectedSessionRef(window);
    const timestamp = new Date().toISOString();

    await emitTestSessionEvent(harness, {
      type: "sessionUpdated",
      sessionRef,
      timestamp,
      snapshot: runningSnapshot(sessionRef, workspacePath),
    });

    const diff = "@@ -1 +1 @@\n-export const value = ALPHA;\n+export const value = OMEGA;\n";
    await emitTestSessionEvent(harness, {
      type: "toolStarted",
      sessionRef,
      timestamp,
      callId: "edit-undo",
      toolName: "edit",
      input: { path: "src/edited.ts", edits: [{ oldText: "ALPHA", newText: "OMEGA" }] },
    });
    await emitTestSessionEvent(harness, {
      type: "toolFinished",
      sessionRef,
      timestamp,
      callId: "edit-undo",
      success: true,
      output: { diff },
    });
    await emitTestSessionEvent(harness, {
      type: "assistantDelta",
      sessionRef,
      timestamp,
      text: " Edited the file.",
    });
    await expect(window.locator(".timeline-item--assistant", { hasText: "Edited the file." })).toBeVisible();

    const editBox = window.getByTestId("timeline-edited-files");
    await editBox.getByTestId("timeline-edited-files-undo").click();

    // Card flips to the reverted state and the file content is restored on disk.
    await expect(editBox.locator(".timeline-edited-files__title")).toHaveText("Reverted src/edited.ts");
    await expect(editBox.getByTestId("timeline-edited-files-undo")).toHaveCount(0);
    await expect.poll(() => readFile(filePath, "utf8")).toBe("export const value = ALPHA;\n");

    // Redo replays the edit forward: card returns to "Edited" and disk is reapplied.
    await editBox.getByTestId("timeline-edited-files-redo").click();
    await expect(editBox.locator(".timeline-edited-files__title")).toHaveText("Edited src/edited.ts");
    await expect(editBox.getByTestId("timeline-edited-files-undo")).toBeVisible();
    await expect.poll(() => readFile(filePath, "utf8")).toBe("export const value = OMEGA;\n");
  } finally {
    await harness.close();
  }
});

test("undo reverts an edit to a file outside the workspace", async () => {
  test.setTimeout(45_000);

  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("timeline-undo-outside-workspace");
  // A file that lives entirely outside the workspace root.
  const outsideDir = await mkdtemp(join(tmpdir(), "pi-undo-outside-"));
  const filePath = join(outsideDir, "Untitled.txt");
  await writeFile(filePath, "edited!\n", "utf8");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Undo outside");
    const sessionRef = await selectedSessionRef(window);
    const timestamp = new Date().toISOString();

    await emitTestSessionEvent(harness, {
      type: "sessionUpdated",
      sessionRef,
      timestamp,
      snapshot: runningSnapshot(sessionRef, workspacePath),
    });

    const diff = "@@ -1 +1 @@\n-original\n+edited!\n";
    await emitTestSessionEvent(harness, {
      type: "toolStarted",
      sessionRef,
      timestamp,
      callId: "edit-outside",
      toolName: "edit",
      input: { path: filePath, edits: [{ oldText: "original", newText: "edited!" }] },
    });
    await emitTestSessionEvent(harness, {
      type: "toolFinished",
      sessionRef,
      timestamp,
      callId: "edit-outside",
      success: true,
      output: { diff },
    });
    await emitTestSessionEvent(harness, {
      type: "assistantDelta",
      sessionRef,
      timestamp,
      text: " Edited the outside file.",
    });
    await expect(window.locator(".timeline-item--assistant", { hasText: "Edited the outside file." })).toBeVisible();

    const editBox = window.getByTestId("timeline-edited-files");
    await editBox.getByTestId("timeline-edited-files-undo").click();

    // Undo succeeds despite the path being outside the workspace root.
    await expect(editBox.getByTestId("timeline-edited-files-redo")).toBeVisible();
    await expect.poll(() => readFile(filePath, "utf8")).toBe("original\n");
  } finally {
    await harness.close();
    await rm(outsideDir, { recursive: true, force: true });
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

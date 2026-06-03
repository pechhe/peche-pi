import { expect, test, type Page } from "@playwright/test";
import type { SessionRef, SessionSnapshot } from "@pi-gui/session-driver";
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
      displayName: "Thinking section workspace",
    },
    title: "Thinking section",
    status: "running",
    runningRunId: "run-thinking",
    updatedAt: new Date().toISOString(),
    preview: "Thinking",
  };
}

test("reasoning streams live then collapses into a Thought disclosure when the answer starts", async () => {
  test.setTimeout(45_000);

  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("timeline-thinking-section-workspace");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Thinking section");
    const sessionRef = await selectedSessionRef(window);
    const timestamp = new Date().toISOString();

    await emitTestSessionEvent(harness, {
      type: "sessionUpdated",
      sessionRef,
      timestamp,
      snapshot: runningSnapshot(sessionRef, workspacePath),
    });

    // Reasoning streams in live: the section is auto-expanded with no header of
    // its own; the global braille "Thinking…" pill at the bottom is the live
    // indicator. The reasoning text is visible immediately (no click needed).
    await emitTestSessionEvent(harness, {
      type: "reasoningDelta",
      sessionRef,
      timestamp,
      text: "First I will inspect the file.",
    });
    await expect(window.getByTestId("timeline-working")).toBeVisible();
    await expect(window.getByTestId("timeline-thinking-toggle")).toHaveCount(0);
    await expect(window.locator(".timeline-thinking__reasoning").first()).toContainText(
      "First I will inspect the file.",
    );

    // A tool used while thinking renders inside the same live section.
    await emitTestSessionEvent(harness, {
      type: "toolStarted",
      sessionRef,
      timestamp,
      callId: "read-1",
      toolName: "read",
      input: { path: "src/foo.ts" },
    });
    await expect(window.locator(".timeline-thinking__body .timeline-tool__label").first()).toHaveText(
      "Reading src/foo.ts",
    );
    await emitTestSessionEvent(harness, {
      type: "toolFinished",
      sessionRef,
      timestamp,
      callId: "read-1",
      success: true,
      output: "foo",
    });

    // More reasoning continues to accumulate in the live section.
    await emitTestSessionEvent(harness, {
      type: "reasoningDelta",
      sessionRef,
      timestamp,
      text: " Now I understand the bug.",
    });

    // When the assistant answer begins, the whole thinking section collapses to
    // a "Thought for …" disclosure and the answer streams below it.
    await emitTestSessionEvent(harness, {
      type: "assistantDelta",
      sessionRef,
      timestamp,
      text: "Here is the fix.",
    });
    await expect(window.locator(".timeline-item--assistant", { hasText: "Here is the fix." })).toBeVisible();
    await expect(window.getByTestId("timeline-thinking-toggle")).toContainText("Thought");
    // Collapsed: reasoning body is hidden until the user re-opens it.
    await expect(window.locator(".timeline-thinking__reasoning")).toHaveCount(0);

    // Re-opening the disclosure reveals the reasoning and the tool it used.
    await window.getByTestId("timeline-thinking-toggle").click();
    await expect(window.locator(".timeline-thinking__reasoning").first()).toContainText(
      "First I will inspect the file.",
    );
    await expect(window.locator(".timeline-thinking__body .timeline-tool__label").first()).toHaveText(
      "Read src/foo.ts",
    );
  } finally {
    await harness.close();
  }
});

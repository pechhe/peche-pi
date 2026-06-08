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
      displayName: "Subagent UI workspace",
    },
    title: "Subagents",
    status: "running",
    runningRunId: "run-subagent-ui",
    updatedAt: new Date().toISOString(),
    preview: "Working",
  };
}

test("subagent tool call renders a first-class card, not a generic tool row", async () => {
  test.setTimeout(45_000);

  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("subagent-card-workspace");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Subagent card");
    const sessionRef = await selectedSessionRef(window);
    const timestamp = new Date().toISOString();

    await emitTestSessionEvent(harness, {
      type: "sessionUpdated",
      sessionRef,
      timestamp,
      snapshot: runningSnapshot(sessionRef, workspacePath),
    });

    await emitTestSessionEvent(harness, {
      type: "toolStarted",
      sessionRef,
      timestamp,
      callId: "sa-1",
      toolName: "subagent",
      input: { name: "auth-scout", agent: "scout", title: "Auth implementation map", task: "Find the auth files" },
    });
    await emitTestSessionEvent(harness, {
      type: "toolFinished",
      sessionRef,
      timestamp,
      callId: "sa-1",
      success: true,
      output: {
        content: [{ type: "text", text: "Sub-agent \"auth-scout\" completed (12s).\n\nFound 3 auth files." }],
        details: {
          name: "auth-scout",
          agent: "scout",
          title: "Auth implementation map",
          status: "completed",
          summary: "Found 3 auth files.",
          elapsed: 12,
        },
      },
    });

    const card = window.getByTestId("subagent-card");
    await expect(card).toBeVisible();
    // It must NOT fall back to the generic tool row.
    await expect(window.locator(".timeline-tool")).toHaveCount(0);
    // Agent identity: type label + agent name + kind theme.
    await expect(card).toHaveAttribute("data-agent-kind", "scout");
    await expect(card.locator(".subagent-card__type")).toHaveText("Scout");
    await expect(card.locator(".subagent-card__name")).toHaveText("auth-scout");
    await expect(card.locator(".subagent-card__status")).toHaveText("done");
    // Second line describes what the agent did, not its name.
    await expect(card.locator(".subagent-card__objective")).toHaveText("Found 3 auth files.");

    // View instructions reveals the prompt sent to the agent.
    await card.locator(".subagent-card__action", { hasText: "View instructions" }).click();
    await expect(card.locator(".subagent-card__pre", { hasText: "Find the auth files" })).toBeVisible();
  } finally {
    await harness.close();
  }
});

test("a batch subagent launch renders one row per child", async () => {
  test.setTimeout(45_000);

  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("subagent-batch-workspace");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Subagent batch");
    const sessionRef = await selectedSessionRef(window);
    const timestamp = new Date().toISOString();

    await emitTestSessionEvent(harness, {
      type: "sessionUpdated",
      sessionRef,
      timestamp,
      snapshot: runningSnapshot(sessionRef, workspacePath),
    });

    await emitTestSessionEvent(harness, {
      type: "toolStarted",
      sessionRef,
      timestamp,
      callId: "sa-batch",
      toolName: "subagent",
      input: {
        children: [
          { name: "auth-scout", agent: "scout", title: "Auth map", task: "find auth" },
          { name: "diff-reviewer", agent: "reviewer", title: "Diff review", task: "review diff" },
        ],
      },
    });
    await emitTestSessionEvent(harness, {
      type: "toolFinished",
      sessionRef,
      timestamp,
      callId: "sa-batch",
      success: true,
      output: {
        content: [{ type: "text", text: "batch done" }],
        details: {
          status: "batch",
          children: [
            { name: "auth-scout", agent: "scout", status: "completed", summary: "ok", elapsed: 5 },
            { name: "diff-reviewer", agent: "reviewer", status: "failed", summary: "nope", elapsed: 7 },
          ],
        },
      },
    });

    const cards = window.getByTestId("subagent-card");
    await expect(cards).toHaveCount(2);
    await expect(cards.locator(".subagent-card__name")).toHaveText(["auth-scout", "diff-reviewer"]);
    await expect(cards.locator(".subagent-card__status")).toHaveText(["done", "failed"]);
  } finally {
    await harness.close();
  }
});

test("a running subagent card shows live activity from the widget feed", async () => {
  test.setTimeout(45_000);

  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("subagent-live-workspace");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await createNamedThread(window, "Subagent live");
    const sessionRef = await selectedSessionRef(window);
    const timestamp = new Date().toISOString();

    await emitTestSessionEvent(harness, {
      type: "sessionUpdated",
      sessionRef,
      timestamp,
      snapshot: runningSnapshot(sessionRef, workspacePath),
    });

    // The launch is still running (toolStarted, no toolFinished yet).
    await emitTestSessionEvent(harness, {
      type: "toolStarted",
      sessionRef,
      timestamp,
      callId: "sa-live",
      toolName: "subagent",
      input: { name: "auth-scout", agent: "scout", title: "Auth implementation map", task: "find auth" },
    });

    // The extension publishes live progress for that agent via the widget.
    await emitTestSessionEvent(harness, {
      type: "hostUiRequest",
      sessionRef,
      timestamp,
      request: {
        kind: "widget",
        requestId: "widget:subagent-status",
        key: "subagent-status",
        lines: [
          "● Agents · 1 running · 12.3s",
          "└─ ◜ auth-scout [scout] · 3 tool uses · 12.5%/200k ctx",
          "     Auth implementation map",
          "     reading…",
        ],
        placement: "aboveComposer",
      },
    });

    const card = window.getByTestId("subagent-card");
    await expect(card).toBeVisible();
    await expect(card.locator(".subagent-card__status")).toHaveText("running");
    // The card itself becomes the live agent view: spinner + activity + stats.
    await expect(card.locator(".subagent-card__spinner")).toBeVisible();
    // Live activity drives the objective line, not the static name.
    await expect(card.locator(".subagent-card__objective")).toHaveText("reading…");
    await expect(card.locator(".subagent-card__stat").first()).toHaveText("3 tool uses");
  } finally {
    await harness.close();
  }
});

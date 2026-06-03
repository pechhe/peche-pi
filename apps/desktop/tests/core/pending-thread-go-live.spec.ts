import { expect, test } from "@playwright/test";
import { join } from "node:path";
import {
  createNamedThread,
  getDesktopState,
  getSelectedTranscript,
  launchDesktop,
  makeGitWorkspace,
  makeUserDataDir,
  makeWorkspace,
  resolveDeferredThreadTitleEventually,
  seedAgentDir,
  selectSession,
  setDeferredThreadTitleMode,
  startThreadViaIpc,
  waitForWorkspaceByPath,
} from "../helpers/electron-app";

// Characterization: the pending-thread go-live machinery must transition from
// placeholder ("New thread" / "Preparing your thread…") to live session
// without flashes, stale state, or stuck loading bars.

test("go-live transitions from placeholder title to resolved session title", async () => {
  const userDataDir = await makeUserDataDir("pi-app-user-data-");
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("go-live-ipc-workspace");
  await seedAgentDir(agentDir);
  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await setDeferredThreadTitleMode(harness);

    await startThreadViaIpc(window, {
      prompt: "Verify go-live placeholder and transition",
    });

    // Placeholder phase: session exists with "New thread" title.
    await expect(window.locator(".topbar__session")).toHaveText("New thread");
    await expect(window.getByTestId("composer")).toBeVisible();

    // Resolve the auto-title → go-live completes.
    await resolveDeferredThreadTitleEventually(harness, "Go-live resolved");

    // After go-live: real session title shown, composer active.
    await expect(window.locator(".topbar__session")).toHaveText("Go-live resolved");
    await expect(window.getByTestId("composer")).toBeVisible();

    // State is correctly wired.
    const state = await getDesktopState(window);
    expect(state.selectedSessionId).toBeTruthy();
    expect(state.selectedWorkspaceId).toBeTruthy();

    // Transcript contains the user message (go-live ran correctly).
    await expect
      .poll(async () => {
        const transcript = await getSelectedTranscript(window);
        return transcript?.transcript.some(
          (entry) => entry.kind === "message" && "role" in entry && entry.role === "user",
        );
      }, { timeout: 15_000 })
      .toBe(true);
  } finally {
    await harness.close();
  }
});

test("go-live placeholder clears when navigating away and back", async () => {
  const userDataDir = await makeUserDataDir("pi-app-user-data-");
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("go-live-nav-workspace");
  await seedAgentDir(agentDir);
  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    const workspace = await waitForWorkspaceByPath(window, workspacePath);
    await createNamedThread(window, "Existing thread");
    await setDeferredThreadTitleMode(harness);

    await startThreadViaIpc(window, {
      prompt: "Go-live after navigation roundtrip",
    });

    await expect(window.locator(".topbar__session")).toHaveText("New thread");
    await expect(window.getByTestId("composer")).toBeVisible();

    // Navigate to existing thread — state should hold.
    await selectSession(window, "Existing thread");
    await expect(window.locator(".topbar__session")).toHaveText("Existing thread");

    // Resolve while navigated away.
    await resolveDeferredThreadTitleEventually(harness, "Roundtrip title");
    await expect
      .poll(async () => {
        const state = await getDesktopState(window);
        return state.workspaces.some((ws) =>
          ws.sessions.some((session) => session.title === "Roundtrip title"),
        );
      })
      .toBe(true);

    // Navigate back — title is resolved, no stale placeholder.
    await selectSession(window, "Roundtrip title");
    await expect(window.locator(".topbar__session")).toHaveText("Roundtrip title");
    await expect(window.getByTestId("composer")).toBeVisible();
  } finally {
    await harness.close();
  }
});

test("go-live transitions for worktree threads", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir("pi-app-user-data-");
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeGitWorkspace("go-live-worktree-workspace");
  await seedAgentDir(agentDir);
  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    const rootWorkspace = await waitForWorkspaceByPath(window, workspacePath);
    await setDeferredThreadTitleMode(harness);

    await startThreadViaIpc(window, {
      environment: "worktree",
      workspaceName: rootWorkspace.name,
      prompt: "Go-live from worktree new thread",
    });

    await expect(window.locator(".topbar__session")).toHaveText("New thread");
    await expect(window.getByTestId("composer")).toBeVisible();

    await resolveDeferredThreadTitleEventually(harness, "Worktree go-live");

    await expect(window.locator(".topbar__session")).toHaveText("Worktree go-live");
    await expect(window.getByTestId("composer")).toBeVisible();

    const state = await getDesktopState(window);
    expect(state.selectedSessionId).toBeTruthy();
    expect(state.selectedWorkspaceId).toBeTruthy();
  } finally {
    await harness.close();
  }
});

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";
import {
  assertExists,
  getDesktopState,
  launchDesktop,
  makeGitWorkspace,
  makeUserDataDir,
  startThreadViaIpc,
  waitForWorkspaceByPath,
} from "../helpers/electron-app";
import type { PiAppWindow } from "../helpers/electron-app";
import type { PiDesktopApi } from "../../src/ipc";

const execFileAsync = promisify(execFile);

test("environment panel shows rows on load for local thread", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeGitWorkspace("env-panel-local");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);

    // Create a local thread via IPC seam
    await startThreadViaIpc(window, { environment: "local", prompt: "local probe" });

    // The environment panel should be visible (open by default)
    const panel = window.getByTestId("environment-panel");
    await expect(panel).toBeVisible();

    // Panel should contain the expected rows directly (no popover click needed)
    await expect(window.getByTestId("env-row-changes")).toBeVisible();
    await expect(window.getByTestId("env-row-location")).toBeVisible();
    await expect(window.getByTestId("env-row-branch")).toBeVisible();
    await expect(window.getByTestId("env-row-commit-push")).toBeVisible();
    await expect(window.getByTestId("env-sources")).toBeVisible();
  } finally {
    await harness.close();
  }
});

test("environment panel shows rows on load for worktree thread", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeGitWorkspace("env-panel-worktree");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);

    // Create a worktree thread via IPC seam
    await startThreadViaIpc(window, { environment: "worktree", prompt: "worktree probe" });

    await expect
      .poll(async () => {
        const state = await getDesktopState(window);
        const selected = state.workspaces.find((w) => w.id === state.selectedWorkspaceId);
        return selected?.kind === "worktree";
      })
      .toBe(true);

    // The environment panel should be visible (open by default)
    const panel = window.getByTestId("environment-panel");
    await expect(panel).toBeVisible();

    // Panel should contain the expected rows directly
    await expect(window.getByTestId("env-row-changes")).toBeVisible();
    await expect(window.getByTestId("env-row-location")).toBeVisible();
    await expect(window.getByTestId("env-row-branch")).toBeVisible();
    await expect(window.getByTestId("env-row-commit-push")).toBeVisible();
  } finally {
    await harness.close();
  }
});

test("environment panel location row allows switching between local and worktree", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeGitWorkspace("env-panel-location-switch");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    const rootWorkspace = await waitForWorkspaceByPath(window, workspacePath);

    // Create a local thread first
    await startThreadViaIpc(window, { environment: "local", prompt: "switch test" });

    // Panel should be visible (open by default)
    const panel = window.getByTestId("environment-panel");
    await expect(panel).toBeVisible();

    // Location row should exist with Local/Worktree content
    const locationRow = window.getByTestId("env-row-location");
    await expect(locationRow).toBeVisible();
    await expect(locationRow).toContainText("Local");
  } finally {
    await harness.close();
  }
});

test("local branch picker checks out a branch on select", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeGitWorkspace("branch-switch");

  // Create a second branch in the temp repo
  await execFileAsync("git", ["checkout", "-b", "feature-x"], { cwd: workspacePath });
  await execFileAsync("git", ["checkout", "main"], { cwd: workspacePath });

  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    const rootWorkspace = await waitForWorkspaceByPath(window, workspacePath);
    const wsId = rootWorkspace.id;

    // Verify we start on main
    const initialState = await window.evaluate(async (id: string) => {
      const api = (window as PiAppWindow).piApp as PiDesktopApi;
      return api.listBranches(id);
    }, wsId);
    expect(initialState.currentBranch).toBe("main");

    // Checkout feature-x via IPC
    const result = await window.evaluate(async (id: string) => {
      const api = (window as PiAppWindow).piApp as PiDesktopApi;
      return api.checkoutBranch(id, "feature-x");
    }, wsId);
    expect(result.success).toBe(true);

    // Assert branch changed
    const afterState = await window.evaluate(async (id: string) => {
      const api = (window as PiAppWindow).piApp as PiDesktopApi;
      return api.listBranches(id);
    }, wsId);
    expect(afterState.currentBranch).toBe("feature-x");
  } finally {
    await harness.close();
  }
});

test("auto-ship override swaps Commit & Push row for Ship button", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeGitWorkspace("env-autoship-override");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);

    // Create a local thread
    await startThreadViaIpc(window, { environment: "local", prompt: "autoship probe" });

    // Panel is open by default
    const panel = window.getByTestId("environment-panel");
    await expect(panel).toBeVisible();

    // By default (auto-ship OFF), the commit-push row should contain
    // the CommitPushButton and NOT the Ship button.
    const commitPushRow = window.getByTestId("env-row-commit-push");
    await expect(commitPushRow).toBeVisible();
    await expect(window.getByTestId("env-row-ship-button")).toHaveCount(0);

    // Open settings gear to access auto-ship override
    const gear = window.getByTestId("env-settings-gear");
    await gear.click();

    // The auto-ship override row should be visible in the settings popover
    const overrideRow = window.getByTestId("env-row-autoship-override");
    await expect(overrideRow).toBeVisible();

    // Click "On" to set per-thread override
    await overrideRow.getByRole("button", { name: "On" }).click();

    // Now the commit-push row should show the Ship button instead
    const shipButton = window.getByTestId("env-row-ship-button");
    await expect(shipButton).toBeVisible();
    await expect(shipButton).toContainText("Ship");

    // Settings popover is still open — click "Off" directly
    await overrideRow.getByRole("button", { name: "Off", exact: true }).click();

    // Ship button should disappear, CommitPushButton should be back
    await expect(window.getByTestId("env-row-ship-button")).toHaveCount(0);

    // Settings popover is still open — click "Default" directly
    await overrideRow.getByRole("button", { name: /Default/ }).click();
    await expect(window.getByTestId("env-row-ship-button")).toHaveCount(0);
    await expect(commitPushRow).toBeVisible();
  } finally {
    await harness.close();
  }
});

test("dirty working tree blocks branch switch with clear message", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeGitWorkspace("branch-dirty-block");

  // Create a second branch
  await execFileAsync("git", ["checkout", "-b", "feature-y"], { cwd: workspacePath });
  await execFileAsync("git", ["checkout", "main"], { cwd: workspacePath });

  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    const rootWorkspace = await waitForWorkspaceByPath(window, workspacePath);
    const wsId = rootWorkspace.id;

    // Write an uncommitted change
    const { writeFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    await writeFile(join(workspacePath, "dirty.txt"), "uncommitted", "utf8");

    // Attempt checkout — should fail
    const result = await window.evaluate(async (id: string) => {
      const api = (window as PiAppWindow).piApp as PiDesktopApi;
      return api.checkoutBranch(id, "feature-y");
    }, wsId);
    expect(result.success).toBe(false);
    expect(result.message).toContain("uncommitted changes");

    // Branch should still be main
    const afterState = await window.evaluate(async (id: string) => {
      const api = (window as PiAppWindow).piApp as PiDesktopApi;
      return api.listBranches(id);
    }, wsId);
    expect(afterState.currentBranch).toBe("main");
  } finally {
    await harness.close();
  }
});

test("createBranch IPC creates and switches to new branch, carries dirty tree", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeGitWorkspace("branch-create");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    const rootWorkspace = await waitForWorkspaceByPath(window, workspacePath);
    const wsId = rootWorkspace.id;

    // Write an uncommitted file (dirty tree)
    const { writeFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    await writeFile(join(workspacePath, "dirty.txt"), "uncommitted", "utf8");

    // createBranch should succeed despite dirty tree
    const result = await window.evaluate(async (id: string) => {
      const api = (window as PiAppWindow).piApp as PiDesktopApi;
      return api.createBranch(id, "feature/new-thing");
    }, wsId);
    expect(result.success).toBe(true);

    // Branch should now be feature/new-thing
    const afterState = await window.evaluate(async (id: string) => {
      const api = (window as PiAppWindow).piApp as PiDesktopApi;
      return api.listBranches(id);
    }, wsId);
    expect(afterState.currentBranch).toBe("feature/new-thing");

    // Dirty file should still exist (carried onto new branch)
    const { stat } = await import("node:fs/promises");
    await expect(stat(join(workspacePath, "dirty.txt"))).resolves.toBeDefined();
  } finally {
    await harness.close();
  }
});

test("environment panel toggle button hides and restores the panel", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeGitWorkspace("env-panel-toggle");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);

    // Create a local thread
    await startThreadViaIpc(window, { environment: "local", prompt: "toggle test" });

    // Panel should be visible by default
    const panel = window.getByTestId("environment-panel");
    await expect(panel).toBeVisible();

    // The shell should have the env-panel-open class
    const shell = window.locator(".shell");
    await expect(shell).toHaveClass(/shell--env-panel-open/);

    // Click the toggle button to hide
    const toggleBtn = window.getByLabel("Toggle environment panel");
    await toggleBtn.click();

    // Panel should be hidden
    await expect(panel).not.toBeVisible();
    await expect(shell).not.toHaveClass(/shell--env-panel-open/);

    // Click again to restore
    await toggleBtn.click();

    // Panel should be visible again
    await expect(panel).toBeVisible();
    await expect(shell).toHaveClass(/shell--env-panel-open/);
  } finally {
    await harness.close();
  }
});

test("getWorkspaceDiffStat returns insertions for untracked files", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeGitWorkspace("diff-stat-untracked");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    const rootWorkspace = await waitForWorkspaceByPath(window, workspacePath);
    const wsId = rootWorkspace.id;

    // Create an untracked file with known content
    const { writeFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    await writeFile(join(workspacePath, "new-file.txt"), "line 1\nline 2\nline 3\n", "utf8");

    // Call getWorkspaceDiffStat via IPC seam
    const stat = await window.evaluate(async (id: string) => {
      const api = (window as PiAppWindow).piApp as PiDesktopApi;
      return api.getWorkspaceDiffStat(id);
    }, wsId);

    // Untracked file with 3 lines + trailing newline → 4 insertions (split gives 4 segments)
    expect(stat.insertions).toBeGreaterThan(0);
    expect(stat.deletions).toBe(0);
  } finally {
    await harness.close();
  }
});

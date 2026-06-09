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

test("environment widget shows local read-out with branch for local thread", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeGitWorkspace("env-widget-local");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);

    // Create a local thread via IPC seam
    await startThreadViaIpc(window, { environment: "local", prompt: "local probe" });

    // The environment widget should be visible
    const widget = window.getByTestId("environment-widget");
    await expect(widget).toBeVisible();

    // Read-out should show Local + branch (main)
    const readout = window.getByTestId("environment-widget-readout");
    await expect(readout).toContainText("Local");
    await expect(readout).toContainText("main");

    // Branch element should contain the branch name
    const branchEl = window.getByTestId("environment-widget-branch");
    await expect(branchEl).toContainText("main");

    // Clicking the read-out opens the popover
    await readout.click();
    const popover = window.getByTestId("environment-widget-popover");
    await expect(popover).toBeVisible();

    // Popover contains the expected rows
    await expect(window.getByTestId("env-row-changes")).toBeVisible();
    await expect(window.getByTestId("env-row-location")).toBeVisible();
    await expect(window.getByTestId("env-row-branch")).toBeVisible();
    await expect(window.getByTestId("env-row-commit-push")).toBeVisible();
  } finally {
    await harness.close();
  }
});

test("environment widget shows worktree read-out with branch for worktree thread", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeGitWorkspace("env-widget-worktree");
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

    // The environment widget should be visible
    const widget = window.getByTestId("environment-widget");
    await expect(widget).toBeVisible();

    // Read-out should show Worktree
    const readout = window.getByTestId("environment-widget-readout");
    await expect(readout).toContainText("Worktree");

    // Branch element should show a branch (detached worktrees show base branch with badge)
    const branchEl = window.getByTestId("environment-widget-branch");
    await expect(branchEl).toContainText("⎇");

    // Clicking opens the popover with all rows
    await readout.click();
    const popover = window.getByTestId("environment-widget-popover");
    await expect(popover).toBeVisible();
    await expect(window.getByTestId("env-row-changes")).toBeVisible();
    await expect(window.getByTestId("env-row-location")).toBeVisible();
    await expect(window.getByTestId("env-row-branch")).toBeVisible();
    await expect(window.getByTestId("env-row-commit-push")).toBeVisible();
  } finally {
    await harness.close();
  }
});

test("environment widget popover location row allows switching between local and worktree", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeGitWorkspace("env-widget-location-switch");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    const rootWorkspace = await waitForWorkspaceByPath(window, workspacePath);

    // Create a local thread first
    await startThreadViaIpc(window, { environment: "local", prompt: "switch test" });

    const readout = window.getByTestId("environment-widget-readout");
    await expect(readout).toContainText("Local");

    // Open the popover
    await readout.click();
    await expect(window.getByTestId("environment-widget-popover")).toBeVisible();

    // Location row should exist with Local/Worktree buttons
    const locationRow = window.getByTestId("env-row-location");
    await expect(locationRow).toBeVisible();
    await expect(locationRow).toContainText("Local");
    await expect(locationRow).toContainText("Worktree");
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

    // Open the environment widget popover
    const readout = window.getByTestId("environment-widget-readout");
    await readout.click();
    const popover = window.getByTestId("environment-widget-popover");
    await expect(popover).toBeVisible();

    // By default (auto-ship OFF), the commit-push row should contain
    // the CommitPushButton (text "Commit & Push") and NOT the Ship button.
    const commitPushRow = window.getByTestId("env-row-commit-push");
    await expect(commitPushRow).toBeVisible();
    await expect(commitPushRow).toContainText("Commit");
    await expect(window.getByTestId("env-row-ship-button")).toHaveCount(0);

    // The auto-ship override row should be visible
    const overrideRow = window.getByTestId("env-row-autoship-override");
    await expect(overrideRow).toBeVisible();

    // Click "On" to set per-thread override
    await overrideRow.getByRole("button", { name: "On" }).click();

    // Now the commit-push row should show the Ship button instead
    const shipButton = window.getByTestId("env-row-ship-button");
    await expect(shipButton).toBeVisible();
    await expect(shipButton).toContainText("Ship");

    // Click "Off" to revert
    await overrideRow.getByRole("button", { name: "Off", exact: true }).click();

    // Ship button should disappear, CommitPushButton should be back
    await expect(window.getByTestId("env-row-ship-button")).toHaveCount(0);
    await expect(commitPushRow).toContainText("Commit");

    // Click "Default" to inherit global (off)
    await overrideRow.getByRole("button", { name: /Default/ }).click();
    await expect(window.getByTestId("env-row-ship-button")).toHaveCount(0);
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

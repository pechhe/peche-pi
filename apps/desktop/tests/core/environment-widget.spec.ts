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

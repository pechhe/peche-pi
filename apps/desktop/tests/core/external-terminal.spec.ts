import { expect, test } from "@playwright/test";
import {
  createNamedThread,
  desktopShortcut,
  getDesktopState,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  waitForWorkspaceByPath,
} from "../helpers/electron-app";

test("hands an idle session off to the default terminal without error", async () => {
  test.setTimeout(45_000);

  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("external-terminal");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    await createNamedThread(window, "External terminal handoff");

    const button = window.getByLabel("Open in external terminal");
    await expect(button).toBeVisible();
    await expect(button).toBeEnabled();

    // Under PI_APP_TEST_MODE the real terminal launch is skipped, but the full
    // main-process handoff path (resolve session file -> closeSession -> reload)
    // still runs.
    await button.click();

    // No error toast should appear from the handoff path.
    await expect(window.locator(".toast--error")).toHaveCount(0);

    const state = await getDesktopState(window);
    expect(state.lastError).toBeFalsy();
    // First-run picker choice was persisted to settings.
    expect(state.externalTerminalApp).toBe("/System/Applications/Utilities/Terminal.app");
    // Session remains listed (handoff drops the in-memory runtime, not the file).
    const workspace = state.workspaces.find((entry) => entry.path === workspacePath);
    expect(workspace?.sessions.length ?? 0).toBeGreaterThan(0);
  } finally {
    await harness.close();
  }
});

test("changes and clears the external terminal app from settings", async () => {
  test.setTimeout(45_000);

  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("external-terminal-settings");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);

    await window.keyboard.press(desktopShortcut(","));
    await expect(window.getByTestId("settings-surface")).toBeVisible();
    await window.getByRole("button", { name: "General", exact: true }).click();

    const row = window.locator(".settings-row", { hasText: "External terminal app" });
    await expect(row).toContainText("Not set");

    // Picker is stubbed under PI_APP_TEST_MODE to return Terminal.app.
    await row.getByRole("button", { name: "Choose…" }).click();
    await expect(row).toContainText("Terminal");
    expect((await getDesktopState(window)).externalTerminalApp).toBe(
      "/System/Applications/Utilities/Terminal.app",
    );

    await row.getByRole("button", { name: "Clear" }).click();
    await expect(row).toContainText("Not set");
    expect((await getDesktopState(window)).externalTerminalApp).toBe("");
  } finally {
    await harness.close();
  }
});

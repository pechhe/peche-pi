import { expect, test } from "@playwright/test";
import {
  createNamedThread,
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
    // Session remains listed (handoff drops the in-memory runtime, not the file).
    const workspace = state.workspaces.find((entry) => entry.path === workspacePath);
    expect(workspace?.sessions.length ?? 0).toBeGreaterThan(0);
  } finally {
    await harness.close();
  }
});

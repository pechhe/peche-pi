import { expect, test } from "@playwright/test";
import {
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  waitForWorkspaceByPath,
} from "../helpers/electron-app";

test("window title renders 'pi' before any workspace selection", async () => {
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("app-title-workspace");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    await expect(window).toHaveTitle(/pi/);
  } finally {
    await harness.close();
  }
});

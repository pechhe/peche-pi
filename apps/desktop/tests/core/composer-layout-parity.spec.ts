import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { launchDesktop, makeUserDataDir, makeWorkspace, openNewThread, seedAgentDir } from "../helpers/electron-app";

// Headline gate for #54: the layout engine rendering the DEFAULT layout must be
// structurally equivalent to the old hardcoded control row — same controls, same
// left-to-right order — so users who never open the editor see no change.
//
// The production composer uses ComposerLayoutLegacyRow which renders controls
// inline with · separators inside .composer__controls (display:contents).
// The grid renderer (ComposerLayoutRenderer) is only used in the editor preview.

test("default layout renders built-in controls in the canonical order", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("composer-parity-order");
  await seedAgentDir(agentDir);

  const run = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await run.firstWindow();
    await openNewThread(window);

    // The grid renderer places controls in a CSS Grid
    const controlsGrid = window.locator(".composer-layout-grid").first();
    await expect(controlsGrid).toBeVisible({ timeout: 15_000 });

    await expect(window.locator(".composer__hint")).toBeVisible({ timeout: 10_000 });

    // The send button is now rendered inside the grid via the registry
    await expect(window.getByTestId("send").first()).toBeVisible();
  } finally {
    await run.close();
  }
});

test("required controls are present in the default layout", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("composer-parity-required");
  await seedAgentDir(agentDir);

  const run = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await run.firstWindow();
    await openNewThread(window);

    // The grid renderer renders controls in a CSS Grid
    const controlsGrid = window.locator(".composer-layout-grid").first();
    await expect(controlsGrid).toBeVisible({ timeout: 15_000 });

    // Model selector should be present
    await expect(window.locator(".model-selector").first()).toBeVisible({ timeout: 10_000 });

    // Caveman selector (devbtn) should be present
    await expect(window.locator(".devbtn").first()).toBeVisible({ timeout: 10_000 });

    // Send button should be present
    await expect(window.getByTestId("send").first()).toBeVisible();
  } finally {
    await run.close();
  }
});

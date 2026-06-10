import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { launchDesktop, makeUserDataDir, makeWorkspace, openNewThread, seedAgentDir } from "../helpers/electron-app";

// Headline gate for #54: the layout engine rendering the DEFAULT layout must be
// structurally equivalent to the old hardcoded control row — same controls, same
// left-to-right order — so users who never open the editor see no change.

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

    const grid = window.locator(".composer-layout-grid").first();
    await expect(grid).toBeVisible({ timeout: 15_000 });
    // Wait for the built-in cells to be placed before reading their order.
    await expect(grid.locator('[data-unit-id="builtin:send"]')).toHaveCount(1, { timeout: 15_000 });

    // Canonical order from the old ComposerControlRow. (builtin:badges renders
    // empty when the model has no feature badges — same as the old row — so we
    // assert structural DOM order, not per-cell visibility.)
    const expectedOrder = [
      "builtin:mode",
      "builtin:model",
      "builtin:reasoning",
      "builtin:orchestrate",
      "builtin:badges",
      "builtin:send",
    ];

    const actualOrder = await grid
      .locator('[data-unit-id^="builtin:"]')
      .evaluateAll((cells) => cells.map((c) => c.getAttribute("data-unit-id")));
    expect(actualOrder).toEqual(expectedOrder);

    // The send button is still wired through the layout renderer.
    await expect(window.getByTestId("send").first()).toBeVisible();
  } finally {
    await run.close();
  }
});

test("required controls are present and marked required in the default layout", async () => {
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

    const grid = window.locator(".composer-layout-grid").first();
    await expect(grid).toBeVisible({ timeout: 15_000 });

    for (const unitId of ["builtin:model", "builtin:reasoning", "builtin:send"]) {
      const cell = grid.locator(`[data-unit-id="${unitId}"]`).first();
      await expect(cell, `${unitId} should render`).toBeVisible({ timeout: 10_000 });
      await expect(cell, `${unitId} should be marked required`).toHaveAttribute("data-required", "");
    }
  } finally {
    await run.close();
  }
});

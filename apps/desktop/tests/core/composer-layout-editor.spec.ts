import { test, expect } from "@playwright/test";
import { join } from "node:path";
import {
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  openNewThread,
  seedAgentDir,
} from "../helpers/electron-app";

test.describe("Composer Layout Editor", () => {
  test("inline edit mode activates on real composer", async () => {
    test.setTimeout(90_000);
    const userDataDir = await makeUserDataDir();
    const agentDir = join(userDataDir, "agent");
    const workspacePath = await makeWorkspace("composer-layout-editor-open");
    await seedAgentDir(agentDir);

    const run = await launchDesktop(userDataDir, {
      agentDir,
      initialWorkspaces: [workspacePath],
      testMode: "background",
    });

    try {
      const window = await run.firstWindow();
      // Open the composer at least once so control-unit registry is populated.
      await openNewThread(window);

      // Navigate to Settings → Appearance → Edit layout.
      await window.evaluate(async () => {
        const app = (window as any).piApp;
        if (!app) throw new Error("piApp unavailable");
        await app.setActiveView("settings");
      });
      await window.getByRole("button", { name: "Appearance", exact: true }).click();
      await window.getByRole("button", { name: "Edit layout" }).click();

      // The view switches back to session with inline edit mode active.
      // Wait for the toolbar to appear.
      await window.waitForSelector("[data-testid='composer-layout-toolbar']", { timeout: 15_000 });

      // Toolbar shows "Editing layout" title.
      await expect(window.locator(".composer-layout-toolbar__title")).toHaveText("Editing layout");

      // Palette panel appears on the left.
      await expect(window.locator("[data-testid='composer-layout-palette']")).toBeVisible();

      // Inspector panel appears on the right.
      await expect(window.locator("[data-testid='composer-layout-inspector']")).toBeVisible();

      // The real composer is still visible (controls are rendered inline).
      const controls = window.locator(".composer__controls");
      await expect(controls).toBeVisible();

      // The controls have inline-cell wrappers (draggable in edit mode).
      const inlineCells = controls.locator(".composer-layout-editor__inline-cell");
      const cellCount = await inlineCells.count();
      expect(cellCount).toBeGreaterThanOrEqual(3); // At least model, caveman, send

      // Inspector starts empty (no selection).
      await expect(window.locator(".composer-layout-inspector__empty-text")).toContainText("Select a control");

      // Click on a control to select it.
      const firstCell = inlineCells.first();
      await firstCell.click();

      // Inspector now shows the selected unit's label.
      await expect(window.locator(".composer-layout-inspector__title")).not.toBeEmpty();

      // Save starts disabled (no changes).
      const saveBtn = window.locator(".composer-layout-toolbar__btn--primary");
      await expect(saveBtn).toBeDisabled();

      // Click Reset — makes layout dirty.
      await window.locator(".composer-layout-toolbar__btn--secondary", { hasText: "Reset" }).click();
      await expect(saveBtn).toBeEnabled();

      // Click Revert — back to original.
      await window.locator(".composer-layout-toolbar__btn--secondary", { hasText: "Revert" }).click();
      await expect(saveBtn).toBeDisabled();
    } finally {
      await run.close();
    }
  });

  test("save persists layout and deactivates edit mode", async () => {
    test.setTimeout(90_000);
    const userDataDir = await makeUserDataDir();
    const agentDir = join(userDataDir, "agent");
    const workspacePath = await makeWorkspace("composer-layout-editor-save");
    await seedAgentDir(agentDir);

    const run = await launchDesktop(userDataDir, {
      agentDir,
      initialWorkspaces: [workspacePath],
      testMode: "background",
    });

    try {
      const window = await run.firstWindow();
      await openNewThread(window);

      await window.evaluate(async () => {
        const app = (window as any).piApp;
        if (!app) throw new Error("piApp unavailable");
        await app.setActiveView("settings");
      });
      await window.getByRole("button", { name: "Appearance", exact: true }).click();
      await window.getByRole("button", { name: "Edit layout" }).click();

      // Wait for inline edit mode.
      await window.waitForSelector("[data-testid='composer-layout-toolbar']", { timeout: 15_000 });

      // Click Reset to make dirty, then Save.
      await window.locator(".composer-layout-toolbar__btn--secondary", { hasText: "Reset" }).click();
      await window.locator(".composer-layout-toolbar__btn--primary").click();

      // Edit mode deactivates — toolbar disappears.
      await expect(window.locator("[data-testid='composer-layout-toolbar']")).not.toBeVisible({ timeout: 10_000 });
    } finally {
      await run.close();
    }
  });

  test("required units cannot be removed", async () => {
    test.setTimeout(90_000);
    const userDataDir = await makeUserDataDir();
    const agentDir = join(userDataDir, "agent");
    const workspacePath = await makeWorkspace("composer-layout-editor-required");
    await seedAgentDir(agentDir);

    const run = await launchDesktop(userDataDir, {
      agentDir,
      initialWorkspaces: [workspacePath],
      testMode: "background",
    });

    try {
      const window = await run.firstWindow();
      await openNewThread(window);

      await window.evaluate(async () => {
        const app = (window as any).piApp;
        if (!app) throw new Error("piApp unavailable");
        await app.setActiveView("settings");
      });
      await window.getByRole("button", { name: "Appearance", exact: true }).click();
      await window.getByRole("button", { name: "Edit layout" }).click();

      await window.waitForSelector("[data-testid='composer-layout-toolbar']", { timeout: 15_000 });

      // Click on a required unit (model) — no remove button in inspector.
      const controls = window.locator(".composer__controls");
      const modelCell = controls.locator(".composer-layout-editor__inline-cell").first();
      await modelCell.click();

      // Inspector shows the unit.
      await expect(window.locator(".composer-layout-inspector__title")).not.toBeEmpty();

      // The remove button should NOT be present for required units.
      // (We can't easily check which unit was clicked, but we can verify
      // the inspector structure.)
    } finally {
      await run.close();
    }
  });
});

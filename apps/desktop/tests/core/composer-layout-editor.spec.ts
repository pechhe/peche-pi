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
  test("editor opens and shows the default layout in preview + palette + inspector", async () => {
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
      await window.waitForSelector(".composer-layout-editor");

      // Preview grid contains all 6 built-in placements (mode, model, reasoning,
      // orchestrate, badges, send) in the default layout.
      const grid = window.locator(".composer-layout-editor__preview .composer-layout-grid");
      await expect(grid).toBeVisible({ timeout: 15_000 });

      const cellCount = await grid.locator("[data-unit-id^='builtin:']").count();
      expect(cellCount).toBe(6);

      // The default layout places all built-ins, so palette shows "All controls are placed".
      await expect(window.locator(".composer-layout-editor__palette-empty")).toContainText("All controls are placed");

      // Inspector starts empty (no selection).
      await expect(window.locator(".composer-layout-editor__inspector-empty")).toContainText("Select a control");

      // Click on the send cell (always visible — renders a real button).
      const sendCell = grid.locator('[data-unit-id="builtin:send"]');
      await expect(sendCell).toBeVisible();
      await sendCell.click();

      // Inspector now shows the selected unit's label ("Send").
      await expect(window.locator(".composer-layout-editor__inspector-title")).toHaveText("Send");

      // Send is a required unit — the "Required" badge appears, the remove button does NOT.
      await expect(window.locator(".composer-layout-editor__inspector-badge")).toHaveText("Required");
      await expect(window.locator(".composer-layout-editor__remove-button")).toHaveCount(0);

      // Width slider is present.
      await expect(window.locator(".composer-layout-editor__inspector-field input[type='range']")).toBeVisible();

      // Show-label checkbox is present.
      await expect(window.locator(".composer-layout-editor__inspector-field input[type='checkbox']")).toBeVisible();
    } finally {
      await run.close();
    }
  });

  test("save persists layout, revert discards changes, reset restores default", async () => {
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
      await window.waitForSelector(".composer-layout-editor");

      // Save starts disabled (no changes).
      const saveBtn = window.locator(".composer-layout-editor__action--primary", { hasText: "Save" });
      await expect(saveBtn).toBeDisabled();

      // Revert starts disabled (no changes).
      const revertBtn = window.locator(".composer-layout-editor__action--secondary", { hasText: "Revert" });
      await expect(revertBtn).toBeDisabled();

      // Click Reset to default — makes layout dirty.
      await window.locator(".composer-layout-editor__action", { hasText: "Reset to default" }).click();
      await expect(saveBtn).toBeEnabled();
      await expect(revertBtn).toBeEnabled();

      // Revert discards changes — back to original state.
      await revertBtn.click();
      await expect(saveBtn).toBeDisabled();

      // Click Reset again, then Save — persists.
      await window.locator(".composer-layout-editor__action", { hasText: "Reset to default" }).click();
      await saveBtn.click();

      // We're back in settings after save.
      await window.waitForSelector(".settings-view");

      // Reopen — layout persisted (all 6 built-ins still present).
      await window.getByRole("button", { name: "Edit layout" }).click();
      await window.waitForSelector(".composer-layout-editor");
      const grid = window.locator(".composer-layout-editor__preview .composer-layout-grid");
      const cellCount = await grid.locator("[data-unit-id^='builtin:']").count();
      expect(cellCount).toBe(6);
    } finally {
      await run.close();
    }
  });

  test("required units are always present and cannot be removed", async () => {
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
      await window.waitForSelector(".composer-layout-editor");

      const grid = window.locator(".composer-layout-editor__preview .composer-layout-grid");

      // All three required units have the data-required boolean attribute.
      for (const unitId of ["builtin:model", "builtin:reasoning", "builtin:send"]) {
        const cell = grid.locator(`[data-unit-id="${unitId}"]`);
        await expect(cell).toBeVisible();
        await expect(cell).toHaveAttribute("data-required");
      }

      // Click on a required unit — no remove button.
      await grid.locator('[data-unit-id="builtin:model"]').click();
      await expect(window.locator(".composer-layout-editor__inspector-title")).toHaveText("Model");
      await expect(window.locator(".composer-layout-editor__inspector-badge")).toHaveText("Required");
      await expect(window.locator(".composer-layout-editor__remove-button")).toHaveCount(0);
    } finally {
      await run.close();
    }
  });
});

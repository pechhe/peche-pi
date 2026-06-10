import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  openNewThread,
  seedAgentDir,
  type PiAppWindow,
} from "../helpers/electron-app";

async function readPersistedActions(agentDir: string) {
  const raw = await readFile(join(agentDir, "chassis", "state.json"), "utf8");
  return JSON.parse(raw) as { actions: Array<{ id: string; label: string; showLabel: boolean; trigger: string; effect: { type: string; text?: string; template?: string } }> };
}

async function navigateToSettingsActions(window: Awaited<ReturnType<Awaited<ReturnType<typeof launchDesktop>>["firstWindow"]>>) {
  await window.evaluate(async () => {
    const app = (window as PiAppWindow).piApp;
    if (!app) throw new Error("piApp unavailable");
    await app.setActiveView("settings");
  });
  await window.getByRole("button", { name: "Actions", exact: true }).click();
  await expect(window.getByTestId("chassis-action-label-input")).toBeVisible({ timeout: 10_000 });
}

test("edit action: update label + payload, persists and updates composer button", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("chassis-manage-edit");
  await seedAgentDir(agentDir);

  // Pre-seed one action
  const chassisDir = join(agentDir, "chassis");
  await mkdir(chassisDir, { recursive: true });
  const actionId = "edit-test-1";
  await writeFile(
    join(chassisDir, "state.json"),
    JSON.stringify({
      actions: [
        { id: actionId, label: "Original label", showLabel: true, trigger: "oneShot", effect: { type: "submit", text: "/original" } },
      ],
    }),
    "utf8",
  );

  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();

    // Navigate to Settings → Actions
    await navigateToSettingsActions(window);

    // The action row should show original values
    const row = window.getByTestId(`chassis-action-row-${actionId}`);
    await expect(row).toBeVisible({ timeout: 10_000 });
    await expect(row).toContainText("Original label");

    // Click Edit
    await window.getByTestId(`chassis-action-edit-${actionId}`).click();

    // The inline editor should appear with pre-filled values
    const editLabel = window.getByTestId(`chassis-action-edit-label-${actionId}`);
    const editPayload = window.getByTestId(`chassis-action-edit-payload-${actionId}`);
    await expect(editLabel).toBeVisible({ timeout: 5_000 });
    await expect(editLabel).toHaveValue("Original label");
    await expect(editPayload).toHaveValue("/original");

    // Update label and payload
    await editLabel.fill("Updated label");
    await editPayload.fill("/updated-command");

    // Save
    await window.getByTestId(`chassis-action-save-${actionId}`).click();

    // The row should show updated values
    await expect(row).toContainText("Updated label", { timeout: 10_000 });
    await expect(row).toContainText("/updated-command");

    // Persisted state.json should reflect the update
    const persisted = await readPersistedActions(agentDir);
    expect(persisted.actions).toHaveLength(1);
    expect(persisted.actions[0].id).toBe(actionId);
    expect(persisted.actions[0].label).toBe("Updated label");
    expect(persisted.actions[0].effect.text).toBe("/updated-command");

    // Composer button should update (no duplicate, same id)
    await window.evaluate(async () => {
      const app = (window as PiAppWindow).piApp;
      if (!app) throw new Error("piApp unavailable");
      await app.setActiveView("chat");
    });
    await openNewThread(window);
    const actionButton = window.getByTestId(`chassis-action-${actionId}`);
    await expect(actionButton).toBeVisible({ timeout: 10_000 });
    await expect(actionButton).toContainText("Updated label");

    // No duplicate button — only one with this id
    const allButtons = window.locator(`[data-testid="chassis-action-${actionId}"]`);
    await expect(allButtons).toHaveCount(1);
  } finally {
    await harness.close();
  }
});

test("delete action: removed from list, state.json, and composer", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("chassis-manage-delete");
  await seedAgentDir(agentDir);

  // Pre-seed two actions
  const chassisDir = join(agentDir, "chassis");
  await mkdir(chassisDir, { recursive: true });
  await writeFile(
    join(chassisDir, "state.json"),
    JSON.stringify({
      actions: [
        { id: "keep-action", label: "Keep me", showLabel: true, trigger: "oneShot", effect: { type: "submit", text: "/keep" } },
        { id: "delete-action", label: "Delete me", showLabel: true, trigger: "oneShot", effect: { type: "submit", text: "/delete" } },
      ],
    }),
    "utf8",
  );

  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();

    // Navigate to Settings → Actions
    await navigateToSettingsActions(window);

    // Both rows should be visible
    await expect(window.getByTestId("chassis-action-row-keep-action")).toBeVisible({ timeout: 10_000 });
    await expect(window.getByTestId("chassis-action-row-delete-action")).toBeVisible({ timeout: 10_000 });

    // Delete the second action
    await window.getByTestId("chassis-action-delete-delete-action").click();

    // It should disappear from the list
    await expect(window.getByTestId("chassis-action-row-delete-action")).not.toBeVisible({ timeout: 10_000 });

    // The other action should still be there
    await expect(window.getByTestId("chassis-action-row-keep-action")).toBeVisible();

    // Persisted state.json should not contain the deleted action
    const persisted = await readPersistedActions(agentDir);
    expect(persisted.actions).toHaveLength(1);
    expect(persisted.actions[0].id).toBe("keep-action");

    // Composer: deleted button gone, kept button still there
    await window.evaluate(async () => {
      const app = (window as PiAppWindow).piApp;
      if (!app) throw new Error("piApp unavailable");
      await app.setActiveView("chat");
    });
    await openNewThread(window);
    await expect(window.getByTestId("chassis-action-keep-action")).toBeVisible({ timeout: 10_000 });
    await expect(window.getByTestId("chassis-action-delete-action")).not.toBeVisible();
  } finally {
    await harness.close();
  }
});

test("edit showLabel off: composer hides title, aria-label persists; on: title visible", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("chassis-manage-showlabel");
  await seedAgentDir(agentDir);

  // Pre-seed an action with showLabel=true
  const chassisDir = join(agentDir, "chassis");
  await mkdir(chassisDir, { recursive: true });
  const actionId = "showlabel-test";
  await writeFile(
    join(chassisDir, "state.json"),
    JSON.stringify({
      actions: [
        { id: actionId, label: "Visible Title", showLabel: true, trigger: "oneShot", effect: { type: "submit", text: "/test" } },
      ],
    }),
    "utf8",
  );

  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();

    // Check composer initially: showLabel=true → title text visible
    await openNewThread(window);
    const actionButton = window.getByTestId(`chassis-action-${actionId}`);
    await expect(actionButton).toBeVisible({ timeout: 10_000 });
    await expect(actionButton).toContainText("Visible Title");

    // Navigate to Settings → Actions and toggle showLabel off
    await navigateToSettingsActions(window);
    await window.getByTestId(`chassis-action-edit-${actionId}`).click();

    const showLabelCheckbox = window.getByTestId(`chassis-action-edit-showlabel-${actionId}`);
    await expect(showLabelCheckbox).toBeChecked();
    await showLabelCheckbox.uncheck();

    // Save
    await window.getByTestId(`chassis-action-save-${actionId}`).click();

    // Wait for save to complete (row should be back in display mode)
    await expect(window.getByTestId(`chassis-action-edit-${actionId}`)).toBeVisible({ timeout: 10_000 });

    // Persisted: showLabel=false
    const persistedOff = await readPersistedActions(agentDir);
    expect(persistedOff.actions[0].showLabel).toBe(false);

    // Composer: title text should be hidden, but aria-label still present
    await window.evaluate(async () => {
      const app = (window as PiAppWindow).piApp;
      if (!app) throw new Error("piApp unavailable");
      await app.setActiveView("chat");
    });
    await openNewThread(window);
    const composerButton = window.getByTestId(`chassis-action-${actionId}`);
    await expect(composerButton).toBeVisible({ timeout: 10_000 });
    await expect(composerButton).toHaveAttribute("aria-label", "Visible Title");
    // Caption span should NOT be rendered in DOM when showLabel=false
    await expect(composerButton.locator(".devbtn__caption")).toHaveCount(0);

    // Now toggle showLabel back on
    await window.evaluate(async () => {
      const app = (window as PiAppWindow).piApp;
      if (!app) throw new Error("piApp unavailable");
      await app.setActiveView("settings");
    });
    await window.getByRole("button", { name: "Actions", exact: true }).click();
    await expect(window.getByTestId("chassis-action-label-input")).toBeVisible({ timeout: 10_000 });

    await window.getByTestId(`chassis-action-edit-${actionId}`).click();
    const showLabelCheckboxOn = window.getByTestId(`chassis-action-edit-showlabel-${actionId}`);
    await expect(showLabelCheckboxOn).not.toBeChecked();
    await showLabelCheckboxOn.check();
    await window.getByTestId(`chassis-action-save-${actionId}`).click();

    // Wait for save
    await expect(window.getByTestId(`chassis-action-edit-${actionId}`)).toBeVisible({ timeout: 10_000 });

    // Persisted: showLabel=true
    const persistedOn = await readPersistedActions(agentDir);
    expect(persistedOn.actions[0].showLabel).toBe(true);

    // Composer: title text visible again
    await window.evaluate(async () => {
      const app = (window as PiAppWindow).piApp;
      if (!app) throw new Error("piApp unavailable");
      await app.setActiveView("chat");
    });
    await openNewThread(window);
    const composerButtonOn = window.getByTestId(`chassis-action-${actionId}`);
    await expect(composerButtonOn).toBeVisible({ timeout: 10_000 });
    // Caption span is rendered in DOM when showLabel=true (CSS may hide it in modular mode,
    // but the element's existence is the semantic signal)
    await expect(composerButtonOn.locator(".devbtn__caption")).toHaveCount(1);
    await expect(composerButtonOn.locator(".devbtn__caption")).toHaveText("Visible Title");
  } finally {
    await harness.close();
  }
});

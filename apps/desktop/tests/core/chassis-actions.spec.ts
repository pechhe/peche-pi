import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { launchDesktop, makeUserDataDir, makeWorkspace, openNewThread, seedAgentDir } from "../helpers/electron-app";
import type { PiAppWindow } from "../helpers/electron-app";

test("persists chassis actions to disk and survives app restart", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("chassis-actions-workspace");
  await seedAgentDir(agentDir);

  // Pre-seed a chassis action
  const chassisDir = join(agentDir, "chassis");
  await mkdir(chassisDir, { recursive: true });
  const actionId = "security-scan-1";
  await writeFile(
    join(chassisDir, "state.json"),
    JSON.stringify({
      version: 2,
      folders: {
        [workspacePath]: {
          actions: [
            { id: actionId, label: "Security audit", showLabel: true, trigger: "oneShot", effect: { type: "submit", text: "/security-scan" } },
          ],
          activeStickyId: null,
        },
      },
    }),
    "utf8",
  );

  // First run: verify the action loads and renders
  const firstRun = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await firstRun.firstWindow();

    // Verify the action is available via IPC
    const actions = await window.evaluate(async (folderPath) => {
      const app = (window as PiAppWindow).piApp;
      if (!app) throw new Error("piApp unavailable");
      return (await app.getChassisFolder(folderPath)).actions;
    }, workspacePath);
    expect(actions).toHaveLength(1);
    expect(actions[0].label).toBe("Security audit");

    // Verify the action button renders on the new-thread surface
    await openNewThread(window);
    const actionButton = window.getByTestId(`chassis-action-${actionId}`);
    await expect(actionButton).toBeVisible({ timeout: 10_000 });
    await expect(actionButton).toContainText("Security audit");
  } finally {
    await firstRun.close();
  }

  // Second run: restart the app and verify the action survived
  const secondRun = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await secondRun.firstWindow();

    // Verify the action survived restart via IPC
    const persistedActions = await window.evaluate(async (folderPath) => {
      const app = (window as PiAppWindow).piApp;
      if (!app) throw new Error("piApp unavailable");
      return (await app.getChassisFolder(folderPath)).actions;
    }, workspacePath);
    expect(persistedActions).toHaveLength(1);
    expect(persistedActions[0].label).toBe("Security audit");
    expect(persistedActions[0].effect.text).toBe("/security-scan");

    // Verify the action button renders on the new-thread surface
    await openNewThread(window);
    const actionButton = window.getByTestId(`chassis-action-${actionId}`);
    await expect(actionButton).toBeVisible({ timeout: 10_000 });
  } finally {
    await secondRun.close();
  }
});

test("settings actions section renders and allows creating an action", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("chassis-settings-workspace");
  await seedAgentDir(agentDir);

  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();

    // Open Settings via IPC
    await window.evaluate(async () => {
      const app = (window as PiAppWindow).piApp;
      if (!app) throw new Error("piApp unavailable");
      await app.setActiveView("settings");
    });

    // Navigate to Actions section
    await window.getByRole("button", { name: "Actions", exact: true }).click();
    await expect(window.getByTestId("settings-actions-section")).toBeVisible({ timeout: 10_000 });

    // Fill in the create form and submit
    await window.getByTestId("chassis-action-label-input").fill("Security audit");
    await window.getByTestId("chassis-action-payload-input").fill("/security-scan");
    await expect(window.getByTestId("chassis-action-showlabel")).toBeChecked();
    await window.getByTestId("chassis-action-create").click();

    // Verify the action row appears
    const actionRow = window.locator("[data-testid^='chassis-action-row-']");
    await expect(actionRow).toHaveCount(1, { timeout: 10_000 });
    await expect(actionRow.first()).toContainText("Security audit");
    await expect(actionRow.first()).toContainText("/security-scan");
  } finally {
    await harness.close();
  }
});

test("action button renders on new-thread surface", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("chassis-surfaces-workspace");
  await seedAgentDir(agentDir);

  // Pre-seed a chassis action
  const chassisDir = join(agentDir, "chassis");
  await mkdir(chassisDir, { recursive: true });
  await writeFile(
    join(chassisDir, "state.json"),
    JSON.stringify({
      version: 2,
      folders: {
        [workspacePath]: {
          actions: [
            { id: "test-action-1", label: "Test action", showLabel: true, trigger: "oneShot", effect: { type: "submit", text: "/test" } },
          ],
          activeStickyId: null,
        },
      },
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

    // New-thread surface: action button should be visible
    await openNewThread(window);
    const actionButton = window.getByTestId("chassis-action-test-action-1");
    await expect(actionButton).toBeVisible({ timeout: 10_000 });
    await expect(actionButton).toContainText("Test action");
  } finally {
    await harness.close();
  }
});

test("malformed chassis/state.json is gracefully handled", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("chassis-malformed-workspace");
  await seedAgentDir(agentDir);

  // Pre-seed a malformed chassis state (mix of valid and invalid entries)
  const chassisDir = join(agentDir, "chassis");
  await mkdir(chassisDir, { recursive: true });
  await writeFile(
    join(chassisDir, "state.json"),
    JSON.stringify({
      version: 2,
      folders: {
        [workspacePath]: {
          actions: [
            { id: "valid-1", label: "Valid", showLabel: true, trigger: "oneShot", effect: { type: "submit", text: "/valid" } },
            { label: "No id", trigger: "oneShot", effect: { type: "submit", text: "/bad" } },
            { id: "bad-trigger", label: "Bad trigger", trigger: "sticky", effect: { type: "submit", text: "/bad" } },
            "not-an-object",
          ],
          activeStickyId: null,
        },
      },
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

    // The valid action should render, malformed ones should be dropped
    await openNewThread(window);
    const actionButton = window.getByTestId("chassis-action-valid-1");
    await expect(actionButton).toBeVisible({ timeout: 10_000 });

    // Only the valid action should render (1 button, not 4)
    const allActionButtons = window.locator("[data-testid^='chassis-action-']");
    await expect(allActionButtons).toHaveCount(1);

    // Composer should still work — type and see the input reflected
    const composer = window.getByTestId("new-thread-composer");
    await composer.fill("Hello world");
    await expect(composer).toHaveValue("Hello world");
  } finally {
    await harness.close();
  }
});

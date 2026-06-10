import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { createNamedThread, launchDesktop, makeUserDataDir, makeWorkspace, seedAgentDir } from "../helpers/electron-app";
import type { PiAppWindow } from "../helpers/electron-app";

test("command picker lists seeded skill and fills payload on select", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("picker-workspace");
  await seedAgentDir(agentDir);

  // Seed a skill so a runtime command exists
  await mkdir(join(workspacePath, ".agents", "skills", "demo-skill"), { recursive: true });
  await writeFile(
    join(workspacePath, ".agents", "skills", "demo-skill", "SKILL.md"),
    `# Demo Skill\n\nUse this skill when the user wants a short demo workflow.\n\n## Workflow\n\n1. Inspect the repo.\n2. Summarize.\n`,
    "utf8",
  );

  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();

    // Create a thread to ensure the runtime loads and discovers skills
    await createNamedThread(window, "Picker test session");

    // Open Settings → Actions
    await window.evaluate(async () => {
      const app = (window as PiAppWindow).piApp;
      if (!app) throw new Error("piApp unavailable");
      await app.setActiveView("settings");
    });
    await window.getByRole("button", { name: "Actions", exact: true }).click();
    await expect(window.getByTestId("settings-actions-section")).toBeVisible({ timeout: 10_000 });

    // The command picker should be visible (trigger defaults to oneShot)
    const picker = window.getByTestId("chassis-action-command-picker");
    await expect(picker).toBeVisible({ timeout: 5_000 });

    // It should contain the seeded skill command — select by value
    await picker.selectOption("/skill:demo-skill");

    // Payload input should be populated with the slash text
    const payloadInput = window.getByTestId("chassis-action-payload-input");
    await expect(payloadInput).toHaveValue("/skill:demo-skill");

    // Fill label and create the action
    await window.getByTestId("chassis-action-label-input").fill("Run demo");
    await window.getByTestId("chassis-action-create").click();

    // Action row should appear
    const actionRow = window.locator("[data-testid^='chassis-action-row-']");
    await expect(actionRow).toHaveCount(1, { timeout: 10_000 });
    await expect(actionRow.first()).toContainText("Run demo");

    // Verify persisted payload in state.json
    const stateRaw = await readFile(join(agentDir, "chassis", "state.json"), "utf8");
    const state = JSON.parse(stateRaw).folders[workspacePath];
    expect(state.actions).toHaveLength(1);
    expect(state.actions[0].effect.text).toBe("/skill:demo-skill");
    expect(state.actions[0].label).toBe("Run demo");
  } finally {
    await harness.close();
  }
});

test("free-text payload still works without using the picker", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("picker-freetext-workspace");
  await seedAgentDir(agentDir);

  // Seed a skill so picker would be available
  await mkdir(join(workspacePath, ".agents", "skills", "another-skill"), { recursive: true });
  await writeFile(
    join(workspacePath, ".agents", "skills", "another-skill", "SKILL.md"),
    `# Another Skill\n\nUse this skill for testing.\n`,
    "utf8",
  );

  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();

    // Create a thread to ensure the runtime loads
    await createNamedThread(window, "Free-text test session");

    // Open Settings → Actions
    await window.evaluate(async () => {
      const app = (window as PiAppWindow).piApp;
      if (!app) throw new Error("piApp unavailable");
      await app.setActiveView("settings");
    });
    await window.getByRole("button", { name: "Actions", exact: true }).click();
    await expect(window.getByTestId("settings-actions-section")).toBeVisible({ timeout: 10_000 });

    // Type free text directly into payload without using picker
    await window.getByTestId("chassis-action-label-input").fill("Custom command");
    await window.getByTestId("chassis-action-payload-input").fill("/custom-slash foo bar");

    // The picker should still have empty value (not interfered with)
    const picker = window.getByTestId("chassis-action-command-picker");
    await expect(picker).toHaveValue("");

    // Create the action
    await window.getByTestId("chassis-action-create").click();

    // Action row should appear
    const actionRow = window.locator("[data-testid^='chassis-action-row-']");
    await expect(actionRow).toHaveCount(1, { timeout: 10_000 });
    await expect(actionRow.first()).toContainText("Custom command");

    // Verify persisted payload
    const stateRaw = await readFile(join(agentDir, "chassis", "state.json"), "utf8");
    const state = JSON.parse(stateRaw).folders[workspacePath];
    expect(state.actions).toHaveLength(1);
    expect(state.actions[0].effect.text).toBe("/custom-slash foo bar");
    expect(state.actions[0].label).toBe("Custom command");
  } finally {
    await harness.close();
  }
});

test("picker is hidden when trigger is sticky wrap", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("picker-sticky-workspace");
  await seedAgentDir(agentDir);

  await mkdir(join(workspacePath, ".agents", "skills", "test-skill"), { recursive: true });
  await writeFile(
    join(workspacePath, ".agents", "skills", "test-skill", "SKILL.md"),
    `# Test Skill\n\nUse this skill for testing.\n`,
    "utf8",
  );

  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();

    // Create a thread to ensure the runtime loads
    await createNamedThread(window, "Sticky test session");

    await window.evaluate(async () => {
      const app = (window as PiAppWindow).piApp;
      if (!app) throw new Error("piApp unavailable");
      await app.setActiveView("settings");
    });
    await window.getByRole("button", { name: "Actions", exact: true }).click();
    await expect(window.getByTestId("settings-actions-section")).toBeVisible({ timeout: 10_000 });

    // Picker should be visible for oneShot (default)
    const picker = window.getByTestId("chassis-action-command-picker");
    await expect(picker).toBeVisible({ timeout: 5_000 });

    // Switch to sticky wrap
    await window.getByTestId("chassis-action-trigger").selectOption("sticky");

    // Picker should be hidden
    await expect(picker).toBeHidden();
  } finally {
    await harness.close();
  }
});

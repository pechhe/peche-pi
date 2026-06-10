import { writeFile, mkdir, readFile } from "node:fs/promises";
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

test("settings form allows creating a sticky/reminder action (no {{input}} required)", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("chassis-reminder-create");
  await seedAgentDir(agentDir);

  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();

    // Open Settings → Actions
    await window.evaluate(async () => {
      const app = (window as PiAppWindow).piApp;
      if (!app) throw new Error("piApp unavailable");
      await app.setActiveView("settings");
    });
    await window.getByRole("button", { name: "Actions", exact: true }).click();
    await expect(window.getByTestId("chassis-action-trigger")).toBeVisible({ timeout: 10_000 });

    // Select "Sticky reminder" trigger
    await window.getByTestId("chassis-action-trigger").selectOption("sticky-reminder");

    // Fill label + plain text (no {{input}} needed)
    await window.getByTestId("chassis-action-label-input").fill("Standing rule");
    await window.getByTestId("chassis-action-payload-input").fill("Always write tests first.");
    await window.getByTestId("chassis-action-create").click();

    // Verify the action row appears
    const actionRow = window.locator("[data-testid^='chassis-action-row-']");
    await expect(actionRow).toHaveCount(1, { timeout: 10_000 });
    await expect(actionRow.first()).toContainText("Standing rule");

    // Verify persisted to disk as reminder effect
    const stateRaw = await readFile(join(agentDir, "chassis", "state.json"), "utf8");
    const state = JSON.parse(stateRaw);
    const folderState = state.folders[workspacePath];
    expect(folderState).toBeDefined();
    expect(folderState.actions).toHaveLength(1);
    expect(folderState.actions[0].effect.type).toBe("reminder");
    expect(folderState.actions[0].effect.text).toBe("Always write tests first.");
  } finally {
    await harness.close();
  }
});

test("sticky reminder action renders as a toggle switch (same as wrap)", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("chassis-reminder-toggle");
  await seedAgentDir(agentDir);

  const chassisDir = join(agentDir, "chassis");
  await mkdir(chassisDir, { recursive: true });
  await writeFile(
    join(chassisDir, "state.json"),
    JSON.stringify({
      version: 2,
      folders: {
        [workspacePath]: {
          actions: [
            {
              id: "remind-tdd",
              label: "TDD",
              showLabel: true,
              trigger: "sticky",
              effect: { type: "reminder", text: "Always write tests first." },
            },
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
    await openNewThread(window);

    // The toggle button should be visible
    const toggle = window.getByTestId("chassis-action-remind-tdd");
    await expect(toggle).toBeVisible({ timeout: 10_000 });
    await expect(toggle).toHaveAttribute("role", "switch");

    // Initially unchecked
    await expect(toggle).toHaveAttribute("aria-checked", "false");

    // Toggle ON
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");

    // Toggle OFF
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
  } finally {
    await harness.close();
  }
});

test("reminder payload placeholder differs from wrap placeholder", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("chassis-reminder-placeholder");
  await seedAgentDir(agentDir);

  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();

    await window.evaluate(async () => {
      const app = (window as PiAppWindow).piApp;
      if (!app) throw new Error("piApp unavailable");
      await app.setActiveView("settings");
    });
    await window.getByRole("button", { name: "Actions", exact: true }).click();
    await expect(window.getByTestId("chassis-action-trigger")).toBeVisible({ timeout: 10_000 });

    // Select sticky wrap — placeholder should mention {{input}}
    await window.getByTestId("chassis-action-trigger").selectOption("sticky");
    const wrapPlaceholder = await window.getByTestId("chassis-action-payload-input").getAttribute("placeholder");
    expect(wrapPlaceholder).toContain("{{input}}");

    // Select sticky reminder — placeholder should be "Reminder text"
    await window.getByTestId("chassis-action-trigger").selectOption("sticky-reminder");
    const reminderPlaceholder = await window.getByTestId("chassis-action-payload-input").getAttribute("placeholder");
    expect(reminderPlaceholder).toBe("Reminder text");
  } finally {
    await harness.close();
  }
});

// NOTE: The actual injection-at-session-start test is skipped because it
// requires a real API key to verify the reminder message appears in LLM
// context. The extension logic is covered by unit tests in
// extensions/chassis-reminder.test.ts.
test.skip("reminder text is injected at session start (needs keyed env)", async () => {
  // This test would:
  // 1. Seed chassis state with an active reminder for the workspace
  // 2. Launch desktop, start a thread
  // 3. Verify the reminder text appears in the session messages as
  //    customType: "chassis-reminder"
  // Requires: real API key so the agent can process the prompt.
});

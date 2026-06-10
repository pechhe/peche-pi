import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  openNewThread,
  seedAgentDir,
  startThreadViaIpc,
  type PiAppWindow,
} from "../helpers/electron-app";

test("sticky wrap action renders as a toggle", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("chassis-sticky-render");
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
              id: "wrap-explain",
              label: "Explain",
              showLabel: true,
              trigger: "sticky",
              effect: { type: "wrap", template: "Explain step by step:\n{{input}}" },
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
    const toggle = window.getByTestId("chassis-action-wrap-explain");
    await expect(toggle).toBeVisible({ timeout: 10_000 });

    // Should be a switch role
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

test("sticky activation is app-global across threads", async () => {
  test.setTimeout(120_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("chassis-sticky-global");
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
              id: "wrap-explain",
              label: "Explain",
              showLabel: true,
              trigger: "sticky",
              effect: { type: "wrap", template: "Explain:\n{{input}}" },
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

    // Toggle ON on the new-thread surface
    const toggle = window.getByTestId("chassis-action-wrap-explain");
    await expect(toggle).toBeVisible({ timeout: 10_000 });
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");

    // Start a thread
    await startThreadViaIpc(window, { prompt: "Hello world" });
    const composer = window.getByTestId("composer");
    await expect(composer).toBeVisible({ timeout: 15_000 });

    // The toggle should still be ON in the in-thread composer (app-global state)
    const inThreadToggle = window.getByTestId("chassis-action-wrap-explain");
    await expect(inThreadToggle).toBeVisible({ timeout: 10_000 });
    await expect(inThreadToggle).toHaveAttribute("aria-checked", "true");
  } finally {
    await harness.close();
  }
});

test("only one sticky wrap can be active at a time", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("chassis-sticky-single");
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
              id: "wrap-explain",
              label: "Explain",
              showLabel: true,
              trigger: "sticky",
              effect: { type: "wrap", template: "Explain:\n{{input}}" },
            },
            {
              id: "wrap-review",
              label: "Review",
              showLabel: true,
              trigger: "sticky",
              effect: { type: "wrap", template: "Review this:\n{{input}}" },
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

    const explainToggle = window.getByTestId("chassis-action-wrap-explain");
    const reviewToggle = window.getByTestId("chassis-action-wrap-review");

    await expect(explainToggle).toBeVisible({ timeout: 10_000 });
    await expect(reviewToggle).toBeVisible({ timeout: 10_000 });

    // Enable Explain
    await explainToggle.click();
    await expect(explainToggle).toHaveAttribute("aria-checked", "true");
    await expect(reviewToggle).toHaveAttribute("aria-checked", "false");

    // Enable Review — should turn off Explain
    await reviewToggle.click();
    await expect(reviewToggle).toHaveAttribute("aria-checked", "true");
    await expect(explainToggle).toHaveAttribute("aria-checked", "false");

    // Toggle Review off
    await reviewToggle.click();
    await expect(reviewToggle).toHaveAttribute("aria-checked", "false");
    await expect(explainToggle).toHaveAttribute("aria-checked", "false");
  } finally {
    await harness.close();
  }
});

test("settings form allows creating a sticky/wrap action with trigger selector", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("chassis-sticky-settings");
  await seedAgentDir(agentDir);

  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();

    // Open Settings
    await window.evaluate(async () => {
      const app = (window as PiAppWindow).piApp;
      if (!app) throw new Error("piApp unavailable");
      await app.setActiveView("settings");
    });

    // Navigate to Actions section
    await window.getByRole("button", { name: "Actions", exact: true }).click();
    await expect(window.getByTestId("chassis-action-trigger")).toBeVisible({ timeout: 10_000 });

    // Select sticky trigger
    await window.getByTestId("chassis-action-trigger").selectOption("sticky");

    // Fill in label and template (with {{input}})
    await window.getByTestId("chassis-action-label-input").fill("Explain");
    await window.getByTestId("chassis-action-payload-input").fill("Explain step by step:\n{{input}}");
    await window.getByTestId("chassis-action-create").click();

    // Verify the action row appears
    const actionRow = window.locator("[data-testid^='chassis-action-row-']");
    await expect(actionRow).toHaveCount(1, { timeout: 10_000 });
    await expect(actionRow.first()).toContainText("Explain");
  } finally {
    await harness.close();
  }
});

test("settings form rejects wrap template without {{input}}", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("chassis-sticky-validate");
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

    // Select sticky trigger
    await window.getByTestId("chassis-action-trigger").selectOption("sticky");

    // Fill in template WITHOUT {{input}}
    await window.getByTestId("chassis-action-label-input").fill("Bad template");
    await window.getByTestId("chassis-action-payload-input").fill("This has no input token");
    await window.getByTestId("chassis-action-create").click();

    // Should show validation error
    await expect(window.getByTestId("chassis-action-template-error")).toBeVisible({ timeout: 5_000 });
    await expect(window.getByTestId("chassis-action-template-error")).toContainText("{{input}}");

    // No action should have been created
    const actionRow = window.locator("[data-testid^='chassis-action-row-']");
    await expect(actionRow).toHaveCount(0);
  } finally {
    await harness.close();
  }
});

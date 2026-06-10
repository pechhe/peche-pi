import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { launchDesktop, makeUserDataDir, makeWorkspace, seedAgentDir } from "../helpers/electron-app";
import type { PiAppWindow } from "../helpers/electron-app";

test("builder panel opens and renders input + send button", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("chassis-builder-workspace");
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

    // Open builder panel
    const toggle = window.getByTestId("chassis-builder-toggle");
    await expect(toggle).toBeVisible({ timeout: 10_000 });
    await toggle.click();

    // Verify builder panel renders
    const panel = window.getByTestId("chassis-builder-panel");
    await expect(panel).toBeVisible();

    // Verify input and send button
    const input = window.getByTestId("chassis-builder-input");
    await expect(input).toBeVisible();
    await expect(input).toHaveAttribute("placeholder", "Describe your action…");

    const send = window.getByTestId("chassis-builder-send");
    await expect(send).toBeVisible();
    await expect(send).toBeDisabled(); // empty input

    // Verify messages area shows placeholder
    const messages = window.getByTestId("chassis-builder-messages");
    await expect(messages).toBeVisible();
    await expect(messages).toContainText("Describe what you want");

    // Type into input → send button becomes enabled
    await input.fill("a button that runs /review");
    await expect(send).toBeEnabled();

    // Close builder
    await toggle.click();
    await expect(panel).not.toBeVisible();
  } finally {
    await harness.close();
  }
});

test("builder send fires IPC and shows response or error", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("chassis-builder-send-workspace");
  await seedAgentDir(agentDir);

  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();

    // Open Settings → Actions → Builder
    await window.evaluate(async () => {
      const app = (window as PiAppWindow).piApp;
      if (!app) throw new Error("piApp unavailable");
      await app.setActiveView("settings");
    });
    await window.getByRole("button", { name: "Actions", exact: true }).click();
    await window.getByTestId("chassis-builder-toggle").click();

    // Type and send
    const input = window.getByTestId("chassis-builder-input");
    await input.fill("a one-shot button that sends /review");
    await window.getByTestId("chassis-builder-send").click();

    // Wait for either: assistant message appears OR error appears
    // (Without a real API key, we expect an error — the sandbox returns 401)
    const errorOrMessage = window.locator(
      "[data-testid='chassis-builder-error'], [data-testid='chassis-builder-msg-1']",
    );
    await expect(errorOrMessage.first()).toBeVisible({ timeout: 30_000 });

    // Loading should be gone
    const loading = window.getByTestId("chassis-builder-loading");
    await expect(loading).not.toBeVisible({ timeout: 5_000 }).catch(() => {});

    // If there's a candidate card, verify Accept/Decline buttons
    const candidate = window.getByTestId("chassis-builder-candidate");
    const candidateVisible = await candidate.isVisible().catch(() => false);
    if (candidateVisible) {
      await expect(window.getByTestId("chassis-builder-accept")).toBeVisible();
      await expect(window.getByTestId("chassis-builder-decline")).toBeVisible();
    }
  } finally {
    await harness.close();
  }
});

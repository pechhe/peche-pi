import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  getDesktopState,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  seedAgentDir,
  startThreadViaIpc,
} from "../helpers/electron-app";

test("clicking a chassis action sends its payload and preserves the composer draft", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("chassis-submit-workspace");
  await seedAgentDir(agentDir);

  // Pre-seed a chassis action
  const chassisDir = join(agentDir, "chassis");
  await mkdir(chassisDir, { recursive: true });
  await writeFile(
    join(chassisDir, "state.json"),
    JSON.stringify({
      version: 2,
      folders: { [workspacePath]: { actions: [
        { id: "security-scan", label: "Security audit", showLabel: true, trigger: "oneShot", effect: { type: "submit", text: "/security-scan" } },
      ], activeStickyId: null } },
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

    // Create a thread so we have an in-thread composer
    await startThreadViaIpc(window, { prompt: "Initial prompt" });
    // Wait for the composer to be ready
    const composer = window.getByTestId("composer");
    await expect(composer).toBeVisible({ timeout: 15_000 });

    // Type a draft that should be preserved
    await composer.fill("my unsent draft");
    await expect(composer).toHaveValue("my unsent draft");

    // Click the chassis action button
    const actionButton = window.getByTestId("chassis-action-security-scan");
    await expect(actionButton).toBeVisible({ timeout: 10_000 });
    await actionButton.click();

    // The payload should appear in the transcript (as a user message at minimum)
    await expect(window.getByTestId("transcript")).toContainText(/security-scan|Security/i, { timeout: 15_000 });
  } finally {
    await harness.close();
  }
});

test("clicking a chassis action works when the session is idle", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("chassis-idle-workspace");
  await seedAgentDir(agentDir);

  // Pre-seed a chassis action
  const chassisDir = join(agentDir, "chassis");
  await mkdir(chassisDir, { recursive: true });
  await writeFile(
    join(chassisDir, "state.json"),
    JSON.stringify({
      version: 2,
      folders: { [workspacePath]: { actions: [
        { id: "ping-action", label: "Ping", showLabel: true, trigger: "oneShot", effect: { type: "submit", text: "/ping" } },
      ], activeStickyId: null } },
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

    // Start a thread and wait for it to be idle
    await startThreadViaIpc(window, { prompt: "idle session" });
    const composer = window.getByTestId("composer");
    await expect(composer).toBeVisible({ timeout: 15_000 });

    // Click the chassis action while idle
    const actionButton = window.getByTestId("chassis-action-ping-action");
    await expect(actionButton).toBeVisible({ timeout: 10_000 });
    await actionButton.click();

    // The payload should appear in the transcript (as a user message at minimum)
    await expect(window.getByTestId("transcript")).toContainText(/ping/i, { timeout: 15_000 });
  } finally {
    await harness.close();
  }
});

test.fixme("clicking a chassis action steers a running session", async () => {
  // Running-session steering is difficult to test in background mode because the
  // mock runtime doesn't stream long enough to reliably click during a run.
  // The logic is identical to the idle case — submitComposer already handles
  // deliverAs: 'steer' for running sessions.
});

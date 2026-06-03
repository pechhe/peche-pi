import { expect, test } from "@playwright/test";
import { join } from "node:path";
import {
  clickSession,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  seedAgentDir,
  seedBranchedTreeSessionFixture,
  seedToolResultTreeSessionFixture,
} from "../helpers/electron-app";

test("transcript loads on the first thread click after app launch", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("first-load-workspace");
  await seedAgentDir(agentDir);
  // Seed two sessions so the sidebar has multiple threads.
  await seedToolResultTreeSessionFixture(agentDir, workspacePath);
  await seedBranchedTreeSessionFixture(agentDir, workspacePath);

  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    // First click on a thread right after launch.
    await clickSession(window, "Tree fixture session");
    await expect(window.locator(".topbar__session")).toHaveText("Tree fixture session");
    // The transcript must populate WITHOUT switching away and back.
    await expect(window.getByTestId("transcript")).toContainText("Beta answer", { timeout: 8_000 });
  } finally {
    await harness.close();
  }
});

test("restored session shows its transcript immediately on relaunch", async () => {
  test.setTimeout(120_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("restored-self-workspace");
  await seedAgentDir(agentDir);
  await seedToolResultTreeSessionFixture(agentDir, workspacePath);
  await seedBranchedTreeSessionFixture(agentDir, workspacePath);

  const first = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });
  try {
    const window = await first.firstWindow();
    await clickSession(window, "Tree fixture session");
    await expect(window.locator(".topbar__session")).toHaveText("Tree fixture session");
    await expect(window.getByTestId("transcript")).toContainText("Beta answer", { timeout: 8_000 });
    await window.waitForTimeout(1_500);
  } finally {
    await first.close();
  }

  // Relaunch: "Tree fixture session" is the restored selection. Its transcript
  // must appear WITHOUT any thread switch.
  const second = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });
  try {
    const window = await second.firstWindow();
    await expect(window.locator(".topbar__session")).toHaveText("Tree fixture session", { timeout: 10_000 });
    await expect(window.getByTestId("transcript")).toContainText("Beta answer", { timeout: 8_000 });
  } finally {
    await second.close();
  }
});

test("transcript loads when clicking a thread after a session was restored on launch", async () => {
  test.setTimeout(120_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("restored-load-workspace");
  await seedAgentDir(agentDir);
  await seedToolResultTreeSessionFixture(agentDir, workspacePath);
  await seedBranchedTreeSessionFixture(agentDir, workspacePath);

  // First launch: select "Tree tool fixture session" so it is persisted as the
  // restored selection for the next launch.
  const first = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });
  try {
    const window = await first.firstWindow();
    await clickSession(window, "Tree tool fixture session");
    await expect(window.locator(".topbar__session")).toHaveText("Tree tool fixture session");
    await expect(window.getByTestId("transcript")).toContainText("README inspected", { timeout: 8_000 });
    // Give persistUiState (debounced) time to flush.
    await window.waitForTimeout(1_500);
  } finally {
    await first.close();
  }

  // Second launch: "Tree tool fixture session" is restored. Click the OTHER
  // thread as the very first interaction.
  const second = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });
  try {
    const window = await second.firstWindow();
    await clickSession(window, "Tree fixture session");
    await expect(window.locator(".topbar__session")).toHaveText("Tree fixture session");
    await expect(window.getByTestId("transcript")).toContainText("Beta answer", { timeout: 8_000 });
  } finally {
    await second.close();
  }
});

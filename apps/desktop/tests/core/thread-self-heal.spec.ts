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

// Simulate the real-world failure mode: the renderer ends up with a selected
// session but no transcript in state (e.g. a main-side publish fired before the
// renderer's IPC listener was attached, so it was dropped). The self-heal
// effect must re-request the transcript and clear the stuck loading bar without
// the user switching threads.
test("recovers a stuck transcript by self-healing instead of staying on the loading bar", async () => {
  test.setTimeout(120_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("self-heal-workspace");
  await seedAgentDir(agentDir);
  await seedToolResultTreeSessionFixture(agentDir, workspacePath);
  await seedBranchedTreeSessionFixture(agentDir, workspacePath);

  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();

    // Simulate the real failure mode: the push subscription never delivers a
    // transcript (publish dropped because it raced the listener attach). The
    // ONLY recovery path left is the self-heal effect, which pulls via
    // getSelectedTranscript(). Install the sabotage, then reload so the App
    // mounts with the broken subscription.
    await window.addInitScript(() => {
      const tryPatch = () => {
        const api = (window as unknown as { piApp?: Record<string, unknown> }).piApp;
        if (!api) {
          setTimeout(tryPatch, 0);
          return;
        }
        // Subscription becomes a no-op: never forwards payloads to the renderer.
        api.onSelectedTranscriptChanged = () => () => undefined;
      };
      tryPatch();
    });
    await window.reload();
    await window.waitForFunction(() => Boolean((window as { piApp?: unknown }).piApp), undefined, {
      timeout: 15_000,
    });

    await clickSession(window, "Tree fixture session");
    await expect(window.locator(".topbar__session")).toHaveText("Tree fixture session", { timeout: 10_000 });
    // With the push subscription sabotaged, only self-heal can populate this.
    await expect(window.getByTestId("transcript")).toContainText("Beta answer", { timeout: 8_000 });
    // Loading bar must finish (element removed after finishing animation).
    await expect(window.getByTestId("transcript-loading-bar")).toHaveCount(0, { timeout: 8_000 });
  } finally {
    await harness.close();
  }
});

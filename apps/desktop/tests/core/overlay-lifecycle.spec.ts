import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { launchDesktop, makeUserDataDir, makeWorkspace, createNamedThread, seedAgentDir, type PiAppWindow } from "../helpers/electron-app";
import {
  computeOverlayBounds,
  type OverlayRect,
} from "../../electron/overlay-window-manager";

/**
 * Overlay Lifecycle (issue #21) on the real Electron surface.
 *
 * Proves the overlay BrowserWindow opens via IPC, is always-on-top and
 * positioned bottom-centre, is single-instance, renders the overlay route
 * placeholder, and closes via IPC.
 */

async function overlayWindowCount(electronApp: import("@playwright/test").ElectronApplication): Promise<number> {
  return electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
}

test("overlay opens always-on-top at bottom-centre, is single-instance, and closes via IPC", async () => {
  const userDataDir = await makeUserDataDir();
  const harness = await launchDesktop(userDataDir, { testMode: "background" });

  try {
    const window = await harness.firstWindow();
    expect(await overlayWindowCount(harness.electronApp)).toBe(1);

    // Open the overlay via the shared IPC bridge.
    await window.evaluate(() => (window as PiAppWindow).piApp!.openOverlay());

    await expect.poll(() => overlayWindowCount(harness.electronApp), { timeout: 10_000 }).toBe(2);

    // Inspect the overlay window's config + geometry from the main process.
    const readOverlay = () =>
      harness.electronApp.evaluate(({ BrowserWindow, screen }) => {
        const overlayWin = BrowserWindow.getAllWindows().find((w) =>
          w.webContents.getURL().includes("#overlay"),
        );
        if (!overlayWin) return null;
        return {
          alwaysOnTop: overlayWin.isAlwaysOnTop(),
          bounds: overlayWin.getBounds(),
          workArea: screen.getPrimaryDisplay().workArea,
        };
      });
    await expect.poll(async () => (await readOverlay()) !== null, { timeout: 10_000 }).toBe(true);
    const overlay = (await readOverlay())!;
    expect(overlay.alwaysOnTop).toBe(true);
    const expected = computeOverlayBounds(overlay.workArea as OverlayRect);
    expect(overlay.bounds.x).toBe(expected.x);
    expect(overlay.bounds.y).toBe(expected.y);
    expect(overlay.bounds.width).toBe(expected.width);
    expect(overlay.bounds.height).toBe(expected.height);

    // The overlay route renders the placeholder, not the main App.
    const overlayPage = harness.electronApp
      .windows()
      .find((p) => p.url().includes("#overlay"));
    expect(overlayPage, "overlay page exists").toBeTruthy();
    await expect(overlayPage!.getByTestId("overlay-root")).toContainText("No active thread");

    // Single-instance: a second open does not create another window.
    await window.evaluate(() => (window as PiAppWindow).piApp!.openOverlay());
    await window.waitForTimeout(300);
    expect(await overlayWindowCount(harness.electronApp)).toBe(2);

    // Close via IPC returns to a single window.
    await window.evaluate(() => (window as PiAppWindow).piApp!.closeOverlay());
    await expect.poll(() => overlayWindowCount(harness.electronApp), { timeout: 10_000 }).toBe(1);
  } finally {
    await harness.close();
  }
});

test("overlay renders the SessionComposer when a session exists (#22)", async () => {
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("overlay-ws");
  const agentDir = join(userDataDir, "agent");
  await seedAgentDir(agentDir);
  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();

    // Seed a session via the shared IPC bridge.
    await createNamedThread(window, "overlay-thread");

    // Open the overlay.
    await window.evaluate(() => (window as PiAppWindow).piApp!.openOverlay());
    await expect.poll(() => overlayWindowCount(harness.electronApp), { timeout: 10_000 }).toBe(2);

    // Wait for the overlay page to appear.
    let overlayPage = undefined as import("@playwright/test").Page | undefined;
    await expect
      .poll(
        () => {
          overlayPage = harness.electronApp
            .windows()
            .find((p) => p.url().includes("#overlay"));
          return overlayPage !== undefined;
        },
        { timeout: 10_000 },
      )
      .toBe(true);
    expect(overlayPage, "overlay page exists").toBeTruthy();

    // The overlay should render the composer, not the empty state.
    await expect(overlayPage!.getByTestId("overlay-root")).toBeVisible({ timeout: 10_000 });
    await expect(overlayPage!.getByTestId("overlay-thread-title")).toHaveText("overlay-thread", { timeout: 10_000 });
    await expect(overlayPage!.getByTestId("composer")).toBeVisible({ timeout: 10_000 });

    // Clean up.
    await window.evaluate(() => (window as PiAppWindow).piApp!.closeOverlay());
    await expect.poll(() => overlayWindowCount(harness.electronApp), { timeout: 10_000 }).toBe(1);
  } finally {
    await harness.close();
  }
});

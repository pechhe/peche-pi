import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import {
  getDesktopState,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  seedAgentDir,
  type PiAppWindow,
} from "../helpers/electron-app";

/** Seed a v2 (folder-keyed) chassis state file. */
async function seedChassis(agentDir: string, folders: Record<string, unknown>) {
  const chassisDir = join(agentDir, "chassis");
  await mkdir(chassisDir, { recursive: true });
  await writeFile(join(chassisDir, "state.json"), JSON.stringify({ version: 2, folders }), "utf8");
}

/**
 * Open the new-thread composer for a specific workspace by clicking its own
 * "New project in {name}" button. This also selects that workspace, which is
 * what drives the per-folder chassis scope (chassisFolderPath).
 */
async function openNewThreadFor(window: Page, folderPath: string): Promise<void> {
  // Force the global workspace selection so the per-folder chassis scope
  // (chassisFolderPath = selected workspace path) follows this folder.
  const state = await getDesktopState(window);
  const ws = state.workspaces.find((w) => w.path === folderPath);
  if (!ws) throw new Error(`workspace not found: ${folderPath}`);
  await window.evaluate(async (id) => {
    const app = (window as PiAppWindow).piApp;
    if (!app) throw new Error("piApp unavailable");
    await app.selectWorkspace(id);
  }, ws.id);
  const button = window.locator(`.sidebar button[aria-label="New project in ${basename(folderPath)}"]`);
  await expect(button).toBeVisible({ timeout: 15_000 });
  await button.click({ force: true });
  await expect(window.getByTestId("new-thread-composer")).toBeVisible({ timeout: 15_000 });
}

const alphaActions = {
  actions: [
    { id: "alpha-run", label: "Alpha", showLabel: true, trigger: "oneShot", effect: { type: "submit", text: "/alpha" } },
    { id: "alpha-wrap", label: "AlphaWrap", showLabel: true, trigger: "sticky", effect: { type: "wrap", template: "A:\n{{input}}" } },
  ],
  activeStickyId: "alpha-wrap",
};
const betaActions = {
  actions: [
    { id: "beta-run", label: "Beta", showLabel: true, trigger: "oneShot", effect: { type: "submit", text: "/beta" } },
  ],
  activeStickyId: null,
};

test("two folders keep distinct action sets + active toggles, swap on switch, persist across restart", async () => {
  test.setTimeout(150_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const folderA = await makeWorkspace("chassis-folder-a");
  const folderB = await makeWorkspace("chassis-folder-b");
  const folderC = await makeWorkspace("chassis-folder-c"); // unconfigured → fallback empty
  await seedAgentDir(agentDir);
  await seedChassis(agentDir, { [folderA]: alphaActions, [folderB]: betaActions });

  const firstRun = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [folderA, folderB, folderC],
    testMode: "background",
  });

  try {
    const window = await firstRun.firstWindow();

    // Folder A: its buttons + active wrap toggle.
    await openNewThreadFor(window, folderA);
    await expect(window.getByTestId("chassis-action-alpha-run")).toBeVisible({ timeout: 15_000 });
    await expect(window.getByTestId("chassis-action-alpha-wrap")).toHaveAttribute("aria-checked", "true");
    await expect(window.getByTestId("chassis-action-beta-run")).toHaveCount(0);

    // Switch to folder B: buttons + active state swap (no active toggle).
    await openNewThreadFor(window, folderB);
    await expect(window.getByTestId("chassis-action-beta-run")).toBeVisible({ timeout: 15_000 });
    await expect(window.getByTestId("chassis-action-alpha-run")).toHaveCount(0);
    await expect(window.getByTestId("chassis-action-alpha-wrap")).toHaveCount(0);

    // Folder C: unconfigured → fallback, no action buttons.
    await openNewThreadFor(window, folderC);
    await expect(window.locator("[data-testid^='chassis-action-']")).toHaveCount(0, { timeout: 15_000 });
  } finally {
    await firstRun.close();
  }

  // Restart: each folder's actions AND activation persist.
  const secondRun = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [folderA, folderB, folderC],
    testMode: "background",
  });

  try {
    const window = await secondRun.firstWindow();

    await openNewThreadFor(window, folderA);
    await expect(window.getByTestId("chassis-action-alpha-run")).toBeVisible({ timeout: 15_000 });
    await expect(window.getByTestId("chassis-action-alpha-wrap")).toHaveAttribute("aria-checked", "true");

    await openNewThreadFor(window, folderB);
    await expect(window.getByTestId("chassis-action-beta-run")).toBeVisible({ timeout: 15_000 });
    await expect(window.getByTestId("chassis-action-alpha-run")).toHaveCount(0);
  } finally {
    await secondRun.close();
  }
});

import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  createNamedThread,
  getDesktopState,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  waitForWorkspaceByPath,
} from "../helpers/electron-app";

async function findSessionFile(userDataDir: string): Promise<string> {
  const sessionsRoot = join(userDataDir, "agent", "sessions");
  const found: { path: string; mtime: number }[] = [];
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.name.endsWith(".jsonl")) {
        found.push({ path: full, mtime: (await stat(full)).mtimeMs });
      }
    }
  }
  await walk(sessionsRoot);
  if (found.length === 0) {
    throw new Error(`No session file found under ${sessionsRoot}`);
  }
  found.sort((a, b) => b.mtime - a.mtime);
  return found[0].path;
}

test("shows an observe-only banner for a foreign session lock and takes it over", async () => {
  test.setTimeout(60_000);

  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("session-lock");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);
    await createNamedThread(window, "Lock take-over");

    // No banner while this window drives its own session.
    await expect(window.getByTestId("session-lock-banner")).toHaveCount(0);

    // Simulate the pi CLI having driven (and abandoned) this session by planting
    // a stale, dead-pid foreign lock next to the session file.
    const sessionFile = await findSessionFile(userDataDir);
    const lockPath = `${sessionFile}.lock`;
    await writeFile(
      lockPath,
      `${JSON.stringify({
        pid: 999999,
        kind: "cli",
        host: "stale-host",
        token: "foreign-token",
        acquiredAt: new Date(0).toISOString(),
        heartbeat: new Date(0).toISOString(),
      })}\n`,
    );

    // Banner appears (poll interval is 5s) with a take-over button.
    const banner = window.getByTestId("session-lock-banner");
    await expect(banner).toBeVisible({ timeout: 15_000 });
    await expect(banner).toContainText("pid 999999");
    const takeOver = window.getByTestId("session-lock-take-over");
    await expect(takeOver).toBeEnabled();

    await takeOver.click();

    // Banner clears once the GUI reclaims the lock.
    await expect(banner).toHaveCount(0, { timeout: 15_000 });

    // The lock file is now owned by the GUI, not the foreign CLI token.
    const reclaimed = JSON.parse(await readFile(lockPath, "utf8"));
    expect(reclaimed.kind).toBe("gui");
    expect(reclaimed.token).not.toBe("foreign-token");

    const state = await getDesktopState(window);
    expect(state.lastError).toBeFalsy();
  } finally {
    await harness.close();
  }
});

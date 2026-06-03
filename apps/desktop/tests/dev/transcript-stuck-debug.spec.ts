import { test } from "@playwright/test";
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

test("DEBUG capture transcript logs on first-load + restore", async () => {
  test.setTimeout(120_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("debug-stuck-workspace");
  await seedAgentDir(agentDir);
  await seedToolResultTreeSessionFixture(agentDir, workspacePath);
  await seedBranchedTreeSessionFixture(agentDir, workspacePath);

  const first = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });
  const log = (tag: string, msg: string) => console.log(`>>> [${tag}] ${msg}`);
  first.electronApp.process().stdout?.on("data", (d) => log("MAIN", String(d).trimEnd()));
  try {
    const window = await first.firstWindow();
    window.on("console", (m) => {
      const t = m.text();
      if (t.includes("transcript-dbg")) log("RENDERER", t);
    });
    log("STEP", "first launch — click Tree fixture session");
    await clickSession(window, "Tree fixture session");
    await window.waitForTimeout(3000);
    log("STEP", "select other thread");
    await clickSession(window, "Tree tool fixture session");
    await window.waitForTimeout(2000);
    log("STEP", "back to first");
    await clickSession(window, "Tree fixture session");
    await window.waitForTimeout(2000);
  } finally {
    await first.close();
  }
});

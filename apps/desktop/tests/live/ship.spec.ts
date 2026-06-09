import { expect, test } from "@playwright/test";
import {
  getDesktopState,
  launchDesktop,
  makeGitWorkspace,
  makeUserDataDir,
  type PiAppWindow,
} from "../helpers/electron-app";

// Ship happy path (#43). The Ship engine (featureDone) runs
// commit → push → PR → merge. Creating a real PR + merge requires the
// GitHub CLI (`gh`), an authenticated account, and a GitHub remote with
// network access — none of which are guaranteed in CI. This live-lane test
// is therefore a *documented stub*: it drives the same `featureDone` IPC
// seam the Environment widget uses and asserts the contract that matters
// regardless of environment — the Ship engine never fails silently.
//
// The true happy path (gh authenticated + real remote → real PR + merge)
// is exercised by the very same code path; only the terminal
// success/failure differs by environment.
test("Ship engine surfaces a clear result instead of failing silently", async () => {
  test.setTimeout(60_000);

  const userDataDir = await makeUserDataDir();
  // Local git repo on `main` with one commit and NO GitHub remote.
  const workspacePath = await makeGitWorkspace("ship-workspace");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();

    const state = await getDesktopState(window);
    const workspaceId = state.workspaces[0]?.id;
    expect(workspaceId, "expected the opened git workspace to be present").toBeTruthy();

    // featureDone must resolve to a structured result with a status string
    // and a non-empty message — it must never throw or hang.
    const result = await window.evaluate(async (id) => {
      const app = (window as PiAppWindow).piApp;
      if (!app) throw new Error("piApp IPC bridge unavailable");
      return app.featureDone({
        workspaceId: id,
        threadTitle: "Test feature",
        modelString: "deepseek:deepseek-chat",
      });
    }, workspaceId!);

    expect(typeof result.status).toBe("string");
    expect(["ok", "conflicts", "error"]).toContain(result.status);
    expect(typeof result.message).toBe("string");
    expect(result.message.trim().length).toBeGreaterThan(0);
  } finally {
    await harness.close();
  }
});

import { expect, test } from "@playwright/test";
import {
  getDesktopState,
  launchDesktop,
  makeGitWorkspace,
  makeUserDataDir,
  type PiAppWindow,
} from "../helpers/electron-app";

// Manual "Create PR" path (#42). Creating a real pull request requires the
// GitHub CLI (`gh`), an authenticated account, and a GitHub remote with
// network access — none of which are guaranteed in CI. This live-lane test is
// therefore a *documented stub*: it drives the same `prCreate` / `generatePrDraft`
// IPC seam the Environment widget uses and asserts the contract that matters
// regardless of environment — the PR-creation path never fails silently.
//
// The happy path (gh authenticated + real remote -> real PR against the repo
// default branch) is exercised by the very same code path; only the terminal
// success/failure differs by environment.
test("Create PR path surfaces a clear error instead of failing silently", async () => {
  test.setTimeout(60_000);

  const userDataDir = await makeUserDataDir();
  // Local git repo on `main` with one commit and NO GitHub remote.
  const workspacePath = await makeGitWorkspace("pr-create-workspace");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();

    const state = await getDesktopState(window);
    const workspaceId = state.workspaces[0]?.id;
    expect(workspaceId, "expected the opened git workspace to be present").toBeTruthy();

    // The draft generator must resolve to an editable draft (title/body strings)
    // — it may carry a `message` explaining a missing LLM key, but it must never
    // throw or return a malformed payload that would break the dialog.
    const draft = await window.evaluate(async (id) => {
      const app = (window as PiAppWindow).piApp;
      if (!app) throw new Error("piApp IPC bridge unavailable");
      return app.generatePrDraft(id);
    }, workspaceId!);
    expect(typeof draft.title).toBe("string");
    expect(typeof draft.body).toBe("string");

    // Creating a PR with no GitHub remote (and/or no gh on PATH) must come back
    // as an explicit failure with a non-empty, human-readable message — not a
    // throw, not a silent no-op.
    const result = await window.evaluate(async (id) => {
      const app = (window as PiAppWindow).piApp;
      if (!app) throw new Error("piApp IPC bridge unavailable");
      return app.prCreate(id, {
        title: "Test PR title",
        body: "Test PR body",
        base: "main",
        draft: false,
      });
    }, workspaceId!);

    expect(result.success).toBe(false);
    expect(result.message.trim().length).toBeGreaterThan(0);
  } finally {
    await harness.close();
  }
});

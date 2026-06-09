import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { sep } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";
import {
  assertExists,
  createNamedThread,
  createSessionViaIpc,
  getDesktopState,
  launchDesktop,
  makeGitWorkspace,
  makeUserDataDir,
  startThreadViaIpc,
  waitForWorkspaceByPath,
} from "../helpers/electron-app";

test("creates and selects a worktree-backed workspace from the desktop UI", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeGitWorkspace("worktree-live-workspace");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    const rootWorkspace = await waitForWorkspaceByPath(window, workspacePath);

    await window.getByRole("button", { name: `Workspace actions for ${rootWorkspace.name}` }).click();
    await window.getByRole("button", { name: "Create permanent worktree" }).click();

    await expect
      .poll(async () => {
        const state = await getDesktopState(window);
        const selected = state.workspaces.find((workspace) => workspace.id === state.selectedWorkspaceId);
        return selected?.kind === "worktree" && (state.worktreesByWorkspace[rootWorkspace.id]?.length ?? 0) > 0;
      })
      .toBe(true);

    const stateAfterCreate = await getDesktopState(window);
    const worktreeWorkspace = stateAfterCreate.workspaces.find(
      (workspace) => workspace.id === stateAfterCreate.selectedWorkspaceId,
    );
    assertExists(worktreeWorkspace, "Expected the selected workspace to be the newly created worktree");
    if (worktreeWorkspace.kind !== "worktree") {
      throw new Error("Expected the selected workspace to be the newly created worktree");
    }

    await expect(window.locator(".environment-picker__button")).toContainText(worktreeWorkspace.name);
    await expect(window.locator(".empty-panel")).toContainText("Create a thread for this folder");
    await expect(window.locator(".empty-panel")).not.toContainText("/Users/");

    await window.getByRole("complementary").getByRole("button", { name: "New thread" }).click();
    await expect(window.getByTestId("new-thread-composer")).toBeVisible();
    await expect(window.getByRole("button", { name: "Local", exact: true })).toBeVisible();
    await expect(window.getByRole("button", { name: "Worktree", exact: true })).toBeVisible();
  } finally {
    await harness.close();
  }
});

test("shows a worktree icon in the sidebar without a local text badge", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeGitWorkspace("worktree-sidebar-indicator");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    const rootWorkspace = await waitForWorkspaceByPath(window, workspacePath);

    await createNamedThread(window, "Local thread");
    const localRow = window.locator(".session-row", { hasText: "Local thread" });
    await expect(localRow).toBeVisible();
    await expect(localRow).toHaveAttribute("data-sidebar-indicator", "none");
    await expect(localRow.locator(".session-row__workspace-icon")).toHaveCount(0);

    await window.getByRole("button", { name: `Workspace actions for ${rootWorkspace.name}` }).click();
    await window.getByRole("button", { name: "Create permanent worktree" }).click();

    await expect
      .poll(async () => {
        const state = await getDesktopState(window);
        const selected = state.workspaces.find((workspace) => workspace.id === state.selectedWorkspaceId);
        return selected?.kind === "worktree";
      })
      .toBe(true);

    const stateAfterCreate = await getDesktopState(window);
    const firstWorktree = stateAfterCreate.workspaces.find(
      (workspace) => workspace.id === stateAfterCreate.selectedWorkspaceId,
    );
    assertExists(firstWorktree, "Expected selected worktree workspace");

    await createSessionViaIpc(window, firstWorktree.id, "Worktree thread");
    const worktreeRow = window.locator(".session-row", { hasText: "Worktree thread" });
    await expect(worktreeRow).toBeVisible();
    await expect(worktreeRow).toHaveAttribute("data-sidebar-indicator", "none");
    await expect(worktreeRow.locator(".session-row__workspace-icon")).toHaveCount(1);
    await expect(window.getByTestId("workspace-list")).not.toContainText("Local project");
  } finally {
    await harness.close();
  }
});

test("keeps orphaned worktree workspaces visible after removing the root workspace", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeGitWorkspace("worktree-orphan-visibility");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    const rootWorkspace = await waitForWorkspaceByPath(window, workspacePath);

    await window.getByRole("button", { name: `Workspace actions for ${rootWorkspace.name}` }).click();
    await window.getByRole("button", { name: "Create permanent worktree" }).click();

    await expect
      .poll(async () => {
        const state = await getDesktopState(window);
        const selected = state.workspaces.find((workspace) => workspace.id === state.selectedWorkspaceId);
        return selected?.kind === "worktree";
      })
      .toBe(true);

    const createdState = await getDesktopState(window);
    const createdWorkspace = createdState.workspaces.find((workspace) => workspace.id === createdState.selectedWorkspaceId);
    assertExists(createdWorkspace, "Expected created worktree workspace");

    await window.getByRole("button", { name: `Workspace actions for ${rootWorkspace.name}` }).click();
    window.once("dialog", (dialog) => {
      void dialog.accept();
    });
    await window.getByRole("button", { name: "Remove" }).click();

    await expect(window.getByTestId("empty-state")).toHaveCount(0);
    await expect
      .poll(async () => {
        const state = await getDesktopState(window);
        return state.workspaces.some((workspace) => workspace.id === createdWorkspace.id);
      })
      .toBe(true);
  } finally {
    await harness.close();
  }
});

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: readonly string[]): Promise<{ stdout: string; code: number }> {
  try {
    const { stdout } = await execFileAsync("git", [...args], { cwd, encoding: "utf8" });
    return { stdout: stdout.trim(), code: 0 };
  } catch (error) {
    const err = error as { code?: number; stdout?: string };
    return { stdout: (err.stdout ?? "").trim(), code: typeof err.code === "number" ? err.code : 1 };
  }
}

test("creates new worktrees detached in the managed dir with no git branch", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeGitWorkspace("worktree-detached-managed");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspacePath);

    // Drive new-thread with Location = worktree through the Desktop IPC seam.
    await startThreadViaIpc(window, { environment: "worktree", prompt: "detached worktree probe" });

    await expect
      .poll(async () => {
        const state = await getDesktopState(window);
        const selected = state.workspaces.find((workspace) => workspace.id === state.selectedWorkspaceId);
        return selected?.kind === "worktree";
      })
      .toBe(true);

    const state = await getDesktopState(window);
    const worktree = state.workspaces.find((workspace) => workspace.id === state.selectedWorkspaceId);
    assertExists(worktree, "Expected the selected workspace to be the created worktree");

    const worktreePath = await realpath(worktree.path);

    // Managed dir: the worktree lives under `<userDataDir>/worktrees/<id>`,
    // not as a sibling of the repo.
    const managedRoot = `${await realpath(userDataDir)}${sep}worktrees${sep}`;
    expect(worktreePath.startsWith(managedRoot)).toBe(true);

    // Detached HEAD: `symbolic-ref HEAD` fails (non-zero) when detached.
    const symbolicRef = await git(worktreePath, ["symbolic-ref", "-q", "HEAD"]);
    expect(symbolicRef.code).not.toBe(0);

    // No `branch` line in the porcelain worktree listing for this path = no branch.
    const list = await git(workspacePath, ["worktree", "list", "--porcelain"]);
    const block = list.stdout
      .split(/\n\s*\n/)
      .find((b) => b.split(/\r?\n/).some((line) => line.trim() === `worktree ${worktreePath}`));
    assertExists(block, "Expected the new worktree in `git worktree list --porcelain`");
    expect(block).toContain("detached");
    expect(block).not.toMatch(/^branch /m);
  } finally {
    await harness.close();
  }
});

test("removes a clean worktree via preview + removeWorktree API", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeGitWorkspace("worktree-remove-clean");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    const rootWorkspace = await waitForWorkspaceByPath(window, workspacePath);

    // Create a worktree thread
    await startThreadViaIpc(window, { environment: "worktree", prompt: "clean worktree remove" });

    // Wait for worktree workspace to be selected
    await expect
      .poll(async () => {
        const state = await getDesktopState(window);
        const selected = state.workspaces.find((w) => w.id === state.selectedWorkspaceId);
        return selected?.kind === "worktree";
      })
      .toBe(true);

    // Get worktree info from state
    const stateBefore = await getDesktopState(window);
    const worktreeWs = stateBefore.workspaces.find((w) => w.id === stateBefore.selectedWorkspaceId);
    assertExists(worktreeWs, "Expected worktree workspace to be selected");

    // Preview should return valid shape
    const preview = await window.evaluate(async (worktreeId) => {
      const app = (window as { piApp?: { getWorktreeRemovalPreview(id: string): Promise<{ uncommittedFiles: number; unpushedCommits: number }> } }).piApp;
      if (!app) throw new Error("piApp unavailable");
      return app.getWorktreeRemovalPreview(worktreeId);
    }, worktreeWs.id);
    expect(typeof preview.uncommittedFiles).toBe("number");
    expect(typeof preview.unpushedCommits).toBe("number");

    // Switch back to root workspace before removing worktree
    await window.evaluate(async (rootId) => {
      const app = (window as { piApp?: { selectWorkspace(id: string): Promise<unknown> } }).piApp;
      if (!app) throw new Error("piApp unavailable");
      await app.selectWorkspace(rootId);
    }, rootWorkspace.id);

    // Remove the worktree (force=false since it's clean)
    await window.evaluate(
      async ({ rootId, worktreeId }) => {
        const app = (window as { piApp?: { removeWorktree(input: { workspaceId: string; worktreeId: string; force?: boolean }): Promise<unknown> } }).piApp;
        if (!app) throw new Error("piApp unavailable");
        await app.removeWorktree({ workspaceId: rootId, worktreeId, force: false });
      },
      { rootId: rootWorkspace.id, worktreeId: worktreeWs.id },
    );

    // Assert worktree is gone from workspaces
    await expect
      .poll(async () => {
        const state = await getDesktopState(window);
        return state.workspaces.some((w) => w.id === worktreeWs.id);
      })
      .toBe(false);
  } finally {
    await harness.close();
  }
});

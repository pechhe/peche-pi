import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createWorkspaceReviewModule,
  parseStatus,
  isFullyStaged,
  validateFilePath,
  type GitAdapter,
  type ChangedFileEntry,
} from "./workspace-review.ts";
import type { UndoEditOp } from "../src/ipc.ts";
import { writeFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

// ---------------------------------------------------------------------------
// Fake git adapter for testing
// ---------------------------------------------------------------------------

function createFakeGit(stubs: {
  status?: string;
  revParse?: { code: number; stdout: string };
  diff?: string;
  diffCached?: string;
  diffNoIndex?: string;
  addError?: string;
  addCode?: number;
  statusPerFile?: Record<string, string>;
}): GitAdapter {
  return {
    async execGit(args, _cwd) {
      const cmd = args[0];

      if (cmd === "rev-parse") {
        return { stderr: "", ...(stubs.revParse ?? { stdout: "true\n", code: 0 }) };
      }

      if (cmd === "status") {
        // --porcelain without -- (full status)
        if (!args.includes("--")) {
          return { stdout: stubs.status ?? "", stderr: "", code: 0 };
        }
        // --porcelain -- <file> (single file check)
        const filePath = args[args.length - 1] ?? "";
        const perFile = stubs.statusPerFile?.[filePath] ?? "";
        return { stdout: perFile, stderr: "", code: 0 };
      }

      if (cmd === "diff") {
        if (args.includes("--cached")) {
          return { stdout: stubs.diffCached ?? "", stderr: "", code: 0 };
        }
        if (args.includes("--no-index")) {
          return { stdout: stubs.diffNoIndex ?? "", stderr: "", code: 1 };
        }
        return { stdout: stubs.diff ?? "", stderr: "", code: 0 };
      }

      if (cmd === "add") {
        if (stubs.addError) {
          return { stdout: "", stderr: stubs.addError, code: stubs.addCode ?? 1 };
        }
        return { stdout: "", stderr: "", code: 0 };
      }

      if (cmd === "rm") {
        return { stdout: "", stderr: "", code: 0 };
      }

      return { stdout: "", stderr: "", code: 0 };
    },
  };
}

// ---------------------------------------------------------------------------
// parseStatus tests
// ---------------------------------------------------------------------------

test("parseStatus: ?? → untracked", () => {
  assert.equal(parseStatus("??"), "untracked");
});

test("parseStatus: M  → modified (index modified)", () => {
  assert.equal(parseStatus("M "), "modified");
});

test("parseStatus:  M → modified (worktree modified)", () => {
  assert.equal(parseStatus(" M"), "modified");
});

test("parseStatus: MM → modified (both staged and unstaged)", () => {
  assert.equal(parseStatus("MM"), "modified");
});

test("parseStatus: A  → added (staged)", () => {
  assert.equal(parseStatus("A "), "added");
});

test("parseStatus:  A → added (new file, unstaged)", () => {
  assert.equal(parseStatus(" A"), "added");
});

test("parseStatus: D  → deleted (staged)", () => {
  assert.equal(parseStatus("D "), "deleted");
});

test("parseStatus:  D → deleted (unstaged)", () => {
  assert.equal(parseStatus(" D"), "deleted");
});

test("parseStatus: R  → modified (rename, default)", () => {
  assert.equal(parseStatus("R "), "modified");
});

test("parseStatus:  ? → modified (fallback)", () => {
  assert.equal(parseStatus(" ?"), "modified");
});

test("parseStatus: empty xy → modified (fallback)", () => {
  assert.equal(parseStatus("  "), "modified");
});

// ---------------------------------------------------------------------------
// isFullyStaged tests
// ---------------------------------------------------------------------------

test("isFullyStaged: A  → true (staged add, no worktree change)", () => {
  assert.equal(isFullyStaged("A "), true);
});

test("isFullyStaged: M  → true (staged modify, no worktree change)", () => {
  assert.equal(isFullyStaged("M "), true);
});

test("isFullyStaged: D  → true (staged delete, no worktree change)", () => {
  assert.equal(isFullyStaged("D "), true);
});

test("isFullyStaged: MM → false (staged + unstaged changes)", () => {
  assert.equal(isFullyStaged("MM"), false);
});

test("isFullyStaged:  M → false (unstaged only)", () => {
  assert.equal(isFullyStaged(" M"), false);
});

test("isFullyStaged: ?? → false (untracked)", () => {
  assert.equal(isFullyStaged("??"), false);
});

test("isFullyStaged:    → false (both spaces)", () => {
  assert.equal(isFullyStaged("  "), false);
});

// ---------------------------------------------------------------------------
// validateFilePath tests
// ---------------------------------------------------------------------------

test("validateFilePath: accepts file inside workspace", () => {
  assert.equal(validateFilePath("/workspace", "src/main.ts"), "src/main.ts");
});

test("validateFilePath: accepts relative path that resolves inside", () => {
  assert.equal(validateFilePath("/workspace", "./src/main.ts"), "./src/main.ts");
});

test("validateFilePath: rejects path escaping workspace", () => {
  assert.throws(
    () => validateFilePath("/workspace", "../etc/passwd"),
    /Path escapes workspace/,
  );
});

test("validateFilePath: rejects absolute path outside workspace", () => {
  assert.throws(
    () => validateFilePath("/workspace", "/etc/passwd"),
    /Path escapes workspace/,
  );
});

test("validateFilePath: rejects nested escape", () => {
  assert.throws(
    () => validateWorkspaceEscape("/workspace", "sub/../../etc/passwd"),
    /Path escapes workspace/,
  );
});

test("validateFilePath: accepts workspace root itself", () => {
  assert.equal(validateFilePath("/workspace", "/workspace"), "/workspace");
});

function validateWorkspaceEscape(ws: string, fp: string): string {
  return validateFilePath(ws, fp);
}

// ---------------------------------------------------------------------------
// getWorkspaceGitInfo tests
// ---------------------------------------------------------------------------

test("getWorkspaceGitInfo: returns isGitRepo false when not a git repo", async () => {
  const git = createFakeGit({ revParse: { code: 128, stdout: "" } });
  const review = createWorkspaceReviewModule(git);
  const info = await review.getWorkspaceGitInfo("/ws");
  assert.deepEqual(info, { isGitRepo: false, changedCount: 0 });
});

test("getWorkspaceGitInfo: returns changedCount from status lines", async () => {
  const git = createFakeGit({
    revParse: { code: 0, stdout: "true\n" },
    status: "M  src/a.ts\n A new.txt\n?? untracked.txt\n",
  });
  const review = createWorkspaceReviewModule(git);
  const info = await review.getWorkspaceGitInfo("/ws");
  assert.deepEqual(info, { isGitRepo: true, changedCount: 3 });
});

test("getWorkspaceGitInfo: handles empty status", async () => {
  const git = createFakeGit({
    revParse: { code: 0, stdout: "true\n" },
    status: "",
  });
  const review = createWorkspaceReviewModule(git);
  const info = await review.getWorkspaceGitInfo("/ws");
  assert.deepEqual(info, { isGitRepo: true, changedCount: 0 });
});

// ---------------------------------------------------------------------------
// getChangedFiles tests
// ---------------------------------------------------------------------------

test("getChangedFiles: parses multiple status lines", async () => {
  const git = createFakeGit({
    status: "M  src/a.ts\n A new.txt\n D old.txt\n?? untracked.txt\n",
  });
  const review = createWorkspaceReviewModule(git);
  const files = await review.getChangedFiles("/ws");
  assert.equal(files.length, 4);
  assert.deepEqual(files[0], { path: "src/a.ts", status: "modified", staged: true });
  assert.deepEqual(files[1], { path: "new.txt", status: "added", staged: false });
  assert.deepEqual(files[2], { path: "old.txt", status: "deleted", staged: false });
  assert.deepEqual(files[3], { path: "untracked.txt", status: "untracked", staged: false });
});

test("getChangedFiles: handles rename arrow", async () => {
  const git = createFakeGit({
    status: "R  old.ts -> new.ts\n",
  });
  const review = createWorkspaceReviewModule(git);
  const files = await review.getChangedFiles("/ws");
  assert.equal(files.length, 1);
  assert.equal(files[0]!.path, "new.ts");
});

test("getChangedFiles: returns empty on git failure", async () => {
  const git = createFakeGit({ status: "" });
  // Override to return error code
  const errorGit: GitAdapter = {
    async execGit() {
      return { stdout: "", stderr: "error", code: 1 };
    },
  };
  const review = createWorkspaceReviewModule(errorGit);
  const files = await review.getChangedFiles("/ws");
  assert.deepEqual(files, []);
});

test("getChangedFiles: skips blank lines", async () => {
  const git = createFakeGit({
    status: "\nM  a.ts\n\n  \n",
  });
  const review = createWorkspaceReviewModule(git);
  const files = await review.getChangedFiles("/ws");
  assert.equal(files.length, 1);
  assert.equal(files[0]!.path, "a.ts");
});

// ---------------------------------------------------------------------------
// getFileDiff tests
// ---------------------------------------------------------------------------

test("getFileDiff: returns unstaged diff when available", async () => {
  const git = createFakeGit({
    diff: "diff --git a/src/a.ts\n+line",
  });
  const review = createWorkspaceReviewModule(git);
  const diff = await review.getFileDiff("/ws", "src/a.ts");
  assert.equal(diff, "diff --git a/src/a.ts\n+line");
});

test("getFileDiff: falls back to staged diff", async () => {
  const git = createFakeGit({
    diff: "",
    diffCached: "diff --cached -- a/src/a.ts\n+staged",
  });
  const review = createWorkspaceReviewModule(git);
  const diff = await review.getFileDiff("/ws", "src/a.ts");
  assert.equal(diff, "diff --cached -- a/src/a.ts\n+staged");
});

test("getFileDiff: falls back to untracked file diff", async () => {
  const git = createFakeGit({
    diff: "",
    diffCached: "",
    diffNoIndex: "diff --no-index -- /dev/null new.txt\n+content",
  });
  const review = createWorkspaceReviewModule(git);
  const diff = await review.getFileDiff("/ws", "new.txt");
  assert.equal(diff, "diff --no-index -- /dev/null new.txt\n+content");
});

test("getFileDiff: returns empty when all diffs empty", async () => {
  const git = createFakeGit({ diff: "", diffCached: "", diffNoIndex: "" });
  const review = createWorkspaceReviewModule(git);
  const diff = await review.getFileDiff("/ws", "empty.txt");
  assert.equal(diff, "");
});

test("getFileDiff: rejects path escaping workspace", async () => {
  const git = createFakeGit({ diff: "" });
  const review = createWorkspaceReviewModule(git);
  await assert.rejects(
    () => review.getFileDiff("/ws", "../etc/passwd"),
    /Path escapes workspace/,
  );
});

// ---------------------------------------------------------------------------
// stageFile tests
// ---------------------------------------------------------------------------

test("stageFile: succeeds with valid path", async () => {
  const git = createFakeGit({});
  const review = createWorkspaceReviewModule(git);
  await review.stageFile("/ws", "src/a.ts"); // no throw
});

test("stageFile: rejects path escaping workspace", async () => {
  const git = createFakeGit({});
  const review = createWorkspaceReviewModule(git);
  await assert.rejects(
    () => review.stageFile("/ws", "../etc/passwd"),
    /Path escapes workspace/,
  );
});

test("stageFile: throws on git add failure", async () => {
  const git = createFakeGit({ addError: "fatal: bad index", addCode: 128 });
  const review = createWorkspaceReviewModule(git);
  await assert.rejects(
    () => review.stageFile("/ws", "file.txt"),
    /git add failed: fatal: bad index/,
  );
});

// ---------------------------------------------------------------------------
// undoEdits tests
// ---------------------------------------------------------------------------

test("undoEdits: reverses edit replacements in reverse order", async () => {
  const tmpDir = path.join(os.tmpdir(), `workspace-review-test-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });
  await writeFile(path.join(tmpDir, "a.ts"), "line1\nline2\nline3", "utf8");

  const git = createFakeGit({
    statusPerFile: { "a.ts": " M" }, // tracked, modified
  });
  const review = createWorkspaceReviewModule(git);

  const ops: UndoEditOp[] = [
    {
      kind: "edit",
      path: "a.ts",
      replacements: [
        { oldText: "line1", newText: "CHANGED1" },
        { oldText: "line2", newText: "CHANGED2" },
      ],
    },
  ];

  // File has been edited: "CHANGED1\nCHANGED2\nline3"
  await writeFile(path.join(tmpDir, "a.ts"), "CHANGED1\nCHANGED2\nline3", "utf8");

  const result = await review.undoEdits(tmpDir, ops);
  assert.deepEqual(result.reverted, ["a.ts"]);
  assert.deepEqual(result.failed, []);

  const { readFile: rf } = await import("node:fs/promises");
  const content = await rf(path.join(tmpDir, "a.ts"), "utf8");
  assert.equal(content, "line1\nline2\nline3");

  await rm(tmpDir, { recursive: true, force: true });
});

test("undoEdits: deletes untracked write files", async () => {
  const tmpDir = path.join(os.tmpdir(), `workspace-review-test-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });
  const filePath = path.join(tmpDir, "new.txt");
  await writeFile(filePath, "new content", "utf8");

  // git rm doesn't work on untracked files (returns 128), so the
  // implementation falls back to fs.rm. Verify that fallback path.
  const git = createFakeGit({
    statusPerFile: { "new.txt": "??" },
  });
  // Override rm to return failure so fallback to fs.rm is triggered
  const originalExecGit = git.execGit;
  git.execGit = async (args, cwd) => {
    if (args[0] === "rm") {
      return { stdout: "", stderr: "fatal: pathspec...", code: 128 };
    }
    return originalExecGit(args, cwd);
  };
  const review = createWorkspaceReviewModule(git);

  const ops: UndoEditOp[] = [{ kind: "write", path: "new.txt" }];
  const result = await review.undoEdits(tmpDir, ops);
  assert.deepEqual(result.reverted, ["new.txt"]);
  assert.deepEqual(result.failed, []);

  // File should be deleted by the fs.rm fallback
  const { access } = await import("node:fs/promises");
  await assert.rejects(() => access(filePath), /ENOENT/);

  await rm(tmpDir, { recursive: true, force: true });
});

test("undoEdits: refuses tracked full-file write", async () => {
  const tmpDir = path.join(os.tmpdir(), `workspace-review-test-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });

  const git = createFakeGit({
    statusPerFile: { "tracked.ts": " M" },
  });
  const review = createWorkspaceReviewModule(git);

  const ops: UndoEditOp[] = [{ kind: "write", path: "tracked.ts" }];
  const result = await review.undoEdits(tmpDir, ops);
  assert.deepEqual(result.reverted, []);
  assert.equal(result.failed.length, 1);
  assert.equal(result.failed[0]!.path, "tracked.ts");
  assert.match(result.failed[0]!.reason, /can't be undone automatically/);

  await rm(tmpDir, { recursive: true, force: true });
});

test("undoEdits: reports file changed when oldText not found", async () => {
  const tmpDir = path.join(os.tmpdir(), `workspace-review-test-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });
  await writeFile(path.join(tmpDir, "a.ts"), "original content", "utf8");

  const git = createFakeGit({
    statusPerFile: { "a.ts": " M" },
  });
  const review = createWorkspaceReviewModule(git);

  const ops: UndoEditOp[] = [
    {
      kind: "edit",
      path: "a.ts",
      replacements: [{ oldText: "NONEXISTENT", newText: "nope" }],
    },
  ];
  const result = await review.undoEdits(tmpDir, ops);
  assert.deepEqual(result.reverted, []);
  assert.equal(result.failed.length, 1);
  assert.match(result.failed[0]!.reason, /can't apply cleanly/);

  await rm(tmpDir, { recursive: true, force: true });
});

test("undoEdits: reports failure for edit with no replacements", async () => {
  const git = createFakeGit({});
  const review = createWorkspaceReviewModule(git);

  const ops: UndoEditOp[] = [{ kind: "edit", path: "a.ts", replacements: [] }];
  const result = await review.undoEdits("/tmp", ops);
  assert.deepEqual(result.reverted, []);
  assert.equal(result.failed.length, 1);
  assert.match(result.failed[0]!.reason, /No recorded edits/);
});

test("undoEdits: processes ops in reverse order", async () => {
  const tmpDir = path.join(os.tmpdir(), `workspace-review-test-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });
  await writeFile(path.join(tmpDir, "a.ts"), "CHANGED_A CHANGED_B", "utf8");

  const git = createFakeGit({
    statusPerFile: { "a.ts": " M" },
  });
  const review = createWorkspaceReviewModule(git);

  const ops: UndoEditOp[] = [
    {
      kind: "edit",
      path: "a.ts",
      replacements: [
        { oldText: "ORIGINAL_A", newText: "CHANGED_A" },
        { oldText: "ORIGINAL_B", newText: "CHANGED_B" },
      ],
    },
  ];

  const result = await review.undoEdits(tmpDir, ops);
  assert.deepEqual(result.reverted, ["a.ts"]);
  assert.deepEqual(result.failed, []);

  const { readFile: rf } = await import("node:fs/promises");
  const content = await rf(path.join(tmpDir, "a.ts"), "utf8");
  assert.equal(content, "ORIGINAL_A ORIGINAL_B");

  await rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// redoEdits tests
// ---------------------------------------------------------------------------

test("redoEdits: replays edit replacements forward", async () => {
  const tmpDir = path.join(os.tmpdir(), `workspace-review-test-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });
  await writeFile(path.join(tmpDir, "a.ts"), "line1\nline2", "utf8");

  const git = createFakeGit({});
  const review = createWorkspaceReviewModule(git);

  const ops: UndoEditOp[] = [
    {
      kind: "edit",
      path: "a.ts",
      replacements: [
        { oldText: "line1", newText: "CHANGED1" },
        { oldText: "line2", newText: "CHANGED2" },
      ],
    },
  ];

  const result = await review.redoEdits(tmpDir, ops);
  assert.deepEqual(result.reverted, ["a.ts"]);
  assert.deepEqual(result.failed, []);

  const { readFile: rf } = await import("node:fs/promises");
  const content = await rf(path.join(tmpDir, "a.ts"), "utf8");
  assert.equal(content, "CHANGED1\nCHANGED2");

  await rm(tmpDir, { recursive: true, force: true });
});

test("redoEdits: refuses write ops", async () => {
  const git = createFakeGit({});
  const review = createWorkspaceReviewModule(git);

  const ops: UndoEditOp[] = [{ kind: "write", path: "new.txt" }];
  const result = await review.redoEdits("/tmp", ops);
  assert.deepEqual(result.reverted, []);
  assert.equal(result.failed.length, 1);
  assert.match(result.failed[0]!.reason, /can't be redone automatically/);
});

test("redoEdits: reports file changed when oldText not found", async () => {
  const tmpDir = path.join(os.tmpdir(), `workspace-review-test-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });
  await writeFile(path.join(tmpDir, "a.ts"), "current content", "utf8");

  const git = createFakeGit({});
  const review = createWorkspaceReviewModule(git);

  const ops: UndoEditOp[] = [
    {
      kind: "edit",
      path: "a.ts",
      replacements: [{ oldText: "NONEXISTENT", newText: "nope" }],
    },
  ];
  const result = await review.redoEdits(tmpDir, ops);
  assert.deepEqual(result.reverted, []);
  assert.equal(result.failed.length, 1);
  assert.match(result.failed[0]!.reason, /can't apply cleanly/);

  await rm(tmpDir, { recursive: true, force: true });
});

test("redoEdits: reports failure for edit with no replacements", async () => {
  const git = createFakeGit({});
  const review = createWorkspaceReviewModule(git);

  const ops: UndoEditOp[] = [{ kind: "edit", path: "a.ts", replacements: [] }];
  const result = await review.redoEdits("/tmp", ops);
  assert.deepEqual(result.reverted, []);
  assert.equal(result.failed.length, 1);
  assert.match(result.failed[0]!.reason, /No recorded edits/);
});

test("redoEdits: processes ops in forward order", async () => {
  const tmpDir = path.join(os.tmpdir(), `workspace-review-test-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });
  await writeFile(path.join(tmpDir, "a.ts"), "ORIGINAL_A ORIGINAL_B", "utf8");

  const git = createFakeGit({});
  const review = createWorkspaceReviewModule(git);

  const ops: UndoEditOp[] = [
    {
      kind: "edit",
      path: "a.ts",
      replacements: [
        { oldText: "ORIGINAL_A", newText: "CHANGED_A" },
        { oldText: "ORIGINAL_B", newText: "CHANGED_B" },
      ],
    },
  ];

  const result = await review.redoEdits(tmpDir, ops);
  assert.deepEqual(result.reverted, ["a.ts"]);

  const { readFile: rf } = await import("node:fs/promises");
  const content = await rf(path.join(tmpDir, "a.ts"), "utf8");
  assert.equal(content, "CHANGED_A CHANGED_B");

  await rm(tmpDir, { recursive: true, force: true });
});

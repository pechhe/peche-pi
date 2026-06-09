/**
 * Workspace Review Module — deep Module owning the review seam before
 * publishing work. Changed files, file diffs, staging decisions, and safe
 * undo/redo of pi-authored edits live here.
 *
 * Low-level git execution is behind a GitAdapter interface so tests can
 * use fakes. Path validation is centralized at the privileged seam.
 */

import { execFile } from "node:child_process";
import path from "node:path";
import type { UndoEditOp, UndoEditsResult } from "../src/ipc";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChangedFileEntry {
  readonly path: string;
  readonly status: "added" | "modified" | "deleted" | "untracked";
  readonly staged: boolean;
}

export interface WorkspaceGitInfo {
  readonly isGitRepo: boolean;
  readonly changedCount: number;
}

export type GitStatusLine = string;

export interface GitAdapter {
  /** Run git and return stdout/stderr + exit code. */
  execGit(args: readonly string[], cwd: string): Promise<{ stdout: string; stderr: string; code: number }>;
}

// ---------------------------------------------------------------------------
// Path validation — centralized for all review commands
// ---------------------------------------------------------------------------

/**
 * Validate that `filePath` stays inside `workspacePath`.
 * Returns the validated path on success, throws on workspace escape.
 */
export function validateFilePath(workspacePath: string, filePath: string): string {
  const resolved = path.resolve(workspacePath, filePath);
  if (!resolved.startsWith(workspacePath + path.sep) && resolved !== workspacePath) {
    throw new Error("Path escapes workspace");
  }
  return filePath;
}

// ---------------------------------------------------------------------------
// Git status line parsing (pure, testable without git)
// ---------------------------------------------------------------------------

export function parseStatus(xy: string): ChangedFileEntry["status"] {
  const x = xy[0] ?? " ";
  const y = xy[1] ?? " ";

  if (x === "?" && y === "?") {
    return "untracked";
  }
  if (x === "A" || y === "A") {
    return "added";
  }
  if (x === "D" || y === "D") {
    return "deleted";
  }
  return "modified";
}

export function isFullyStaged(xy: string): boolean {
  const x = xy[0] ?? " ";
  const y = xy[1] ?? " ";
  if (x === "?" || x === " ") return false;
  return y === " ";
}

// ---------------------------------------------------------------------------
// Module — the Interface
// ---------------------------------------------------------------------------

export interface WorkspaceReviewModule {
  /** Check if the workspace is a git repo and get changed file count. */
  getWorkspaceGitInfo(workspacePath: string): Promise<WorkspaceGitInfo>;

  /** List changed files with their status and staged flag. */
  getChangedFiles(workspacePath: string): Promise<ChangedFileEntry[]>;

  /** Get the diff for a single file. Falls back through unstaged → staged → untracked. */
  getFileDiff(workspacePath: string, filePath: string): Promise<string>;

  /** Stage a single file. */
  stageFile(workspacePath: string, filePath: string): Promise<void>;

  /** Undo a turn's edits by reverse-applying recorded edit inputs. */
  undoEdits(workspacePath: string, ops: readonly UndoEditOp[]): Promise<UndoEditsResult>;

  /** Redo a previously-undone turn by replaying recorded edits forward. */
  redoEdits(workspacePath: string, ops: readonly UndoEditOp[]): Promise<UndoEditsResult>;
}

// ---------------------------------------------------------------------------
// Default git adapter (real git via child_process)
// ---------------------------------------------------------------------------

export const defaultGitAdapter: GitAdapter = {
  async execGit(args, cwd) {
    return new Promise((resolve) => {
      execFile("git", [...args], { cwd, maxBuffer: 5 * 1024 * 1024 }, (error, stdout, stderr) => {
        resolve({
          stdout: stdout ?? "",
          stderr: stderr ?? "",
          code: error ? (error as NodeJS.ErrnoException & { code?: number }).code ?? 1 : 0,
        });
      });
    });
  },
};

// ---------------------------------------------------------------------------
// Internal implementation
// ---------------------------------------------------------------------------

function createImpl(git: GitAdapter) {
  return {
    async getWorkspaceGitInfo(workspacePath: string): Promise<WorkspaceGitInfo> {
      const { stdout: revParseOut, code: revParseCode } = await git.execGit(
        ["rev-parse", "--is-inside-work-tree"],
        workspacePath,
      );
      const isGitRepo = revParseCode === 0 && revParseOut.trim() === "true";
      if (!isGitRepo) {
        return { isGitRepo: false, changedCount: 0 };
      }
      const { stdout: statusOut, code: statusCode } = await git.execGit(
        ["status", "--porcelain"],
        workspacePath,
      );
      if (statusCode !== 0) {
        return { isGitRepo: true, changedCount: 0 };
      }
      let changedCount = 0;
      for (const line of statusOut.split("\n")) {
        if (line.trim()) changedCount += 1;
      }
      return { isGitRepo: true, changedCount };
    },

    async getChangedFiles(workspacePath: string): Promise<ChangedFileEntry[]> {
      const { stdout, code } = await git.execGit(["status", "--porcelain"], workspacePath);
      if (code !== 0) return [];
      const entries: ChangedFileEntry[] = [];
      for (const line of stdout.split("\n")) {
        if (!line.trim()) continue;
        const xy = line.slice(0, 2);
        let filePath = line.slice(3).trim();
        const renameArrow = filePath.indexOf(" -> ");
        if (renameArrow >= 0) {
          filePath = filePath.slice(renameArrow + 4);
        }
        entries.push({
          path: filePath,
          status: parseStatus(xy),
          staged: isFullyStaged(xy),
        });
      }
      return entries;
    },

    async getFileDiff(workspacePath: string, filePath: string): Promise<string> {
      validateFilePath(workspacePath, filePath);
      // Unstaged diff
      const unstaged = await git.execGit(["diff", "--", filePath], workspacePath);
      if (unstaged.code === 0 && unstaged.stdout.trim()) {
        return unstaged.stdout;
      }
      // Staged diff
      const staged = await git.execGit(["diff", "--cached", "--", filePath], workspacePath);
      if (staged.code === 0 && staged.stdout.trim()) {
        return staged.stdout;
      }
      // Untracked file — show content as all-additions diff
      const untracked = await git.execGit(
        ["diff", "--no-index", "--", "/dev/null", filePath],
        workspacePath,
      );
      // git diff --no-index exits 1 when files differ, which is expected
      return untracked.stdout || "";
    },

    async stageFile(workspacePath: string, filePath: string): Promise<void> {
      validateFilePath(workspacePath, filePath);
      const { code, stderr } = await git.execGit(["add", "--", filePath], workspacePath);
      if (code !== 0) {
        throw new Error(`git add failed: ${stderr}`);
      }
    },

    async undoEdits(workspacePath: string, ops: readonly UndoEditOp[]): Promise<UndoEditsResult> {
      const reverted: string[] = [];
      const failed: { path: string; reason: string }[] = [];
      for (const op of [...ops].reverse()) {
        try {
          if (op.kind === "write") {
            if (await isUntracked(workspacePath, op.path, git)) {
              const rmResult = await git.execGit(["rm", "-f", "--", op.path], workspacePath);
              if (rmResult.code !== 0) {
                // Fallback: try removing via fs if git rm fails on untracked files
                const { rm } = await import("node:fs/promises");
                await rm(path.resolve(workspacePath, op.path), { force: true });
              }
              reverted.push(op.path);
            } else {
              failed.push({ path: op.path, reason: "Full-file write to a tracked file can't be undone automatically." });
            }
            continue;
          }
          const result = await applyEditReplacements(workspacePath, op, true, git);
          if (result.ok) reverted.push(op.path);
          else failed.push({ path: op.path, reason: result.reason });
        } catch (error) {
          failed.push({ path: op.path, reason: error instanceof Error ? error.message : String(error) });
        }
      }
      return { reverted, failed };
    },

    async redoEdits(workspacePath: string, ops: readonly UndoEditOp[]): Promise<UndoEditsResult> {
      const reverted: string[] = [];
      const failed: { path: string; reason: string }[] = [];
      for (const op of ops) {
        try {
          if (op.kind === "write") {
            failed.push({ path: op.path, reason: "Full-file write can't be redone automatically." });
            continue;
          }
          const result = await applyEditReplacements(workspacePath, op, false, git);
          if (result.ok) reverted.push(op.path);
          else failed.push({ path: op.path, reason: result.reason });
        } catch (error) {
          failed.push({ path: op.path, reason: error instanceof Error ? error.message : String(error) });
        }
      }
      return { reverted, failed };
    },
  };
}

// ---------------------------------------------------------------------------
// Module creation
// ---------------------------------------------------------------------------

export function createWorkspaceReviewModule(git: GitAdapter = defaultGitAdapter): WorkspaceReviewModule {
  const impl = createImpl(git);
  return {
    getWorkspaceGitInfo: (workspacePath) => impl.getWorkspaceGitInfo(workspacePath),
    getChangedFiles: (workspacePath) => impl.getChangedFiles(workspacePath),
    getFileDiff: (workspacePath, filePath) => impl.getFileDiff(workspacePath, filePath),
    stageFile: (workspacePath, filePath) => impl.stageFile(workspacePath, filePath),
    undoEdits: (workspacePath, ops) => impl.undoEdits(workspacePath, ops),
    redoEdits: (workspacePath, ops) => impl.redoEdits(workspacePath, ops),
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function isUntracked(workspacePath: string, filePath: string, git: GitAdapter): Promise<boolean> {
  const { stdout } = await git.execGit(["status", "--porcelain", "--", filePath], workspacePath);
  return stdout.startsWith("??");
}

async function applyEditReplacements(
  workspacePath: string,
  op: UndoEditOp,
  reverse: boolean,
  _git: GitAdapter,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const replacements = op.replacements ?? [];
  if (replacements.length === 0) {
    return { ok: false, reason: "No recorded edits to apply." };
  }
  const absolute = path.resolve(workspacePath, op.path);
  const { readFile } = await import("node:fs/promises");
  const { writeFile: fsWriteFile } = await import("node:fs/promises");
  let content = await readFile(absolute, "utf8");
  const ordered = reverse ? [...replacements].reverse() : replacements;
  for (const { oldText, newText } of ordered) {
    const [from, to] = reverse ? [newText, oldText] : [oldText, newText];
    const idx = content.indexOf(from);
    if (idx < 0) {
      return { ok: false, reason: "File changed since the edit; can't apply cleanly." };
    }
    content = content.slice(0, idx) + to + content.slice(idx + from.length);
  }
  await fsWriteFile(absolute, content, "utf8");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Singleton convenience re-exports (used by main.ts)
// ---------------------------------------------------------------------------

const _defaultReview = createWorkspaceReviewModule();

export const getWorkspaceGitInfo = (workspacePath: string) => _defaultReview.getWorkspaceGitInfo(workspacePath);
export const getChangedFiles = (workspacePath: string) => _defaultReview.getChangedFiles(workspacePath);
export const getFileDiff = (workspacePath: string, filePath: string) => _defaultReview.getFileDiff(workspacePath, filePath);
export const stageFile = (workspacePath: string, filePath: string) => _defaultReview.stageFile(workspacePath, filePath);
export const undoEdits = (workspacePath: string, ops: readonly UndoEditOp[]) => _defaultReview.undoEdits(workspacePath, ops);
export const redoEdits = (workspacePath: string, ops: readonly UndoEditOp[]) => _defaultReview.redoEdits(workspacePath, ops);

// ---------------------------------------------------------------------------
// Workspace file listing (migrated from app-store-files.ts)
// ---------------------------------------------------------------------------

const _fileCache = new Map<string, { files: string[]; timestamp: number }>();
const _CACHE_TTL_MS = 30_000;
const _CACHE_MAX_ENTRIES = 20;

export function listWorkspaceFiles(workspacePath: string): Promise<string[]> {
  const cached = _fileCache.get(workspacePath);
  if (cached && Date.now() - cached.timestamp < _CACHE_TTL_MS) {
    return Promise.resolve(cached.files);
  }

  return new Promise((resolve) => {
    execFile(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard"],
      { cwd: workspacePath, maxBuffer: 5 * 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          resolve([]);
          return;
        }
        const files = stdout
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
          .sort();
        if (_fileCache.size >= _CACHE_MAX_ENTRIES) {
          const oldest = _fileCache.keys().next().value;
          if (oldest !== undefined) {
            _fileCache.delete(oldest);
          }
        }
        _fileCache.set(workspacePath, { files, timestamp: Date.now() });
        resolve(files);
      },
    );
  });
}

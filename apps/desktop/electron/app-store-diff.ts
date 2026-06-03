import { execFile } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { UndoEditOp, UndoEditsResult } from "../src/ipc";

function validateFilePath(workspacePath: string, filePath: string): string {
  const resolved = path.resolve(workspacePath, filePath);
  if (!resolved.startsWith(workspacePath + path.sep) && resolved !== workspacePath) {
    throw new Error("Path escapes workspace");
  }
  return filePath;
}

export interface ChangedFileEntry {
  readonly path: string;
  readonly status: "added" | "modified" | "deleted" | "untracked";
  readonly staged: boolean;
}

export interface WorkspaceGitInfo {
  readonly isGitRepo: boolean;
  readonly changedCount: number;
}

export function getWorkspaceGitInfo(workspacePath: string): Promise<WorkspaceGitInfo> {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["rev-parse", "--is-inside-work-tree"],
      { cwd: workspacePath },
      (repoError, repoStdout) => {
        const isGitRepo = !repoError && repoStdout.trim() === "true";
        if (!isGitRepo) {
          resolve({ isGitRepo: false, changedCount: 0 });
          return;
        }
        execFile(
          "git",
          ["status", "--porcelain"],
          { cwd: workspacePath, maxBuffer: 2 * 1024 * 1024 },
          (statusError, statusStdout) => {
            if (statusError) {
              resolve({ isGitRepo: true, changedCount: 0 });
              return;
            }
            let changedCount = 0;
            for (const line of statusStdout.split("\n")) {
              if (line.trim()) changedCount += 1;
            }
            resolve({ isGitRepo: true, changedCount });
          },
        );
      },
    );
  });
}

export function getChangedFiles(workspacePath: string): Promise<ChangedFileEntry[]> {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["status", "--porcelain"],
      { cwd: workspacePath, maxBuffer: 2 * 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          resolve([]);
          return;
        }
        const entries: ChangedFileEntry[] = [];
        for (const line of stdout.split("\n")) {
          if (!line.trim()) {
            continue;
          }
          const xy = line.slice(0, 2);
          let filePath = line.slice(3).trim();
          // Renames show as "old -> new"; use the new path
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
        resolve(entries);
      },
    );
  });
}

export function getFileDiff(workspacePath: string, filePath: string): Promise<string> {
  validateFilePath(workspacePath, filePath);
  return new Promise((resolve) => {
    execFile(
      "git",
      ["diff", "--", filePath],
      { cwd: workspacePath, maxBuffer: 5 * 1024 * 1024 },
      (error, stdout) => {
        if (error || !stdout.trim()) {
          // Try staged diff
          execFile(
            "git",
            ["diff", "--cached", "--", filePath],
            { cwd: workspacePath, maxBuffer: 5 * 1024 * 1024 },
            (error2, stdout2) => {
              if (!error2 && stdout2.trim()) {
                resolve(stdout2);
                return;
              }
              // Untracked file — show content as all-additions diff
              execFile(
                "git",
                ["diff", "--no-index", "--", "/dev/null", filePath],
                { cwd: workspacePath, maxBuffer: 5 * 1024 * 1024 },
                (_error3, stdout3) => {
                  // git diff --no-index exits 1 when files differ, which is expected
                  resolve(stdout3 || "");
                },
              );
            },
          );
          return;
        }
        resolve(stdout);
      },
    );
  });
}

export function stageFile(workspacePath: string, filePath: string): Promise<void> {
  validateFilePath(workspacePath, filePath);
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      ["add", "--", filePath],
      { cwd: workspacePath },
      (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      },
    );
  });
}

function isUntracked(workspacePath: string, filePath: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["status", "--porcelain", "--", filePath],
      { cwd: workspacePath },
      (error, stdout) => {
        if (error) {
          resolve(false);
          return;
        }
        resolve(stdout.startsWith("??"));
      },
    );
  });
}

async function applyEditReplacements(
  workspacePath: string,
  op: UndoEditOp,
  reverse: boolean,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const replacements = op.replacements ?? [];
  if (replacements.length === 0) {
    return { ok: false, reason: "No recorded edits to apply." };
  }
  const absolute = path.resolve(workspacePath, op.path);
  let content = await readFile(absolute, "utf8");
  // Undo unwinds in reverse order (newText -> oldText); redo replays forward
  // (oldText -> newText). Both match on the first occurrence, mirroring how the
  // edit tool applied each replacement.
  const ordered = reverse ? [...replacements].reverse() : replacements;
  for (const { oldText, newText } of ordered) {
    const [from, to] = reverse ? [newText, oldText] : [oldText, newText];
    const idx = content.indexOf(from);
    if (idx < 0) {
      return { ok: false, reason: "File changed since the edit; can't apply cleanly." };
    }
    content = content.slice(0, idx) + to + content.slice(idx + from.length);
  }
  await writeFile(absolute, content, "utf8");
  return { ok: true };
}

/**
 * Undo a turn's edits by reverse-applying the recorded edit-tool inputs.
 * `edit` ops are reversed exactly (newText -> oldText, last applied first),
 * which is robust to line-number drift. New files written this turn (untracked)
 * are deleted. Overwrites of tracked files cannot be reversed from the recorded
 * input alone and are reported as failures rather than discarded destructively.
 */
export async function undoEdits(workspacePath: string, ops: readonly UndoEditOp[]): Promise<UndoEditsResult> {
  const reverted: string[] = [];
  const failed: { path: string; reason: string }[] = [];
  // Reverse-apply in reverse turn order so later edits unwind before earlier ones.
  for (const op of [...ops].reverse()) {
    try {
      // No workspace-escape guard here: edits may target files anywhere the pi
      // runtime wrote them. Writes are content-matched (the recorded text must
      // be present), so undo can't blind-overwrite an arbitrary path.
      if (op.kind === "write") {
        if (await isUntracked(workspacePath, op.path)) {
          await rm(path.resolve(workspacePath, op.path), { force: true });
          reverted.push(op.path);
        } else {
          failed.push({ path: op.path, reason: "Full-file write to a tracked file can't be undone automatically." });
        }
        continue;
      }
      const result = await applyEditReplacements(workspacePath, op, true);
      if (result.ok) reverted.push(op.path);
      else failed.push({ path: op.path, reason: result.reason });
    } catch (error) {
      failed.push({ path: op.path, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return { reverted, failed };
}

/**
 * Redo a previously-undone turn by replaying the recorded edits forward
 * (oldText -> newText, in original order). `write` ops can't be replayed because
 * the written content isn't recorded, so they're reported as failures.
 */
export async function redoEdits(workspacePath: string, ops: readonly UndoEditOp[]): Promise<UndoEditsResult> {
  const reverted: string[] = [];
  const failed: { path: string; reason: string }[] = [];
  for (const op of ops) {
    try {
      if (op.kind === "write") {
        failed.push({ path: op.path, reason: "Full-file write can't be redone automatically." });
        continue;
      }
      const result = await applyEditReplacements(workspacePath, op, false);
      if (result.ok) reverted.push(op.path);
      else failed.push({ path: op.path, reason: result.reason });
    } catch (error) {
      failed.push({ path: op.path, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return { reverted, failed };
}

function parseStatus(xy: string): ChangedFileEntry["status"] {
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

function isFullyStaged(xy: string): boolean {
  const x = xy[0] ?? " ";
  const y = xy[1] ?? " ";
  if (x === "?" || x === " ") return false;
  return y === " ";
}

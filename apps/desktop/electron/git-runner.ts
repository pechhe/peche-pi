/**
 * Canonical Git execution boundary.
 *
 * Every service that shells out to `git` goes through this module so that
 * cwd handling, max-buffer, exit-code interpretation, and the missing-Git
 * case are defined exactly once.
 */

import { execFile } from "node:child_process";

/** Typed result of a shell command. */
export interface ExecResult {
  readonly stdout: string;
  readonly stderr: string;
  /** Process exit code. 0 = success. 127 = command not found. */
  readonly code: number;
}

const MAX_BUFFER = 10 * 1024 * 1024; // 10 MB

/**
 * Run an arbitrary command and return a typed result.
 * Never throws — errors surface as non-zero `code`.
 */
function execCmd(
  cmd: string,
  args: string[],
  cwd: string,
): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      { cwd, maxBuffer: MAX_BUFFER },
      (error, stdout, stderr) => {
        if (!error) {
          resolve({
            stdout: stdout?.trim() ?? "",
            stderr: stderr?.trim() ?? "",
            code: 0,
          });
          return;
        }
        const errnoCode = (error as NodeJS.ErrnoException).code;
        if (errnoCode === "ENOENT") {
          resolve({
            stdout: "",
            stderr: `${cmd} not found`,
            code: 127,
          });
          return;
        }
        // Node's execFile sets `error.status` to the child exit code.
        // `error.code` is always a string (e.g. 'ERR_CHILD_PROCESS...'), never a number.
        const exitCode =
          typeof (error as unknown as { status?: number }).status === "number"
            ? (error as unknown as { status: number }).status
            : 1;
        resolve({
          stdout: stdout?.trim() ?? "",
          stderr: stderr?.trim() ?? "",
          code: exitCode,
        });
      },
    );
  });
}

/** Run a `git` command in `cwd`. */
export function execGit(
  args: string[],
  cwd: string,
): Promise<ExecResult> {
  return execCmd("git", args, cwd);
}

/** Run a `gh` CLI command in `cwd`. */
export function execGh(
  args: string[],
  cwd: string,
): Promise<ExecResult> {
  return execCmd("gh", args, cwd);
}

/** Check whether `cwd` is inside a Git repository. */
export async function isGitRepo(cwd: string): Promise<boolean> {
  const { code } = await execGit(["rev-parse", "--git-dir"], cwd);
  return code === 0;
}

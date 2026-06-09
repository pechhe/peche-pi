/**
 * Lazy branch creation for detached-first worktrees.
 *
 * When a worktree is created in detached HEAD state (the default for
 * peche-pi's detached-first worktree flow), the first commit needs a real
 * branch.  This module provides a single, shared helper that both the
 * Ship engine (feature-done.ts) and the manual Commit & Push path use.
 */

import { execGit } from "./git-runner.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

export async function isDetachedHead(cwd: string): Promise<boolean> {
  const { stdout, code } = await execGit(["symbolic-ref", "HEAD", "--quiet"], cwd);
  // symbolic-ref fails (code 1) when HEAD is detached
  return code !== 0 || !stdout.startsWith("refs/heads/");
}

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

export interface EnsureCommitBranchResult {
  /** The branch the next commit should land on. */
  readonly branch: string;
  /** True if a new branch was just created (HEAD was detached). */
  readonly created: boolean;
}

/**
 * Ensure HEAD is on a named branch suitable for committing.
 *
 * If HEAD is already on a branch, returns it unchanged (`created: false`).
 * If HEAD is detached, creates + switches to a new branch derived from
 * `threadTitleHint` (slugified, uniquified against existing branches)
 * and returns it with `created: true`.
 *
 * Uses `git switch -c` which works from detached HEAD and preserves the
 * index / working tree.
 */
export async function ensureCommitBranch(
  workspacePath: string,
  threadTitleHint: string,
): Promise<EnsureCommitBranchResult> {
  if (!(await isDetachedHead(workspacePath))) {
    const { stdout } = await execGit(["rev-parse", "--abbrev-ref", "HEAD"], workspacePath);
    return { branch: stdout, created: false };
  }

  const slug = slugify(threadTitleHint) || "feature";

  // Find a unique branch name
  let candidate = slug;
  let suffix = 1;
  while (true) {
    const { code } = await execGit(
      ["rev-parse", "--verify", `refs/heads/${candidate}`],
      workspacePath,
    );
    if (code !== 0) break; // branch doesn't exist — good
    candidate = `${slug}-${++suffix}`;
  }

  const checkout = await execGit(["switch", "-c", candidate], workspacePath);
  if (checkout.code !== 0) {
    throw new Error(`Failed to create branch "${candidate}": ${checkout.stderr}`);
  }

  return { branch: candidate, created: true };
}

/**
 * "Feature done" orchestrator for worktree threads.
 *
 * Flow:
 *   1. Detached HEAD? → create branch from thread title
 *   2. Commit any uncommitted work
 *   3. Push to origin
 *   4. Create PR (feature → main)
 *   5. Try merge main into feature branch
 *   6. Clean? → done
 *   7. Conflicts? → return conflict info + handoff prompt for resolver thread
 */

import path from "node:path";
import { execGit, execGh, isGitRepo } from "./git-runner";
import { createPullRequest, generatePrDraft, getDefaultBranch, getHeadBranch, hasUpstream } from "./pr-service";
import { ensureCommitBranch } from "./lazy-branch";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConflictInfo {
  readonly file: string;
  readonly content: string;
}

export interface FeatureDoneResult {
  readonly status: "ok" | "conflicts" | "error";
  readonly message: string;
  readonly prUrl?: string;
  readonly prNumber?: number;
  readonly branchName?: string;
  readonly conflicts?: readonly ConflictInfo[];
  readonly handoffPrompt?: string;
}

export interface FeatureDoneInput {
  /** Absolute path to the worktree directory. */
  readonly workspacePath: string;
  /** Thread title, used for branch name when on detached HEAD. */
  readonly threadTitle: string;
  /** LLM model string for PR body generation (e.g. "openai/gpt-4o"). */
  readonly modelString: string;
  /** Fetch API key for a given provider. */
  readonly getApiKey: (providerId: string) => Promise<string | undefined>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getConflictedFiles(cwd: string): Promise<string[]> {
  const { stdout } = await execGit(["diff", "--name-only", "--diff-filter=U"], cwd);
  return stdout.split("\n").filter((f) => f.trim());
}

async function getFileContent(cwd: string, file: string): Promise<string> {
  const { stdout } = await execGit(["show", `:${file}`], cwd).catch(() => ({ stdout: "" }));
  // git show :file shows the index version, which includes conflict markers.
  // Fall back to reading the working tree file.
  if (stdout) return stdout;
  try {
    const fs = await import("node:fs/promises");
    return await fs.readFile(path.join(cwd, file), "utf-8");
  } catch {
    return "(could not read file)";
  }
}

async function getCommitsSinceMain(cwd: string, baseBranch: string): Promise<string> {
  const mergeBase = await execGit(["merge-base", "HEAD", `origin/${baseBranch}`], cwd);
  const baseRef = mergeBase.code === 0 && mergeBase.stdout ? mergeBase.stdout : `origin/${baseBranch}`;
  const { stdout } = await execGit(["log", `${baseRef}..HEAD`, "--pretty=format:%h %s"], cwd);
  return stdout;
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export async function featureDone(input: FeatureDoneInput): Promise<FeatureDoneResult> {
  const { workspacePath, threadTitle, modelString, getApiKey } = input;

  log("start", { workspacePath, threadTitle });

  // 0. Validate
  if (!(await isGitRepo(workspacePath))) {
    return { status: "error", message: "Not a git repository." };
  }

  const gh = await execGh(["--version"], workspacePath);
  if (gh.code !== 0) {
    return { status: "error", message: "GitHub CLI (gh) not found. Install it to create PRs." };
  }

  // 1. Check HEAD state, create branch if detached
  let branchResult;
  try {
    branchResult = await ensureCommitBranch(workspacePath, threadTitle);
  } catch (err) {
    return { status: "error", message: err instanceof Error ? err.message : String(err) };
  }
  const branchName = branchResult.branch;
  if (branchResult.created) {
    log("branch_created", { branchName });
  }

  // 2. Commit any uncommitted work
  const status = await execGit(["status", "--porcelain"], workspacePath);
  if (status.stdout.trim()) {
    const add = await execGit(["add", "-A"], workspacePath);
    if (add.code !== 0) {
      return { status: "error", message: `git add failed: ${add.stderr}` };
    }
    const commit = await execGit(["commit", "-m", `chore: ship ${branchName}`], workspacePath);
    if (commit.code !== 0) {
      // Nothing to commit is fine (e.g. all changes were already staged and committed)
      if (!commit.stderr.includes("nothing to commit")) {
        return { status: "error", message: `git commit failed: ${commit.stderr}` };
      }
    }
    log("committed", { branchName });
  }

  // 3. Push to origin
  if (!(await hasUpstream(workspacePath))) {
    const push = await execGit(["push", "-u", "origin", branchName], workspacePath);
    if (push.code !== 0) {
      return { status: "error", message: `git push failed: ${push.stderr.slice(0, 300)}` };
    }
    log("pushed_new_upstream", { branchName });
  } else {
    const push = await execGit(["push"], workspacePath);
    if (push.code !== 0) {
      return { status: "error", message: `git push failed: ${push.stderr.slice(0, 300)}` };
    }
    log("pushed", { branchName });
  }

  // 4. Create PR
  const baseBranch = await getDefaultBranch(workspacePath);
  const draft = await generatePrDraft(workspacePath, modelString, baseBranch, getApiKey);
  const prResult = await createPullRequest(workspacePath, {
    title: draft.title,
    body: draft.body,
    base: baseBranch,
    draft: false,
  });
  if (!prResult.success) {
    return { status: "error", message: `PR creation failed: ${prResult.message}` };
  }
  log("pr_created", { url: prResult.url, number: prResult.number });

  // 5. Try merging main into the feature branch
  //    First fetch latest, then merge --no-commit to detect conflicts
  await execGit(["fetch", "origin", baseBranch], workspacePath);
  const merge = await execGit(["merge", "--no-commit", `origin/${baseBranch}`], workspacePath);

  if (merge.code === 0) {
    // Clean merge — finalize it
    await execGit(["commit", "--no-edit"], workspacePath).catch(() => {});
    await execGit(["push"], workspacePath);
    log("merge_clean", { branchName });
    return {
      status: "ok",
      message: `PR created and mergeable: ${prResult.url ?? ""}`,
      prUrl: prResult.url,
      prNumber: prResult.number,
      branchName,
    };
  }

  // 6. Conflicts detected — collect info and abort the merge
  const conflictedFiles = await getConflictedFiles(workspacePath);
  log("merge_conflicts", { files: conflictedFiles });

  const conflicts: ConflictInfo[] = [];
  for (const file of conflictedFiles) {
    const content = await getFileContent(workspacePath, file);
    conflicts.push({ file, content });
  }

  // Abort the merge so the worktree is clean for the resolver thread
  await execGit(["merge", "--abort"], workspacePath);

  // 7. Generate handoff prompt for the resolver thread
  const commits = await getCommitsSinceMain(workspacePath, baseBranch);
  const conflictContent = conflicts
    .map((c) => `### ${c.file}\n\n\`\`\`\n${c.content}\n\`\`\``)
    .join("\n\n");

  const handoffPrompt = [
    `# Merge Conflict Resolution`,
    ``,
    `A feature branch \`${branchName}\` has conflicts when merging \`${baseBranch}\`.`,
    `Resolve the conflicts, validate, commit, and push.`,
    ``,
    `## Feature context`,
    ``,
    `**PR:** ${draft.title}`,
    ``,
    `**Commits on this branch:**`,
    `\`\`\``,
    commits || "(no commits)",
    `\`\`\``,
    ``,
    `**PR description:**`,
    draft.body,
    ``,
    `## Files with conflicts`,
    ``,
    conflictContent,
    ``,
    `## Instructions`,
    ``,
    `1. Resolve each conflict. Understand the intent of BOTH sides — the feature changes AND the main changes.`,
    `   - Feature intent is described in the PR description and commits above.`,
    `   - Main changes are whatever was recently merged.`,
    `2. After resolving all files, run:`,
    `   \`\`\``,
    `   cd ${workspacePath}`,
    `   git add -A`,
    `   npx tsc -p apps/desktop/tsconfig.json --noEmit`,
    `   \`\`\``,
    `3. If typecheck passes:`,
    `   \`\`\``,
    `   git commit -m "resolve: merge conflicts with ${baseBranch}"`,
    `   git push`,
    `   \`\`\``,
    `4. If typecheck fails: fix the errors and repeat step 2-3.`,
    `5. If you cannot resolve a conflict after 3 attempts, leave the conflict markers and report which files need manual resolution.`,
    ``,
    `Work in the directory: \`${workspacePath}\``,
  ].join("\n");

  return {
    status: "conflicts",
    message: `Merge conflicts detected in ${conflictedFiles.length} file(s). A resolver thread will be spawned.`,
    prUrl: prResult.url,
    prNumber: prResult.number,
    branchName,
    conflicts,
    handoffPrompt,
  };
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function log(step: string, payload: Record<string, unknown> = {}): void {
  const entry = { tag: "feature-done", step, ts: new Date().toISOString(), ...payload };
  console.error(JSON.stringify(entry));
}

# Worktrees are detached-first with lazy branch creation, in a managed dir

We adopt Codex's worktree model: a new worktree is created at **detached HEAD**
on the chosen start point with **no git branch**, lives in a managed dir
(`…/peche-pi/worktrees/<id>`) rather than as a sibling of the repo, and only
gains a git branch **lazily** on the first commit/Ship (named from the thread
title) or via an explicit "Create branch here".

We do this because the previous model auto-created a `wt-<id>` branch per
worktree and scattered worktrees next to the repo, which produced junk
branches, "branch already checked out in two worktrees" errors, and cluttered
project folders. pi itself has no native worktree/branch/commit management (it
only reads the current branch from a session's cwd for its footer), so the
Desktop App legitimately owns this orchestration rather than deferring upstream.

## Consequences

- A future reader will see worktrees with no branch (detached) and should
  understand this is deliberate, not a bug — the branch appears on first
  publish.
- Existing sibling-dir worktrees from the old scheme are left as-is; only newly
  created worktrees use the managed dir and detached-first model.
- The old always-on `feature-done` auto-publish (auto-`add -A`, canned commit,
  auto-merge of main) is retired as the default. Its engine is retained behind
  an opt-in **Auto-ship** mode; the default flow is manual (stage → commit →
  push → PR).

# PRD: Consolidate Git Review Services and Clean Committed Artifacts

## Problem Statement

The desktop app has duplicated review-service logic and repository hygiene issues that make future work harder to review and maintain.

Two services independently shell out to Git, validate repositories, interpret command output, generate LLM prompts, and push branches. This creates duplicated behavior, inconsistent error handling, and a higher risk that commit/push and PR flows drift apart.

The repository also contains committed local/runtime artifacts: session HTML dumps, TypeScript build output, agent todo state, Ralph runtime state, and duplicate large icon assets. These files add noise to diffs, inflate repository size, and make code review harder.

## Solution

Introduce one canonical Git execution boundary and consolidate commit/push plus PR orchestration around it. The user-facing behavior should stay the same: commit/push and PR flows continue to work, but they share the same lower-level Git runner, repository checks, command result model, and error handling.

Clean the repository by removing local/runtime artifacts from version control and adding ignore rules so the same clutter does not return. Deduplicate large repeated image assets so there is one canonical source or a clearly justified generated copy path.

## User Stories

1. As a desktop app user, I want commit/push to keep working, so that I can checkpoint work from the app without thinking about Git internals.
2. As a desktop app user, I want PR drafting to keep working, so that I can turn branch work into a reviewable pull request without leaving the app.
3. As a desktop app user, I want Git errors to be reported consistently, so that I understand whether the failure is repository state, staging, commit creation, push, or provider access.
4. As a desktop app user, I want successful commit/push and PR flows to preserve existing behavior, so that this cleanup does not change product semantics.
5. As a developer, I want one canonical Git runner, so that command execution, buffering, cwd handling, exit codes, stdout/stderr, and missing-Git behavior are defined once.
6. As a developer, I want commit/push and PR services to share repository validation, so that one flow does not accept a state the other rejects.
7. As a developer, I want command result types to be explicit, so that callers do not parse ad-hoc strings or rely on loosely shaped objects.
8. As a developer, I want LLM prompt generation to remain separate from Git execution, so that Git orchestration can be tested without provider calls.
9. As a developer, I want PR drafting and commit-message generation to share only the primitives they truly share, so that consolidation does not become a vague mega-service.
10. As a developer, I want duplicated branch push logic removed, so that future push behavior changes happen in one place.
11. As a reviewer, I want local runtime artifacts removed from the diff, so that reviews focus on product code and intentional docs.
12. As a reviewer, I want TypeScript build outputs ignored, so that generated cache files do not appear as source changes.
13. As a reviewer, I want session transcript exports ignored, so that private/debugging artifacts do not pollute the repository.
14. As a maintainer, I want agent runtime state ignored unless explicitly intended as source, so that loop/todo state does not accidentally become permanent project history.
15. As a maintainer, I want duplicate large image assets deduplicated or justified, so that repository size does not grow from repeated identical binaries.
16. As a maintainer, I want ignore rules documented by behavior, so that future contributors understand which artifacts should stay untracked.
17. As a future agent, I want clean diffs and fewer duplicated service paths, so that automated implementation work has fewer places to accidentally diverge.

## Implementation Decisions

- Build a deep Git execution module with a small stable interface: run a Git command in a working directory and return a typed result with stdout, stderr, exit code, and failure classification.
- Move shared repository checks, branch discovery, staging diff reads, commit creation, and push helpers behind explicit Git helper functions instead of duplicating shell calls in higher-level services.
- Keep commit-message generation and PR-body generation as separate service responsibilities. Consolidate shared primitives, not the user-facing workflows into one vague catch-all module.
- Preserve existing commit/push and PR public contracts unless a current contract is unclear; any contract cleanup should be typed and explicit.
- Avoid casts and loosely shaped errors at the new service boundary. Error messages may remain user-facing strings, but internal control flow should use typed command results.
- Keep provider/API-key lookup out of the Git runner. The Git runner owns Git execution only.
- Remove committed local/runtime artifacts from version control and add ignore rules for session HTML exports, TypeScript build info, agent todo state, and Ralph runtime state where appropriate.
- Treat image deduplication as repository hygiene, not UI redesign. Preserve current visual output. If multiple packages need the same icon, use one canonical source or a build/copy convention rather than committing identical binaries in several places.
- Do not delete user session history or local caches outside version control. Only remove tracked artifact files from the repository index/worktree as part of this cleanup.

## Testing Decisions

- Test external behavior and stable service contracts, not the internal command composition details unless they define observable behavior.
- Add unit tests for the Git execution boundary using controlled command outcomes or mocks/stubs. Cover success, non-zero Git exit, missing Git, stderr-only failures, and max-buffer-safe result handling if practical.
- Add service-level tests for commit/push and PR orchestration that prove both flows consume the shared Git result model correctly.
- Reuse existing desktop main-process test style for service tests.
- Run desktop renderer and Electron typechecks after service consolidation.
- Run the core desktop e2e lane to ensure commit/push and PR-related IPC changes do not regress the app shell.
- For artifact cleanup, verification should prove the unwanted tracked files are gone, ignore rules cover the artifact patterns, and duplicate binary assets are no longer repeated without justification.

## Out of Scope

- Decomposing the large renderer and store god-files; that is covered by a separate PRD.
- Reworking the commit/push UI.
- Changing PR copy quality, provider selection, or model behavior.
- Adding a new Git library dependency unless the existing shell approach proves insufficient.
- Removing untracked local session history, caches, screenshots, or temp files from a user's machine.
- Redesigning app icons or brand assets.

## Further Notes

This work is best split into two Ralph items because the cleanup has different risk from the service consolidation:

1. Repository artifact cleanup and image deduplication.
2. Git/LLM service consolidation around a canonical Git runner.

The cleanup item should run first because it reduces diff noise before behavior-touching service work.

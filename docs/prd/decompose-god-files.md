# PRD: Decompose `App.tsx` and `app-store.ts` god-files

## Problem

Two files dominate the codebase and absorb every new feature:

- `apps/desktop/src/App.tsx` — 3322 lines; single `App()` component ≈2970 lines with 43 useState, 22 useEffect, 22 useCallback, 22 useRef.
- `apps/desktop/electron/app-store.ts` — 3071 lines; single `DesktopAppStore` class.

Both are well past the 1k-line smell threshold. Features (Ralph loop, commit-push/PR, subagent fleet, go-live, self-heal) are interleaved as raw effects/methods instead of cohesive units, making the files hard to scan and risky to change.

## Goal

Behavior-preserving decomposition of both files to under ~1k lines each, using the repo's existing idioms. No functional changes.

## Non-goals

- No behavior changes, no new features.
- Out of scope this round: `sidebar.tsx`, `timeline-item.tsx`, `conversation-timeline.tsx`, `session-supervisor.ts`; merging `pr-service`+`commit-push-service` / canonical `runGit`; junk-file cleanup (committed HTML dumps, `tsconfig.tsbuildinfo`, duplicate PNGs).

## Approach

### `app-store.ts` (do first — deterministic)

Extend the existing free-function partial pattern (`fn(store: AppStoreInternals, …) => DesktopAppState`); class keeps thin delegators like it already does for `workspace`/`worktree`/`composer`.

- `app-store-ralph.ts` ← ralph methods
- `app-store-review.ts` ← commit-push/PR orchestration; push pure orchestration into existing `pr-service.ts` / `commit-push-service.ts`
- `app-store-subagent.ts` ← subagent fleet methods
- Widen `AppStoreInternals` only as each cluster requires, with **named members — no `as any`/casts**.

### `App.tsx` (do second — timing-sensitive)

Extract per-feature custom hooks (idiom already present: `use-navigation-history.ts`, `use-sidebar-width.ts`). `App()` becomes thin orchestration + render.

- `useSelfHealTranscript` (characterization test first)
- `usePendingThreadGoLive` (characterization test first — go-live / composer-slide / 6s safety-net)
- `useRalphLoop`
- `useCommitPush`
- `useSubagentFleet`

## Verification (per unit)

1. `tsc --noEmit` for renderer (`tsconfig.json`) and electron (`tsconfig.electron.json`).
2. Rerun owning `pnpm test:e2e:core` lane.
3. Spot-check in Pi Dev.app.
4. One extracted unit per commit (bisectable).

## Done when

- Both files comfortably under ~1k lines and cohesive.
- Each extracted unit typechecks and its lane is green.
- No `as any`/casts introduced at the new seams.
- Behavior verified on the real Electron surface.

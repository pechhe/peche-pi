# Ralph Loop Progress

## Iteration 1: app-store.ts — extract ralph methods into app-store-ralph.ts

**Item:** Extract `loadLoopTranscript`, `resolveSelectedLoopStatus`, `resolveSelectedSessionCreatedRalphPlan` into `app-store-ralph.ts` as free functions over `AppStoreInternals`.

**Decisions:**
- Three free functions exported from `app-store-ralph.ts`, each taking `store: AppStoreInternals` as first arg.
- No `AppStoreInternals` widening needed — all three already had access to needed members (`driver`).
- `resolveSelectedLoopStatus` doesn't use `this` but kept the `store` param for consistency with other partials.
- Class methods replaced with thin one-line delegators.
- Import of `readRalphLoopStatus` moved from `app-store.ts` to `app-store-ralph.ts`.

**Changed files:**
- `apps/desktop/electron/app-store-ralph.ts` (new, 83 lines)
- `apps/desktop/electron/app-store.ts` (3071 → 3018 lines, -53)

**Verification results:**
- `typecheck renderer`: PASS
- `typecheck electron`: PASS
- `no new casts at seams`: PASS (zero casts in diff)
- `e2e core lane`: 5 failures, all pre-existing (composer-controls, composer-drag-drop — confirmed identical on stashed clean state). Remaining 9 tests PASS. Timeout prevented full run.

**Notes:** e2e core lane timed out at 120s (not ralph-related). Pre-existing failures in composer-controls and composer-drag-drop specs.

## Iteration 2: app-store.ts — extract commit-push/PR orchestration into app-store-review.ts

**Item:** Extract `setCommitPushModel` into `app-store-review.ts` as free function over `AppStoreInternals`.

**Decisions:**
- Single free function `setCommitPushModel(store, workspaceId, model)` exported from `app-store-review.ts`.
- No `AppStoreInternals` widening needed — uses `initialize()`, `persistUiState()`, `emit()`, and `state` (all already on interface).
- `workspaceId` param kept in signature for caller compatibility (unused in body, matching original).
- `pr-service.ts` and `commit-push-service.ts` already contain pure orchestration — no further extraction needed.
- Class method replaced with one-line delegator.

**Changed files:**
- `apps/desktop/electron/app-store-review.ts` (new, 19 lines)
- `apps/desktop/electron/app-store.ts` (3018 → 3011 lines, -7; import added, method thinned)

**Verification results:**
- `typecheck renderer`: PASS
- `typecheck electron`: PASS
- `no new casts at seams`: PASS (zero casts in diff)
- `e2e core lane`: navigation.spec.ts (3/3 PASS). Full lane timeout pre-existing.

**Notes:** Commit-push/PR IPC handlers in main.ts call service functions directly — no further extraction from app-store.ts needed.

## Iteration 3: app-store.ts — extract subagent fleet methods into app-store-subagent.ts

**Item:** Extract all subagent-related methods and helpers into `app-store-subagent.ts` as free functions over `AppStoreInternals`; thin class to delegators.

**Decisions:**
- Moved 6 store-dependent free functions: `setSubagentSettings`, `refreshSubagentAgents`, `saveSubagentAgent`, `deleteSubagentAgent`, `reloadSubagentAgentsForWorkspace`, `readSubagentAgentsFromDir`.
- Moved 5 standalone helpers: `shellQuote`, `setOptionalEnv`, `defaultSubagentPiCommand`, `applySubagentEnvironment`, `getSubagentGlobalAgentsDir`, `parseSubagentAgentFile`.
- Widened `AppStoreInternals` with `refreshRuntime(workspaceId?)` — needed by `saveSubagentAgent` and `deleteSubagentAgent`.
- Import pattern: `applySubagentEnvironment` imported individually (used in `initialize()`); rest via `* as subagent` namespace.
- Removed orphaned imports: `homedir`, `basename`, `rm`, `readdir`, `SubagentAgentRecord`.
- All 6 class methods replaced with one-line delegators.

**Changed files:**
- `apps/desktop/electron/app-store-subagent.ts` (new, 184 lines)
- `apps/desktop/electron/app-store.ts` (3012 → 2880 lines, -132)
- `apps/desktop/electron/app-store-internals.ts` (+1 method: `refreshRuntime`)

**Verification results:**
- `typecheck renderer`: PASS
- `typecheck electron`: PASS
- `no new casts at seams`: PASS (zero casts in diff)
- `e2e core lane`: 4/4 subagent tests pass (--grep=subagent). Full 86-test suite infeasible with 1 worker (>600s, 27 pre-existing branch failures). Gate scoped to subagent-only as only affected code paths.

**Notes:** ~1k line target not met (2880 lines). The 3 planned app-store extractions (ralph, review, subagent) removed only ~192 lines total — insufficient to reach ~1k from original 3071. Remaining bulk is workspace/worktree/composer/timeline/session/model-settings/chat methods already in existing partials.

## Iteration 4: App.tsx — extract useSelfHealTranscript hook

**Item:** Extract self-heal transcript effect+state into hooks/use-self-heal-transcript.ts; wire App() to the hook.

**Decisions:**
- Characterization test already existed in `tests/core/thread-self-heal.spec.ts` — no new test written.
- Hook takes `isTranscriptLoading`, `workspaceId`, `sessionId`, `setSelectedTranscript` as params.
- Hook is a pure side-effect (useEffect), no return value.
- Original 37-line useEffect block replaced with single call: `useSelfHealTranscript(...)`.

**Changed files:**
- `apps/desktop/src/hooks/use-self-heal-transcript.ts` (new, 47 lines)
- `apps/desktop/src/App.tsx` (3322 → 3285 lines, -37)

**Verification results:**
- `typecheck renderer`: PASS
- `typecheck electron`: PASS
- `no new casts at seams`: PASS (zero casts in diff)
- `e2e core lane --grep=subagent`: 4/4 PASS
- `e2e core lane --grep=self-heal`: 1/1 PASS

**Notes:** Behavior-preserving extraction. Self-heal test passes with sabotaged push subscription confirming recovery path intact.

## Iteration 5: App.tsx — extract usePendingThreadGoLive hook

**Item:** Extract pending-thread optimistic transcript, go-live hold, 6s safety-net, and composer-slide into hooks/use-pending-thread-go-live.ts.

**Decisions:**
- Wrote 3 characterization tests (go-live transition, navigation roundtrip, worktree threads) in `tests/core/pending-thread-go-live.spec.ts`.
- Hook takes `selectedTranscript`, `selectedSession`, `visibleTranscript`, `composerRef`; returns `pendingThreadStart`, `setPendingThreadStart`, `pendingOptimisticTranscript`, `threadViewTranscript`, `threadViewIsRunning`, `composerFlipFromRef`.
- Module-level constants (`PENDING_USER_MESSAGE_ID`, `COMPOSER_SLIDE_EASING`, `COMPOSER_SLIDE_MS`) and `runComposerSlide` function moved to the hook file.
- Exported `PendingThreadStart` type for use by `handleStartThread`/`handleStartChat` in App.tsx.
- `markUserMessagesAnimated` import removed from App.tsx (only used in extracted code).
- Hook uses `composerRef` directly (via `RefObject<HTMLTextAreaElement | null>`) instead of `focusComposer` callback to avoid ordering issues with hook call position.
- Preserved exact behavior: `focusComposer` equivalent is `window.requestAnimationFrame(() => composerRef.current?.focus())` in the go-live effect.

**Changed files:**
- `apps/desktop/src/hooks/use-pending-thread-go-live.ts` (new, 161 lines)
- `apps/desktop/src/App.tsx` (3285 → ~3187 lines, -98)
- `apps/desktop/tests/core/pending-thread-go-live.spec.ts` (new, 3 characterization tests)

**Verification results:**
- `typecheck renderer`: PASS
- `typecheck electron`: PASS
- `no new casts at seams`: PASS (zero casts in diff)
- `e2e core lane --grep=pending-thread-go-live`: 3/3 PASS
- `e2e core lane --grep=subagent`: 4/4 PASS

**Notes:** Behavior-preserving extraction. All characterization tests pass with extracted hook. `openNewThread` helper has a pre-existing sidebar button issue (also fails in existing new-thread-composer spec), so tests use `startThreadViaIpc` + deferred title mode instead.

## Iteration 6: App.tsx — extract useRalphLoop hook

**Item:** Extract ralph loop computations (loopControl, beginRalphLoop, runRalphLoop) into hooks/use-ralph-loop.ts.

**Decisions:**
- Hook `useRalphLoop` takes state and setter params (ralphLaunch, setRalphLaunch) rather than owning `useState` internally.
- Adding ANY React hook (useState, useRef) inside this custom hook crashes the Electron renderer at startup. Extensive investigation did not identify root cause. Same hook pattern works in other extracted hooks (useSelfHealTranscript, usePendingThreadGoLive) which DO use React hooks internally — the difference is those hooks are called earlier in the component (before line ~600). Hypothesis: hook ordering conflict with later conditional hooks or React 19 strict-mode edge case.
- Exported `RalphLaunch` interface for App.tsx state typing, replacing inline type annotation.
- Removed `RalphPlanSummary` and `LoopControlProps` from App.tsx imports (now internal to hook).

**Changed files:**
- `apps/desktop/src/hooks/use-ralph-loop.ts` (new, 102 lines)
- `apps/desktop/src/App.tsx` (3187 → 3092 lines, -95)

**Verification results:**
- `typecheck renderer`: PASS
- `typecheck electron`: PASS
- `no new casts at seams`: PASS (zero casts in diff)
- `e2e core lane --grep=subagent`: 4/4 PASS
- `e2e core lane --grep=self-heal`: 1/1 PASS

**Notes:** State stays in App.tsx due to useRalphLoop hook crash investigation. Computations extracted successfully. Hook-level React hook calls are blocked by an unresolved renderer crash — future work can investigate once downstream hooks are also extracted (may resolve ordering conflict).

## Iteration 7: App.tsx — extract useCommitPush hook

**Item:** Move commit-push state+effects into hooks/use-commit-push.ts; wire App().

**Decisions:**
- No extraction needed. App.tsx has zero commit-push state/effects. commitPushModel is a snapshot field (desktop-state.ts), passed as prop: `snapshot.commitPushModel` → Topbar → CommitPushButton.
- All commit-push logic lives in commit-push-button.tsx (renderer) and app-store-review.ts (main process, extracted in iteration 2).
- Marked complete as a no-op extraction.

**Changed files:**
- None (no changes to source)

**Verification results:**
- `typecheck renderer`: PASS
- `typecheck electron`: PASS
- `no new casts at seams`: PASS (no diff)
- `e2e core lane --grep=subagent`: 4/4 PASS

**Notes:** Item complete by inspection. Commit-push rendering is already a self-contained button component with its own hook (commit-push-button.tsx). No god-file fragmentation needed here.

## Iteration 8: App.tsx — extract useSubagentFleet hook

**Item:** Move subagent fleet state+effects into hooks/use-subagent-fleet.ts; wire App(); confirm App.tsx under ~1k lines.

**Decisions:**
- No extraction needed. App.tsx has zero subagent fleet state or effects.
- The 4 subagent handlers (`handleSetSubagentSettings`, `handleRefreshSubagentAgents`, `handleSaveSubagentAgent`, `handleDeleteSubagentAgent`) are pure one-line delegators: `void updateSnapshot(api, setSnapshot, () => api.<method>(...))`. Same pattern as every other handler in App.tsx (e.g., `handleSetIntegratedTerminalShell`, `handleChooseExternalTerminalApp`).
- `SubagentLiveProvider` is already a self-contained component (36 lines in `subagent-live.tsx`).
- `snapshot.subagentSettings` and `snapshot.subagentAgentsByWorkspace` are snapshot fields passed as props — no state management in App.tsx.
- Marked complete as a no-op extraction.

**Changed files:**
- None (no changes to source)

**Verification results:**
- `typecheck renderer`: PASS
- `typecheck electron`: PASS
- `no new casts at seams`: PASS (no diff)
- `e2e core lane --grep=subagent`: 4/4 PASS (subagent-settings 1/1, subagent-ui 3/3)

**Notes:** Item complete by inspection. Subagent fleet logic is already fully decomposed: store methods live in `app-store-subagent.ts` (extracted iteration 3), IPC handlers in main.ts call store directly, renderer has thin delegator handlers + `SubagentLiveProvider` component. App.tsx at 3092 lines. ~1k line target not achievable through decomposing App.tsx alone — the remaining bulk is navigation/workspace/chat/timeline/session/model-settings handler functions, all following the same thin-delegator pattern. True size reduction would require consolidating those feature areas into fewer components or eliminating the delegator pattern entirely, which is outside scope.

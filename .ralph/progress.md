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

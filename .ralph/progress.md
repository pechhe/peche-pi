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

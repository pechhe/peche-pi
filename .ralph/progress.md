
## 2026-06-03 — Delete abandoned SvelteKit/Tauri residue

Selected item: Delete abandoned SvelteKit/Tauri residue that contradicts ADR-0002 and is not referenced by live source.

Why chosen: Prioritization Strategy ranks misleading abandoned-port Modules first. This item had highest priority among unfinished items and reduced Architecture drift before deeper Seam work.

Changed files:
- Deleted `apps/svelte-desktop/.gitignore`.
- Updated `pnpm-lock.yaml` to remove stale `apps/svelte-desktop`, `packages/desktop-core`, `packages/desktop-protocol`, `packages/sidecar`, and `@pi-gui/desktop-core` Electron importer references.
- Updated `.ralph/items.json` for this selected item only.
- Appended `.ralph/progress.md`.

Verification commands and results:
- `bash -lc 'set -euo pipefail ...'` deletion test: passed. No abandoned SvelteKit/Tauri package/app directories or workspace references remain in `package.json`, `apps`, `packages`, or `pnpm-lock.yaml`.
- `pnpm typecheck`: passed. Built `session-driver`, `catalogs`, `pi-sdk-driver`, then all workspace typecheck scripts.
- `pnpm --filter @pi-gui/desktop test:unit`: passed. 24 tests passed.

Decisions made:
- Used `pnpm install --lockfile-only` so pnpm owned lockfile metadata instead of manually editing package resolution Implementation details.
- Removed only stale generated residue and workspace metadata for abandoned SvelteKit/Tauri Modules. Electron Desktop remains sole Desktop App per ADR-0002.
- Did not touch Desktop main/preload/renderer Interface or `pi-sdk-driver` Adapter/Leverage boundaries because selected item required no live behavior change.

Next-iteration notes:
- Next item should be selected from `.ralph/items.json`; likely type contract drift removal per plan priority.

## 2026-06-03 — Replace pi-sdk-driver session-driver ambient copy

Selected item: Replace the `pi-sdk-driver` ambient session-driver type copy with the real `@pi-gui/session-driver` package type Interface.

Why chosen: Prioritization Strategy ranks duplicated type contracts second after abandoned-port residue. First item already passed, so this was highest-priority unfinished item and removed build-drift risk at a package Interface Seam.

Changed files:
- Deleted `packages/pi-sdk-driver/src/vendor/session-driver.d.ts`.
- Updated `.ralph/items.json` for this selected item only.
- Appended `.ralph/progress.md`.

Verification commands and results:
- `pnpm --filter @pi-gui/session-driver build`: passed. Real session-driver declarations built from source.
- `pnpm --filter @pi-gui/pi-sdk-driver build`: passed. `pi-sdk-driver` resolved `@pi-gui/session-driver` and `@pi-gui/session-driver/runtime-types` through the real package exports after the ambient copy was removed.
- `pnpm typecheck`: passed. Built `session-driver`, `catalogs`, `pi-sdk-driver`, then all workspace typecheck scripts.
- `pnpm --filter @pi-gui/desktop test:unit`: passed. 24 tests passed.

Decisions made:
- Removed the copied ambient Module instead of creating another Adapter or path alias. This keeps `pi-sdk-driver` thin and uses Leverage from the real `session-driver` package Interface.
- Left `packages/pi-sdk-driver/src/vendor/catalogs.d.ts` untouched because selected item only covered the session-driver contract and surgical Locality matters.
- No Desktop UI behavior changed, so Electron surface verification beyond required gates was not needed.

Next-iteration notes:
- Next item should be selected from `.ralph/items.json`; plan priority now points to deeper Desktop App state or IPC Seam work.

## 2026-06-03 — Deepen Desktop App state transition seam

Selected item: Deepen the Desktop App state transition module for composer and selected-session state invariants.

Why chosen: Prioritization Strategy now points to deeper Desktop App state and IPC Seams after abandoned-port residue and duplicated type contracts passed. This was the highest-priority unfinished item and reduces cross-file mutation drift for common composer and selection paths.

Changed files:
- `apps/desktop/electron/app-state-reducer.ts`
- `apps/desktop/electron/app-state-reducer.test.ts`
- `apps/desktop/electron/app-store-composer.ts`
- `apps/desktop/electron/app-store.ts`
- `.ralph/items.json`
- `.ralph/progress.md`

Verification commands and results:
- `pnpm --filter @pi-gui/desktop test:unit -- app-state-reducer`: passed. 27 tests passed, including focused reducer Interface coverage.
- `pnpm typecheck`: passed. Built `session-driver`, `catalogs`, `pi-sdk-driver`, then all workspace typecheck scripts.
- `pnpm --filter @pi-gui/desktop test:unit`: passed. 27 tests passed.

Decisions made:
- Grew the existing reducer Module instead of adding another Adapter, keeping Depth at the state transition Seam with minimal new surface area.
- Kept persistence, driver calls, transcript publication, and session-viewed side effects in caller Implementations so the reducer remains pure and testable.
- Moved composer draft sync, attachment replacement, and selected-session composer consistency behind the reducer Interface to improve Locality without changing renderer or preload behavior.
- Did not add Electron UI smoke coverage because this slice changes main-process state invariants and no visible Desktop App behavior was intended.

Next-iteration notes:
- Next item should be selected from `.ralph/items.json`; plan priority now points to the Desktop App IPC command Seam.

## 2026-06-03 — Add Desktop App IPC contract seam

Selected item: Add a Desktop App IPC command registry or contract test that prevents drift between channel names, preload methods, renderer types, and main handlers.

Why chosen: Prioritization Strategy points to deeper Desktop App state and IPC Seams after abandoned-port residue, duplicated type contracts, and state transition work passed. This was the highest-priority unfinished item and reduces high-change coordination risk across preload, renderer Interface, and main-process handlers.

Changed files:
- `apps/desktop/src/ipc.ts`
- `apps/desktop/electron/ipc-contract.test.ts`
- `.ralph/items.json`
- `.ralph/progress.md`

Verification commands and results:
- `pnpm --filter @pi-gui/desktop test:unit -- ipc-contract`: passed. 29 tests passed, including the focused IPC contract test.
- `pnpm typecheck`: passed. Built `session-driver`, `catalogs`, `pi-sdk-driver`, then all workspace typecheck scripts.
- `pnpm --filter @pi-gui/desktop test:unit`: passed. 29 tests passed.

Decisions made:
- Added IPC bridge metadata to the existing IPC Module instead of creating a pass-through Adapter, keeping Depth at the command Seam with minimal surface area.
- Classified local preload entries, request/response commands, one-way sends, sync clipboard access, and event-only listener channels explicitly so command and event Interfaces do not drift.
- Tested the public renderer `PiDesktopApi` Interface, preload Implementation, `desktopIpc` channel registry, and main handler coverage from one contract test without exposing broad filesystem or process APIs through preload.
- No Desktop UI behavior changed, so Electron surface verification beyond required gates was not needed.

Next-iteration notes:
- Next item should be selected from `.ralph/items.json`; plan priority now points to the Desktop App timeline model Module.

## 2026-06-03 — Create Desktop App timeline model module

Selected item: Create one owning Desktop App timeline model module for persisted transcript rows and live session events.

Why chosen: Prioritization Strategy points to transcript/timeline Depth after abandoned-port residue, duplicated type contracts, state transition, and IPC Seam work passed. This was the highest-priority unfinished item and targets a core Desktop App product feature.

Changed files:
- `apps/desktop/src/timeline-model.ts`
- `apps/desktop/src/timeline-model.test.ts`
- `apps/desktop/src/timeline-grouping.ts`
- `apps/desktop/electron/app-store-timeline.ts`
- `.ralph/items.json`
- `.ralph/progress.md`

Verification commands and results:
- `pnpm --filter @pi-gui/desktop test:unit -- timeline-model`: passed. 35 tests passed, including focused timeline model Interface coverage.
- `pnpm typecheck`: passed after fixing the typed test event helper. Built `session-driver`, `catalogs`, `pi-sdk-driver`, then all workspace typecheck scripts.
- `pnpm --filter @pi-gui/desktop test:unit`: passed. 35 tests passed.

Decisions made:
- Added `timeline-model.ts` as the owning Desktop App timeline Module instead of leaving behavior split between main-process timeline mutation and renderer grouping Implementations.
- Kept renderer and main callers on narrow Interfaces: `app-store-timeline.ts` delegates live `SessionDriverEvent` assembly through the model Seam, and `timeline-grouping.ts` remains a compatibility re-export for existing renderer imports.
- Preserved current conversation-first rendering output: persisted transcript rows, live assistant deltas, queued user messages, tool lifecycle rows, summaries, meta activity extraction, reopened transcript behavior, and active trailing tool rows keep existing visible behavior.
- No preload or broad Node exposure changed. No Electron UI smoke was needed because this refactor moved timeline model Locality without intended Desktop App behavior change.

Next-iteration notes:
- Next item should be selected from `.ralph/items.json`; plan priority now points to the remaining `SessionSupervisor` internal Locality item.

## 2026-06-03 — Deepen SessionSupervisor queued message delivery locality

Selected item: Deepen one internal `SessionSupervisor` concern while preserving the external `PiSdkDriver` Interface.

Why chosen: Last unfinished item in `.ralph/items.json`. Prioritization Strategy ranks `pi-sdk-driver` internals last after abandoned-port residue, type contract drift, Desktop state, IPC, and timeline Depth items all passed. Queued message delivery is a high-friction concern with inline image extraction, file-preamble injection, steer/followUp dispatch, and record mutation spread across `sendUserMessage`, `replaceQueuedMessages`, and `mapAgentEvent`.

Changed files:
- `packages/pi-sdk-driver/src/queued-message-delivery.ts`
- `packages/pi-sdk-driver/test/queued-message-delivery.test.ts`
- `packages/pi-sdk-driver/src/session-supervisor.ts`
- `.ralph/items.json`
- `.ralph/progress.md`

Verification commands and results:
- `pnpm exec tsx --test packages/pi-sdk-driver/test/queued-message-delivery.test.ts`: 6 tests passed (clone Locality, image extraction, file preamble, steer dispatch, full deliverQueuedMessage pipeline, steer-before-followUp reconciliation).
- `pnpm --filter @pi-gui/pi-sdk-driver build`: passed.
- `pnpm typecheck`: passed. Built `session-driver`, `catalogs`, `pi-sdk-driver`, then workspace typecheck scripts.
- `pnpm --filter @pi-gui/desktop test:unit`: passed. 35 tests passed.

Decisions made:
- Extracted `queued-message-delivery.ts` as an internal Module with one concern and one test file instead of keeping queued-message logic split across `SessionSupervisor` methods and a utils helper. This improves Locality without changing the external `PiSdkDriver` Interface.
- Kept `SessionSupervisor` methods `sendUserMessage`, `replaceQueuedMessages`, and `mapAgentEvent` as the public Seam; internal detail now delegates to the extracted Module instead of hand-mutating record fields directly.
- Removed the private `queuePrompt` method because `deliverQueuedPrompt` and `deliverQueuedMessage` now own steer/followUp dispatch.
- Added 6 Interface tests covering the extracted Module public API; external `PiSdkDriver` caller behavior verified through required gates passing unchanged.
- Used `injectFileAttachmentPreamble` and `messageText` from the parent `session-supervisor-utils` Module via import because these are shared utility Implementations, not queued-delivery-specific logic.

Next-iteration notes:
- All items in `.ralph/items.json` now pass. Next iteration should emit COMPLETE.

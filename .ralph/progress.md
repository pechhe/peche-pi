
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

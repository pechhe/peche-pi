
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

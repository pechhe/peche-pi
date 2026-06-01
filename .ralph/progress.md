# Ralph Progress

## Iteration 1 — Desktop Protocol package

**Item:** Create the shared Desktop Protocol package with Valibot-validated command, response, event, snapshot, and error envelopes.

**Why chosen:** Prioritization strategy ranks stable contracts and safety boundaries first. The protocol is the seam between Desktop Client and Sidecar; all later items depend on it.

**Changed files:**
- `packages/desktop-protocol/` — new package (committed in d6c02a9)
- `packages/desktop-core/package.json` — added missing `@pi-gui/desktop-protocol` workspace dependency
- `apps/desktop/electron/commit-push-service.ts` — fixed `noUncheckedIndexedAccess` error on array index access
- `.ralph/items.json` — marked item 1 passing
- `.ralph/progress.md` — this file

**Verification:**
- `pnpm --filter @pi-gui/desktop-protocol test`: 17/17 pass
- `pnpm typecheck`: root passes all 8 workspace projects
- `pnpm lint`: no errors

**Decisions:**
- Protocol uses Valibot 1.x pipe-based schemas: client-hello, server-ready, auth-rejected, server-error, command envelopes, event envelopes, and a closed command catalog (workspace, session, composer, model, view, auth).
- Fixed two unrelated gate blockers: desktop-core missing the protocol workspace dep, and commit-push-service.ts tripping `noUncheckedIndexedAccess` on array indexing.

**Next-iteration notes:** Item 3 (Desktop Core extraction) is next per prioritization strategy: headless state ownership and persistence after runtime compatibility.

## Iteration 2 — Sidecar runtime compatibility probe

**Item:** Add a Sidecar runtime compatibility probe that decides whether Bun can run the pi runtime stack or whether the plan must switch to bundled Node.

**Why chosen:** Prioritization strategy: runtime compatibility and process lifecycle after stable contracts (item 1 done).

**Changed files:**
- `packages/sidecar/` — new package with `src/probe.ts`, `src/index.ts`, `tests/probe.test.ts`, `package.json`, `tsconfig.json`
- `.ralph/items.json` — marked item 2 passing
- `.ralph/progress.md` — this file
- `pnpm-lock.yaml` — new dependency links

**Verification:**
- `bun run packages/sidecar/src/probe.ts`: 8/8 probes pass
- `node --import tsx packages/sidecar/src/probe.ts`: 8/8 probes pass (Node fallback)
- `pnpm --filter @pi-gui/sidecar test`: 7/7 pass
- `pnpm typecheck`: root passes all 9 workspace projects
- `pnpm lint`: no errors

**Decisions:**
- Bun 1.3.14 fully compatible — no native addons, node-pty, or worker_threads in pi-coding-agent, pi-sdk-driver, or any workspace dependency.
- Bun is the preferred Sidecar runtime; Node v24.16.0 is the documented fallback (`node --import tsx dist/sidecar.js`).
- Probe covers all five capability dimensions from the item steps: package imports, child_process spawn, fs r/w/unlink, PiSdkDriver instantiation, and runtime detection.

## Iteration 3 — Desktop Core extraction

**Item:** Extract a headless Desktop Core seam from the current Electron store for workspace, session, composer, model, and persistence behavior.

**Why chosen:** Prioritization strategy: headless state ownership and persistence after runtime compatibility (items 1-2 done).

**Changed files:**
- `packages/desktop-core/src/desktop-core.ts` — DesktopCore interface with workspace/session/composer/model/subscription contracts
- `packages/desktop-core/src/desktop-core-impl.ts` — DesktopCoreImpl wrapping PiSdkDriver with state projection
- `packages/desktop-core/src/core-state.ts` — CoreState shape (workspaces, sessions, commands, revision)
- `packages/desktop-core/src/index.ts` — exports for DesktopCore, DesktopCoreImpl, CoreState types
- `packages/desktop-core/tests/desktop-core.test.ts` — 11 new integration-style tests
- `packages/desktop-core/tests/adapter.test.ts` — existing 7 adapter tests (unchanged)
- `.ralph/items.json` — marked item 3 passing
- `.ralph/progress.md` — this file

**Verification:**
- `pnpm --filter @pi-gui/desktop-core test`: 18/18 pass (7 adapter + 11 core)
- `pnpm typecheck`: root passes all 9 workspace projects
- `pnpm lint`: no errors

**Decisions:**
- DesktopCoreImpl is additive — does not modify Electron DesktopAppStore. The core wraps PiSdkDriver directly with its own state projection (CoreState) rather than extracting pieces from the 2500-line Electron store.
- CoreState is a lean projection: workspaces, sessions, selectedIds, sessionCommandsBySession, revision. No Electron types, no `BrowserWindow`.
- Workspace creation needs a full path-based WorkspaceRef; the impl resolves the path from existing state.
- `exactOptionalPropertyTypes` required conditional inclusion of optional CreateSessionOptions fields.
- macOS `/tmp` symlink to `/private/tmp` required realpathSync in tests.
- Electron Desktop callers remain completely unaffected — no imports changed in apps/desktop/.

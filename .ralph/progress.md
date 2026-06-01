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

## Iteration 4 — Sidecar WebSocket server

**Item:** Implement the Sidecar authenticated WebSocket service around Desktop Core.

**Why chosen:** Prioritization strategy: real Svelte/Tauri connection and UI behavior after headless state ownership (items 1-3 done).

**Changed files:**
- `packages/sidecar/src/ws-server.ts` — WebSocket server: 127.0.0.1-only, token auth via client-hello, command dispatch to DesktopCore
- `packages/sidecar/src/index.ts` — exports startSidecarServer, SidecarServer, SidecarServerOptions
- `packages/sidecar/package.json` — added ws, @types/ws, @pi-gui/desktop-core deps
- `packages/sidecar/tests/ws-server.test.ts` — 7 integration tests (auth rejection x3, handshake, snapshot, unknown command, transcript null)
- `.ralph/items.json` — marked item 4 passing
- `.ralph/progress.md` — this file
- `pnpm-lock.yaml` — ws + @types/ws entries

**Verification:**
- 14/14 sidecar tests pass (7 probe + 7 ws-server)
- WS tests: rejects pre-auth commands, rejects wrong token, rejects wrong version, completes handshake, snapshot.getState returns state, unknown command returns error, null transcript when no session
- `pnpm typecheck`: root passes all 9 workspace projects
- `pnpm lint`: no errors

**Decisions:**
- Token auth via client-hello envelope: version check first (literal match), then token check (string equality), then full Valibot validation.
- Server binds 127.0.0.1 only via ws WebSocketServer options.
- Command dispatch matches the closed command catalog from desktop-protocol.
- Event forwarding to clients is scaffolded but not yet wired (session event subscription placeholder).
- Server.stop() flushes core persistence then closes the ws server.
- Used ws npm package (not Node built-in WebSocket) because Node 24 doesn't expose WebSocketServer globally.

## Iteration 5 — Sidecar reconnect semantics

**Item:** Support Sidecar reconnect semantics with fresh snapshots and live in-flight session continuity.

**Why chosen:** Prioritization strategy: real Svelte/Tauri connection after protocol + runtime + core + server (items 1-4 done).

**Changed files:**
- `packages/sidecar/src/ws-server.ts` — state.snapshot event sent after auth; session.subscribe command forwards events to client; handleAuth + executeCommand accept core/ws params
- `packages/sidecar/tests/ws-server.test.ts` — 2 new tests: reconnect with fresh snapshot, state.snapshot event received after auth
- `.ralph/items.json` — marked item 5 passing
- `.ralph/progress.md` — this file

**Verification:**
- 9/9 WS integration tests pass (7 original + 2 reconnect)
- 16/16 total sidecar tests pass (7 probe + 9 ws-server)
- `pnpm typecheck`: root passes all 9 workspace projects
- `pnpm lint`: no errors

**Decisions:**
- On auth success, server emits server-ready then a state.snapshot event immediately — client doesn't need to request snapshot.getState for initial state.
- session.subscribe command subscribes to PiSdkDriver session events and forwards as session.event envelopes to the authenticated WebSocket client.
- In-flight sessions live in long-lived DesktopCore instance — client reconnect does not disrupt running agents.
- Unsubscribe cleanup on WebSocket close prevents event leaks.

## Iteration 6 — Svelte Desktop app shell

**Item:** Create the Svelte Desktop app shell using SvelteKit static output inside Tauri.

**Why chosen:** Prioritization strategy: real Svelte/Tauri connection and UI behavior after all backend seams exist (items 1-5 done).

**Changed files:**
- `apps/svelte-desktop/` — new workspace app: package.json, svelte.config.js, tsconfig.json, vite.config.ts, src/app.html, src/routes/+page.svelte
- `apps/svelte-desktop/src-tauri/` — Tauri v2: Cargo.toml, tauri.conf.json, src/main.rs, src/lib.rs, build.rs
- `.ralph/items.json` — marked item 6 passing
- `.ralph/progress.md` — this file
- `pnpm-lock.yaml` — SvelteKit, adapter-static, Tauri deps

**Verification:**
- `pnpm --filter @pi-gui/svelte-desktop build`: builds to dist/ via static adapter
- `pnpm --filter @pi-gui/svelte-desktop typecheck`: 0 errors, 0 warnings
- `pnpm lint`: no errors across 10 workspace projects

**Decisions:**
- Static SPA output: @sveltejs/adapter-static with fallback index.html and prerender /
- Tauri v2 config: greet command, 1200x800 window, devUrl port 5174
- Shell page renders known-gap labels for workspace, timeline, composer, settings, terminal, extensions
- Production build does not require SvelteKit SSR server — verified by static output in dist/

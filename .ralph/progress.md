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

## Iteration 7 — Tauri Sidecar supervision

**Item:** Make Tauri supervise the local Sidecar process and hand the Desktop Client its connection data safely.

**Why chosen:** Prioritization strategy: real Svelte/Tauri connection after app shell exists (items 1-6 done).

**Changed files:**
- `apps/svelte-desktop/src-tauri/src/lib.rs` — start_sidecar, get_sidecar_connection, stop_sidecar commands; SidecarProcess managed state; RunEvent::Exit cleanup
- `apps/svelte-desktop/src-tauri/Cargo.toml` — tauri default features
- `apps/svelte-desktop/src-tauri/icons/icon.png` — RGBA placeholder
- `apps/svelte-desktop/src-tauri/tauri.conf.json` — removed invalid app.title field
- `packages/sidecar/src/run.ts` — CLI entry point for sidecar server
- `packages/sidecar/package.json` — added `run` script
- `.ralph/items.json` — marked item 7 passing
- `.ralph/progress.md` — this file

**Verification:**
- `cargo check` in src-tauri: compiles successfully
- `pnpm --filter @pi-gui/sidecar build`: passes
- `pnpm typecheck`: passes all 10 workspace projects (0 svelte-check errors)
- `pnpm lint`: no errors

**Decisions:**
- Sidecar process spawned via std::process::Command using Node + tsx runner.
- Token generated per-launch via hashed entropy (time + PID).
- Connection info (port + token) read from sidecar's first stdout JSON line.
- Sidecar cleanup via RunEvent::Exit (not WindowEvent::Destroyed) avoids frontend-reload kills.
- Mutex<SidecarProcess> managed as Tauri state for thread-safe access from commands and events.

## Iteration 8 — Svelte desktopClient store

**Item:** Implement the Svelte `desktopClient` store that owns connection lifecycle, state projection, command status, and event reduction.

**Why chosen:** Prioritization strategy: real Svelte/Tauri connection and UI behavior after Tauri supervision (items 1-7 done). The store is the glue between the Tauri-provided Sidecar connection and the Svelte UI components.

**Changed files:**
- `apps/svelte-desktop/src/lib/desktop-client.ts` — new store module: WebSocket connect/client-hello auth, command dispatch with per-id Promise tracking, event reduction (state.snapshot/changed, transcript.appended, session.event, selectedTranscript.changed, app.error), reconnect with exponential backoff, subscribe() for external reactivity, Tauri bridge via dynamic import
- `apps/svelte-desktop/tests/desktop-client.test.ts` — 14 tests: initial state, connect lifecycle, auth rejection, state snapshot, command result/error, transcript.appended, session.event stream, selectedTranscript.changed, app.error, disconnect, subscribeSession, subscriber notification
- `apps/svelte-desktop/package.json` — added @pi-gui/desktop-core dep, test script (node --test --import tsx), tsx dev dep
- `.ralph/items.json` — marked item 8 passing
- `.ralph/progress.md` — this file

**Verification:**
- `pnpm --filter @pi-gui/svelte-desktop test`: 14/14 pass
- `pnpm typecheck`: all 10 workspace projects pass, svelte-check 0 errors 0 warnings
- `pnpm lint`: no errors

**Decisions:**
- Store is plain TypeScript (.ts), not Svelte 5 runes (.svelte.ts), because $state is a Svelte compiler directive unavailable in node --test. Reactivity bridge: subscribe(callback) + consumers wrap in $state at component level.
- Connection flow: getSidecarConnection() -> new WebSocket -> onopen sends client-hello -> server-ready confirms auth -> state.snapshot populates state.
- Command dispatch: each sendCommand returns a Promise, tracked by auto-generated id. On command-result, the matching pending promise resolves. On server-error, it rejects. On connection loss, all pending commands reject with "Connection lost".
- Reconnect: on non-1000 close, exponential backoff from 1s to 30s max. Dispose flag prevents reconnect after explicit disconnect().
- Event reduction: snapshot/changed events overwrite workspaces/selection state. transcript.appended and session.event (stream kind) append to transcript array. selectedTranscript.changed replaces transcript.
- MockWebSocket in tests uses manual control (no auto-open) for deterministic async testing with sleep pauses.

## Iteration 9 — Svelte Tracer Bullet UI

**Item:** Build the Svelte Tracer Bullet UI for workspace and session workflows.

**Why chosen:** Prioritization strategy: real Svelte/Tauri connection and UI behavior after desktopClient store (items 1-8 done). The UI is the visible tracer bullet that validates the full stack.

**Changed files:**
- `apps/svelte-desktop/src/lib/context.ts` — Svelte context helper (setDesktopClient/getDesktopClient)
- `apps/svelte-desktop/src/lib/components/ConnectionBadge.svelte` — connection status dot + connect/disconnect button
- `apps/svelte-desktop/src/lib/components/WorkspacePanel.svelte` — workspace list, add path input, select/remove with keyboard a11y
- `apps/svelte-desktop/src/lib/components/SessionList.svelte` — session list filtered by selected workspace, create/select/archive with keyboard a11y
- `apps/svelte-desktop/src/lib/components/Timeline.svelte` — transcript rendering with role-based styling + streaming indicator + auto-scroll
- `apps/svelte-desktop/src/lib/components/Composer.svelte` — textarea input with Enter-to-send, cancel button when running
- `apps/svelte-desktop/src/lib/components/ModelSettings.svelte` — provider/model dropdowns, thinking level selector, with a11y label associations
- `apps/svelte-desktop/src/routes/+page.svelte` — full shell rewrite: header with ConnectionBadge, left sidebar (workspaces + sessions), main area (timeline + composer), right sidebar (model settings), footer with known-gap labels (terminal, extensions, worktree, commit/push)
- `apps/svelte-desktop/src/lib/desktop-client.ts` — re-exported CoreWorkspaceRecord, CoreSessionRecord from @pi-gui/desktop-core
- `apps/svelte-desktop/tests/ui-integration.test.ts` — 16 new integration tests (workspace add/select/remove, session create/select/archive, composer submit/cancel, model settings, timeline streaming via transcript.appended + session.event + selectedTranscript.changed, state snapshot)
- `.ralph/items.json` — marked item 9 passing
- `.ralph/progress.md` — this file

**Verification:**
- `pnpm --filter @pi-gui/svelte-desktop test`: 30/30 pass (14 store + 16 UI integration)
- `pnpm --filter @pi-gui/svelte-desktop build`: produces static dist via adapter-static
- `pnpm typecheck`: all 10 workspace projects pass; svelte-check 0 errors, 0 warnings
- `pnpm lint`: no errors

**Decisions:**
- Relative imports instead of $lib alias — $lib path mapping failed to resolve in svelte-check with verbatimModuleSyntax. Used ../desktop-client.js pattern (Svelte convention: .js extension for .ts source files).
- Context pattern: setDesktopClient/getDesktopClient via Svelte context for component tree access.
- Added CoreWorkspaceRecord and CoreSessionRecord re-exports to desktop-client.ts so components don't need direct @pi-gui/desktop-core imports.
- A11y fixes: tabindex+role+aria-selected+keydown on clickable li items; for/id on label+select pairs; removed autofocus attributes.

**Next-iteration notes:** Item 10 (JSON persistence verification) next — Svelte Desktop restart persistence through existing Desktop Core JSON path.

## Iteration 10 — JSON persistence across restart

**Item:** Preserve JSON catalog/session persistence across Svelte Desktop app restart.

**Why chosen:** Prioritization strategy: core smoke parity and packaging after UI (items 1-9 done). Persistence is the last backend seam to validate before Playwright smoke tests.

**Changed files:**
- `packages/desktop-core/tests/desktop-core.test.ts` — 4 new persistence tests: workspace across restart, session across restart, multiple workspaces/sessions, initialWorkspacePaths auto-add then restore
- `packages/sidecar/tests/ws-server.test.ts` — 1 new persistence test: workspace persists across sidecar restart via WS protocol
- `.ralph/items.json` — marked item 10 passing
- `.ralph/progress.md` — this file

**Verification:**
- `pnpm --filter @pi-gui/desktop-core test`: 15/15 pass (11 original + 4 persistence)
- `pnpm --filter @pi-gui/sidecar test`: 17/17 pass (16 original + 1 persistence)
- `pnpm --filter @pi-gui/svelte-desktop test`: 30/30 pass
- `pnpm typecheck`: all 10 workspace projects pass; svelte-check 0 errors, 0 warnings
- `pnpm lint`: no errors

**Decisions:**
- Persistence is proven at two layers: DesktopCore (raw API) and Sidecar (WS protocol). Both confirm workspace/session state restored from catalogs.json on restart.
- Session creation (createSession) takes ~2s because it initializes a real pi session — acceptable for integration tests, but sidecar persistence test only verifies workspace restore (faster, 10ms).
- DesktopCoreImpl.initialize() calls refreshState() which reads from the existing catalogs.json — workspaces added in a previous run are automatically visible.
- initialWorkspacePaths only syncs on first init; on subsequent inits, syncWorkspace skips already-catalogued paths and refreshState picks up all persisted state.
- No SQLite or Tauri KV introduced — uses existing catalogs.json from PiSdkDriver.

**Next-iteration notes:** Item 11 (Playwright smoke lane) next — needs real Tauri surface launch with controlled Sidecar fixtures on macOS.

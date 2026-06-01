# Pi Desktop — Svelte + Tauri Tracer Bullet

SvelteKit static + Tauri v2 desktop app for the Pi coding agent.

## Status: Tracer Bullet (Pre-Canonical)

The Svelte Desktop is a **parallel frontend** to the existing Electron Desktop
(`apps/desktop`). It is **not yet** the canonical app.

### When the Svelte Desktop becomes Canonical

The Svelte Desktop will be promoted to the Canonical App when:

1.  All Tracer Bullet items in `.ralph/items.json` pass (items 1–13).
2.  Core smoke parity is proven: workspace, session, composer, timeline,
    model selection, and persistence work on the real Tauri surface.
3.  Playwright desktop smoke lane (item 11) passes on a real macOS Tauri build.
4.  Known gaps have explicit follow-up issue seeds with owners.

Until then, treat both apps as peers; the Electron Desktop remains the stable
reference.

## Architecture

```
┌─────────────────────────────────────────────────┐
│  Tauri Shell (Rust)                              │
│  ┌─────────────────────────────────────────────┐│
│  │  SvelteKit Static Client (dist/)             ││
│  │  ┌─────────────────┐  ┌──────────────────┐  ││
│  │  │ desktopClient    │  │ UI Components     │  ││
│  │  │ store            │  │ (WorkspacePanel,  │  ││
│  │  │ (WebSocket)      │  │  SessionList,     │  ││
│  │  └────────┬────────┘  │  Timeline,        │  ││
│  │           │            │  Composer,        │  ││
│  │           │            │  ModelSettings)   │  ││
│  │           │            └──────────────────┘  ││
│  └───────────┼──────────────────────────────────┘│
│              │ ws://127.0.0.1:{port}              │
└──────────────┼──────────────────────────────────┘
               │
┌──────────────┼──────────────────────────────────┐
│  Sidecar (Node.js)                              │
│  ┌───────────┴────────────────────────────────┐ │
│  │  WebSocket Server (ws)                      │ │
│  │  Authenticated (per-run token)              │ │
│  │  Protocol: @pi-gui/desktop-protocol         │ │
│  └───────────┬────────────────────────────────┘ │
│  ┌───────────┴────────────────────────────────┐ │
│  │  DesktopCoreImpl                            │ │
│  │  - Workspace CRUD                           │ │
│  │  - Session CRUD                             │ │
│  │  - Composer submit/cancel                   │ │
│  │  - Model selection                          │ │
│  │  - JSON persistence (catalogs.json)         │ │
│  └───────────┬────────────────────────────────┘ │
│  ┌───────────┴────────────────────────────────┐ │
│  │  PiSdkDriver + session-driver + catalogs    │ │
│  └────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
```

## Quick Start

```bash
# Install deps (from repo root)
pnpm install

# Build SvelteKit static output
pnpm --filter @pi-gui/svelte-desktop build

# Run unit + integration tests
pnpm --filter @pi-gui/svelte-desktop test

# Run Playwright smoke tests (requires Sidecar + browser)
pnpm --filter @pi-gui/svelte-desktop test:smoke

# Typecheck
pnpm --filter @pi-gui/svelte-desktop typecheck

# Verify Tauri Rust compilation (no .app bundle)
pnpm --filter @pi-gui/svelte-desktop smoke:app

# Dev mode (SvelteKit only, no Tauri)
pnpm --filter @pi-gui/svelte-desktop dev
```

## Known Gaps

These features exist in the Electron Desktop but are **not yet implemented**
in the Svelte Desktop. They are hidden behind known-gap labels in the UI
(no half-working controls).

| Gap | Issue |
|-----|-------|
| Integrated terminal (node-pty) | Tauri terminal integration not yet designed |
| Extension dock and dialog | Extension rendering not ported |
| Worktree create/remove | Worktree management not implemented |
| Commit/push flows | Git operations not implemented |
| File attachments / drag-drop | Composer attachment UI deferred |
| Skills view | Skills settings view deferred |
| Notification preferences | Notification system not wired |
| Theme / appearance settings | Theme toggling not wired |
| Signed macOS releases | Codesign + notarization deferred |
| Linux packaging | Platform packaging deferred |
| Windows packaging | Platform packaging deferred |
| Auto-update | Update mechanism deferred |

### Follow-up Issue Seeds

- **Terminal integration**: Tauri `sidecar` or `shell` plugin for `node-pty`.
  Needs process lifecycle management in the Rust layer.
- **Extension dock**: Port `apps/desktop/src/extension-session-ui.tsx` to
  Svelte components. Requires session isolation patterns.
- **Worktree + commit/push**: Port `apps/desktop/src/worktree-*.tsx` flows.
  Needs Git operations through the Sidecar or a Tauri plugin.
- **Signed releases**: Add `tauri-bundler` macOS signing config.
  Needs Apple Developer Program membership.
- **Linux/Windows**: Add `tauri.conf.json` platform targets.
  Needs CI runners for each platform.

## Package Scripts

| Script | Description |
|--------|-------------|
| `dev` | SvelteKit dev server (port 5174) |
| `build` | Build static dist via adapter-static |
| `preview` | Preview built dist |
| `test` | Unit + integration tests (node --test) |
| `test:smoke` | Playwright E2E smoke tests |
| `typecheck` | svelte-check + TypeScript |
| `tauri` | Tauri CLI passthrough |
| `build:app` | Tauri production build (requires codesign) |
| `smoke:app` | Verify build pipeline (SvelteKit + cargo check) |

## Test Coverage

| Layer | Tests | Command |
|-------|-------|---------|
| Desktop Protocol | 17 | `pnpm --filter @pi-gui/desktop-protocol test` |
| Desktop Core | 15 | `pnpm --filter @pi-gui/desktop-core test` |
| Sidecar (probe + WS) | 17 | `pnpm --filter @pi-gui/sidecar test` |
| Desktop Client Store | 14 | `pnpm --filter @pi-gui/svelte-desktop test` |
| UI Integration | 16 | (same) |
| Playwright Smoke | 8 | `pnpm --filter @pi-gui/svelte-desktop test:smoke` |
| **Total** | **87** | |

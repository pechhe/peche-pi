# Repo Guidelines

These rules apply for the full session.

## Workflow
- Define success criteria before coding; if unclear, stop and clarify.
- For non-trivial work, plan verification up front with the `self-test` skill.
- Do not create or switch to new branches to start work unless the user explicitly asks; respect the current branch or worktree as intentional.
- Commit in small focused checkpoints; don’t batch unrelated changes.
- Run `simplify` before closing non-trivial implementation work.

## Product
- This repo is building a Codex-style desktop app for `pi`; preserve that product direction.
- Desktop work is not done until it is verified on the real Electron surface, not only by unit tests.
- Transcript/timeline behavior, session correctness, and Codex-style UX are product features, not polish.
- Prefer clean reimplementation over patching around local complexity.

## Safety
- Never delete user session history, cached transcripts, screenshots, or temp artifacts without approval.
- Treat files you didn’t edit as read-only when multiple agents may be working.
- Ask before destructive commands or history rewrites.

## Structure
- Prefer path-scoped guidance in nested `AGENTS.md` files over growing this file.
- Keep the desktop renderer/main/preload boundary tight; avoid broad Node exposure to the renderer.
- Keep `pi-sdk-driver` thin over `pi-mono`; don’t fork or reimplement `pi` runtime behavior unless necessary.

## Dev Workflow

### Launching the dev app
- Use **Pi Dev.app** (`/Applications/Pi Dev.app` or `~/Applications/Pi Dev.app`) — a Dock-friendly wrapper that runs `bun dev` from this repo.
- It sets `PI_APP_NAME=peche-pi` and uses `~/Library/Application Support/peche-pi` for state, so it never clashes with the production `/Applications/pi-gui.app`.
- If the dev Electron process is already running, clicking the Dock icon activates the existing window instead of launching a second instance.
- The wrapper script lives at `scripts/dev-launch-peche-pi.sh`; the .app itself was hand-built and isn't part of the repo.

### Editing and seeing changes
- **Source edits:** Edit files in `packages/` or `apps/desktop/`. The `tsc -w` watcher (started by `bun dev`) auto-rebuilds workspace packages to `dist/`.
- **Hot reload:** Changes to the renderer (React in `apps/desktop/src/` under `electron-vite dev`) hot-reload in-place — no restart needed.
- **Main process restart:** Changes to `packages/pi-sdk-driver`, `packages/session-driver`, or `apps/desktop/electron/` run in the **Node main process** and require an Electron restart. Quit the app and click Pi Dev.app again.
- **Typecheck before committing:** `cd packages/<pkg> && npx tsc -p tsconfig.json --noEmit` (or `bun run typecheck` where available).

### Package structure
- `packages/pi-sdk-driver/` — runtime metadata, extension/skill display names, provider/model sync. **Shared between renderer and main via require().**
- `packages/session-driver/` — session lifecycle, transcript types. Also shared.
- `apps/desktop/` — Electron app (React renderer + Node main process). The canonical Desktop App.

### Verification
- Prefer running the real Electron app and checking the UI directly.
- For automated proofs: `cd apps/desktop && pnpm test:e2e:core` (background UI), `pnpm test:e2e:live` (runtime-dependent), `pnpm test:e2e:native` (macOS OS-surface).
- See `apps/desktop/AGENTS.md` and `apps/desktop/tests/AGENTS.md` for lane details.

## Diagnosing Dev Build Crashes

When `bun dev` (or Pi Dev.app) crashes, check these sources in order:

### 1. Terminal output — look for the crash box

The dev script (`apps/desktop/scripts/dev.mjs`) prints a labeled crash box on stderr when any child process dies:
```
╔══════════════════════════════════════════════════════════════╗
║  DEV CRASH: electron-vite                                   ║
║  exit code 1                                                ║
║  cwd: …/apps/desktop                                        ║
║  Electron crash log (if any):                               ║
║    ~/Library/Application Support/peche-pi/crash.log         ║
╚══════════════════════════════════════════════════════════════╝
```
The label tells you **which process** died:
- `tsc --watch (<pkg>)` — TypeScript build failure in that package. Read the tsc errors above.
- `electron-vite` — Electron main or vite dev server crashed. Check the crash log next.
- `pnpm build --watch` — pnpm-based build failed (non-Bun path).

### 2. Electron crash log

`~/Library/Application Support/peche-pi/crash.log` — written by the main process for uncaught exceptions and unhandled rejections. Only exists when a crash occurred.

### 3. TypeScript compilation errors

Type errors in `packages/` surface as `tsc --watch` crashes (see step 1). Run targeted checks:
```bash
cd packages/<pkg> && npx tsc -p tsconfig.json --noEmit
cd apps/desktop && npx tsc -p tsconfig.json --noEmit        # renderer
cd apps/desktop && npx tsc -p tsconfig.electron.json --noEmit  # main process
```

### Common failure patterns
- **`tsc --watch (pi-sdk-driver)` crashes** → Check `packages/pi-sdk-driver/src/vendor/session-driver.d.ts` — this ambient module declaration shadows the real `@pi-gui/session-driver` types. If new types were added to `packages/session-driver/src/types.ts`, the shim must be updated too.
- **`electron-vite` crashes, no crash.log** → Port conflict (5173 already in use), kill stale Electron: `pkill -f "Electron.*peche-pi"`.
- **`electron-vite` crashes, crash.log exists** → Read the log for the stack trace. Common: unhandled async error in main process startup, missing native module.

## Source Of Truth
- Root `AGENTS.md` is the repo instruction source of truth.
- Root `CLAUDE.md` should remain a symlink to `AGENTS.md`.

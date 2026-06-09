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

## Graphify Project Map

This repo has `graphify-out/` built. Graphify is useful but **lane-sensitive** — route each question to the call that actually works, or it returns junk and wastes a turn.

### Routing (do this, in order)
1. **"What are the modules / overall architecture / where does X fit?"** → READ `graphify-out/GRAPH_REPORT.md` directly. It lists 60+ named community hubs (e.g. "Desktop Session State", "Session Supervisor", "Timeline Management"). Do **NOT** use `graphify_query` for this — its BFS anchors on words in your question and returns junk (e.g. "main" → package.json fields).
2. **"How does <thing> flow / connect across files?"** → `graphify_query` — but anchor the question on a **concrete symbol or file name that exists in the code** (e.g. `session`, `applyTimelineEvent`, `app-store.ts`), not vague nouns. This is Graphify's strongest lane and beats grep for cross-package file discovery.
3. **Explain one named concept** → `graphify_explain({ concept })` — the `concept` MUST be an **exact node/community label** copied from `GRAPH_REPORT.md` (Title Case, e.g. `Desktop Session State`). Made-up labels return "no node found".
4. **Connection between two named things** → `graphify_path` — both endpoints must be exact node labels.

### Gotchas (why it silently fails)
- `graphify_query` start-node selection is fuzzy word-match on the question. Vague/common words anchor on the wrong nodes. Name a real symbol.
- `graphify_explain` / `graphify_path` need labels that exist verbatim. Pull them from `GRAPH_REPORT.md` first; don't guess.
- If a Graphify call returns junk or "no node found", do **not** retry blindly — fall back to the routing above (report read, or Cymbal/grep).

### Tool boundaries
- **Cymbal** — symbol lookup, refs, impact, impls, targeted source reads.
- **grep/rg** — exact strings, configs, logs, non-code text.
- **Graphify** — only the lanes above.

### Staleness
- Graph built from commit `b303f487`. If `git rev-parse HEAD` differs, run `graphify_update .` (no API cost) before trusting cross-file results.

## Dev Workflow

### Launching the dev app
- Use **Pi Dev.app** (`/Applications/Pi Dev.app` or `~/Applications/Pi Dev.app`) — a Dock-friendly wrapper that runs `pnpm dev` from this repo.
- It sets `PI_APP_NAME=peche-pi` and uses `~/Library/Application Support/peche-pi` for state, so it never clashes with the production `/Applications/pi-gui.app`.
- If the dev Electron process is already running, clicking the Dock icon activates the existing window instead of launching a second instance.
- The wrapper script lives at `scripts/dev-launch-peche-pi.sh`; the .app itself was hand-built and isn't part of the repo.

### Editing and seeing changes
- **Source edits:** Edit files in `packages/` or `apps/desktop/`. The `tsc -w` watcher (started by `pnpm dev`) auto-rebuilds workspace packages to `dist/`.
- **Hot reload:** Changes to the renderer (React in `apps/desktop/src/` under `electron-vite dev`) hot-reload in-place — no restart needed.
- **Main process restart:** Changes to `packages/pi-sdk-driver`, `packages/session-driver`, or `apps/desktop/electron/` run in the **Node main process** and require an Electron restart. Quit the app and click Pi Dev.app again.
- **Typecheck before committing:** `cd packages/<pkg> && npx tsc -p tsconfig.json --noEmit` (or `pnpm run typecheck` where available).

### Package structure
- `packages/pi-sdk-driver/` — runtime metadata, extension/skill display names, provider/model sync. **Shared between renderer and main via require().**
- `packages/session-driver/` — session lifecycle, transcript types. Also shared.
- `apps/desktop/` — Electron app (React renderer + Node main process). The canonical Desktop App.

### Verification
- Prefer running the real Electron app and checking the UI directly.
- For automated proofs: `cd apps/desktop && pnpm test:e2e:core` (background UI), `pnpm test:e2e:live` (runtime-dependent), `pnpm test:e2e:native` (macOS OS-surface).
- See `apps/desktop/AGENTS.md` and `apps/desktop/tests/AGENTS.md` for lane details.

## Managing Complexity (fallow)

`fallow health` flags hotspots by CRAP score. **CRAP = CC² + CC** (with no test coverage), so cyclomatic complexity dominates — a long function isn't the problem, a high-*branching* one is. Squaring means breaking a fat method into a thin coordinator + small helpers collapses the score fast.

### Before refactoring a hotspot: is it real or mechanical?
Read both metrics fallow reports, not just CC:
- **High CC + low cognitive (≈1)** → *mechanical*. A big equality check (`sameSessionComposerProps`), a flat state-merge literal with 20 `??`, or an enum cascade. Splitting adds indirection for **zero readability gain — skip it** (or extract only the validators, not the shape).
- **High CC + high cognitive** → *real branching*. This is what to extract.

### Extraction patterns that worked here (highest leverage first)
- **if-block dispatcher → `Map` lookup.** A handler with N `if (key === …) { … return }` blocks is N×~4 CC. A `Map<string, () => void>` + one lookup is ~1 CC. (`handleKeyDown` 68→26.)
- **ternary/version cascade → validator helper or `Set`.** (`readPersistedUiState` 34→14.)
- **large JSX popover/panel → child component.** Move its state + callbacks with it. (`Topbar` 73→27.)
- **fat method → thin coordinator + private sub-methods.** Prefer in-class private methods over expanding shared interfaces on untested critical-path code. (`initializeInternal`/`refreshState`/`handleSessionEvent`.)
- **free functions** in already-decomposed modules: follow the existing `store: AppStoreInternals` param pattern rather than inventing a new seam.

### Preventing buildup
- Complexity accretes one `if`/`case` at a time on existing dispatchers. When adding a branch to a handler already near the threshold, **convert it to a lookup/table instead of appending**.
- Critical-path methods (`app-store.ts`, `session-supervisor.ts`) have ~zero unit coverage, so CRAP stays high and refactors are risky. Adding tests drops CRAP *without* touching code (the `(1 - cov)³` term) and de-risks future edits — prefer tests over restructuring when the logic is already clear.
- After non-trivial handler/component work, glance at `./node_modules/.bin/fallow health --top 20` for new CRITICAL flags before committing.

## Diagnosing Dev Build Crashes

When `pnpm dev` (or Pi Dev.app) crashes, check these sources in order:

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

## Agent skills

### Issue tracker

Issues and PRDs live in GitHub Issues. See `docs/agents/issue-tracker.md`.

### Triage labels

Default canonical labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout — one `CONTEXT.md` + `docs/adr/` at repo root. See `docs/agents/domain.md`.

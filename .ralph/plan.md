# Execution Plan: SvelteKit + Tauri local-first Desktop App port

## Source Inputs

- Conversation decisions from the grilling session for Option A local-first SvelteKit port.
- PRD issue: https://github.com/minghinmatthewlam/pi-gui/issues/37
- Glossary: `CONTEXT.md`
- Architecture ADR: `docs/adr/0001-sveltekit-tauri-node-sidecar.md`
- Existing repo scripts from `package.json`.
- Existing Electron Desktop implementation under `apps/desktop`.
- Existing runtime packages under `packages/session-driver`, `packages/catalogs`, and `packages/pi-sdk-driver`.

The Ralph bundle is distilled-only. Runtime agents should use this plan and `.ralph/items.json`, not the PRD issue, unless a human explicitly asks them to reopen source planning docs.

## Objective

Build the first production Tracer Bullet for the Svelte Desktop: a parallel SvelteKit + Tauri Desktop App that launches a local Sidecar, connects through the Desktop Protocol, manages a workspace and session, sends and cancels messages, streams timeline updates, supports model selection, and persists/reopens state.

The Svelte Desktop becomes eligible to be the Canonical App only after the Tracer Bullet plus core smoke parity passes.

## Scope In

- Create a parallel `apps/svelte-desktop` app.
- Create shared packages for Desktop Protocol, Desktop Core, and Desktop Sidecar as needed.
- Keep the Sidecar as the owner of canonical app state.
- Use a static SvelteKit Desktop Client loaded by Tauri.
- Use an authenticated localhost WebSocket between Desktop Client and Sidecar.
- Runtime-validate Desktop Protocol messages with Valibot.
- Preserve existing JSON catalog/session persistence for the first milestone.
- Reuse existing `pi-sdk-driver`, `session-driver`, and `catalogs` behavior where possible.
- Try Bun as the Sidecar runtime, with a clear compatibility gate and fallback to bundled Node if Bun fails.
- Verify real desktop behavior with a Svelte/Tauri Playwright lane before marking the UI smoke item passing.
- Keep Electron Desktop tests passing while extracting shared logic.

## Scope Out

- Hosted or browser-only pi product.
- SvelteKit SSR server in production.
- Full Electron feature parity before the Tracer Bullet.
- Terminal UI and full `node-pty` integration in the first milestone.
- Extension dock/dialog UI parity in the first milestone.
- Worktree create/remove and commit/push flows in the first milestone.
- SQLite migration.
- Signed or notarized releases.
- Linux and Windows packaging.
- Auto-update.

## Constraints

- Current Ralph workspace root is this repository.
- Package manager is pnpm 10.25.0.
- Execution host, target runtime, and verification host are macOS.
- Safe preflight observed macOS 26.5, arm64, Xcode at `/Applications/Xcode.app/Contents/Developer`.
- First distribution target is macOS dev app plus local packaged `.app` smoke only.
- No item may require interactive admin approval, keychain signing prompts, notarization credentials, system daemon installation, Accessibility permission, or Screen Recording permission.
- The Sidecar must bind localhost only and enforce per-run token plus Origin checks.
- Missing features after promotion must be hidden or disabled with explicit known-gap labels and tracked follow-up notes, not half-working controls.
- Do not delete or rewrite user session history, cached transcripts, screenshots, or temp artifacts.
- Preserve unrelated working-tree changes. Stage only files needed for the selected Ralph item and the required `.ralph` state updates.

## Prioritization Strategy

Choose one unfinished item per iteration. Prefer items that reduce integration risk and unblock later behavior:

1. Stable contracts and safety boundaries.
2. Runtime compatibility and process lifecycle.
3. Headless state ownership and persistence.
4. Real Svelte/Tauri connection and UI behavior.
5. Core smoke parity and packaging.

Do not implement a later UI workflow before the protocol, Sidecar, and state ownership seams needed by that workflow exist.

## Completion Definition

Completion requires every item in `.ralph/items.json` to have `passes: true`, with each passing item backed by command output and one focused git commit from its iteration.

The final state must include:

- Typed Desktop Protocol with runtime validation.
- Sidecar process with authenticated WebSocket, snapshot/event sync, reconnect behavior, and Bun compatibility gate or documented Node fallback.
- Extracted headless Desktop Core sufficient for workspace/session/composer/model/persistence smoke parity.
- Svelte Desktop app with static SvelteKit client, Tauri shell, `desktopClient` store, and Tracer Bullet UI.
- Playwright desktop smoke tests for Svelte/Tauri core parity.
- macOS dev/package smoke path for local `.app` verification.
- Known-gaps handling for deferred terminal, extension UI, worktree create/remove, and commit/push features.

# Execution Plan: Deepen Desktop App architecture

## Source Inputs

- Conversation architecture review in this session.
- Glossary: `CONTEXT.md`.
- Architecture ADRs: `docs/adr/0001-sveltekit-tauri-node-sidecar.md` and `docs/adr/0002-electron-desktop-only.md`.
- Repo guidance: `AGENTS.md`, `apps/desktop/AGENTS.md`, `packages/pi-sdk-driver/AGENTS.md`.
- Desktop App source under `apps/desktop`.
- Runtime packages under `packages/session-driver`, `packages/pi-sdk-driver`, and `packages/catalogs`.
- Existing verification scripts from `package.json` and `apps/desktop/package.json`.

The Ralph bundle is distilled-only. Runtime agents should use this plan and `.ralph/items.json`, not the conversation transcript, unless a human explicitly asks them to reopen chat context.

## Objective

Deepen the Electron Desktop App architecture without reviving the abandoned SvelteKit/Tauri port.

The work should remove stale modules, concentrate Desktop App state invariants, reduce IPC drift, give transcript/timeline behavior one owning module, improve `pi-sdk-driver` internal locality, and remove duplicated session-driver type contracts.

## Scope In

- Delete stale abandoned-port artifacts that contradict ADR-0002 when they are not live source or dependencies.
- Grow the Desktop App state transition module so more `DesktopAppState` mutation rules live behind one seam.
- Replace manually synchronized IPC wiring with a deeper Desktop App command registry or equivalent narrow command module.
- Create one owning Desktop App timeline model module for persisted transcript rows, live session events, summaries, meta activity, and renderer grouping inputs.
- Improve `SessionSupervisor` internal locality while keeping `PiSdkDriver` and `SessionDriver` external Interfaces stable.
- Replace the `pi-sdk-driver` ambient copy of `@pi-gui/session-driver` types with the real package type seam.
- Preserve Electron as the only Desktop App.
- Preserve narrow preload exposure. Do not expose broad filesystem, process, or Node access to the renderer.
- Add or update tests at the Interface of each deepened module.

## Scope Out

- Reintroducing `apps/svelte-desktop`, Sidecar, Desktop Protocol, or platform-adapter packages.
- Creating a second host, web app, mobile app, or alternate shell.
- Broad product redesign of the Codex-style Desktop App UI.
- Large cosmetic rewrites or unrelated cleanup.
- Deleting user session history, cached transcripts, screenshots, or temp artifacts.
- Editing unrelated user working-tree changes.

## Constraints

- Current Ralph workspace root is this repository.
- Package manager is pnpm 10.25.0.
- Current branch is intentional. Do not create or switch branches.
- Existing user changes may be present. Preserve unrelated working-tree changes and stage only files needed for the selected Ralph item plus `.ralph` state updates.
- ADR-0002 is authoritative: Electron Desktop is the only Desktop App. Do not revisit SvelteKit/Tauri on theoretical grounds.
- `packages/pi-sdk-driver` must stay thin over `pi-mono`; do not fork or reimplement pi runtime behavior unless needed for correctness.
- Desktop changes are not complete until verified on the appropriate surface. Unit tests are useful, but UI-facing Desktop App behavior needs Electron Playwright coverage when changed.
- Keep the renderer/main/preload seam tight. Renderer code should see only the narrow `window.piApp` Interface.
- Use this architecture vocabulary in docs and progress: Module, Interface, Implementation, Depth, Seam, Adapter, Leverage, Locality.

## Prioritization Strategy

Choose one unfinished item per iteration. Prefer items that reduce misleading architecture or high-change coordination risk first:

1. Remove dead abandoned-port modules that contradict ADR-0002.
2. Remove duplicated type contracts that cause build drift.
3. Deepen state and IPC seams that many Desktop App changes cross.
4. Deepen transcript/timeline behavior because it is a core product feature.
5. Improve `pi-sdk-driver` internals in small slices while preserving external Interfaces.

Do not combine unrelated candidates in one iteration. Each item should produce one focused commit and one verification pass.

## Completion Definition

Completion requires every item in `.ralph/items.json` to have `passes: true`, with each passing item backed by command output and one focused git commit from its iteration.

The final state must include:

- No live abandoned SvelteKit/Tauri residue under workspace packages.
- `pi-sdk-driver` consumes the real `session-driver` type Interface rather than a copied ambient declaration.
- More Desktop App state invariants are enforced through the state transition module and tests.
- IPC command names, exposed renderer methods, and main handlers are checked through one deeper command seam or contract test.
- Timeline assembly has one owning module with tests covering persisted messages plus live session events.
- `SessionSupervisor` has improved internal locality for at least one high-friction concern without changing `PiSdkDriver` callers.
- Required verification gates pass at the end of every item.

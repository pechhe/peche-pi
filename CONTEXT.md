# pi GUI Desktop

This context defines the shared language for the local-first desktop app
that users run on their machine to operate pi sessions against local
workspaces.

## Language

**Desktop App**:
The Electron + React application users run on their machine to operate
pi sessions against local workspaces.
_Avoid_: Web app, hosted app, backend

**Desktop Session State**:
The canonical Desktop App state for pi sessions: which sessions exist,
which session is selected, what transcript is selected, what composer work
is pending, which sessions are running or viewed, and what session-scoped
extension UI is visible.
_Avoid_: Session UI state, transcript cache, composer store

**Chat Workspace**:
A chat-specific local workspace rooted in its own directory. The chat
lifecycle creates and manages that workspace; once a chat resolves to a pi
session, its session state is normal Desktop Session State.
_Avoid_: Chat session, chat store

**Desktop IPC Seam**:
The Electron seam that exposes Desktop App capabilities from the main
process to the renderer through preload. Its contract includes channel
direction, payload shape, result shape, subscription behavior, and error
behavior.
_Avoid_: IPC helpers, preload API, backend API

**Desktop Surface**:
The visible Desktop App mode the user is operating in, including the active
view, selected workspace or session, focus target, and command meaning for
that moment.
_Avoid_: App screen, route, page

**Surface Intent**:
A user intent after it has been interpreted in the context of the current
Desktop Surface, before it is executed by workflow modules.
_Avoid_: UI event, command action

**Session Runtime Registry**:
The pi SDK driver module that owns live session record lifecycle: creating,
opening, ensuring, rebinding, closing, disposing, and key migration for
managed pi sessions.
_Avoid_: Runtime map, session supervisor helpers

**Workspace Review**:
The Desktop App workflow for inspecting local workspace changes before
publishing work: changed files, file diffs, staging decisions, reviewed
state, and safe undo/redo of pi-authored edits. Reached from the
**Changes** row of the Environment widget.
_Avoid_: Git panel, diff helpers, review UI state

**Environment**:
The per-thread bundle describing where work happens and how it is
published: its Location (local vs worktree), current branch, the Changes
entrypoint, and commit/push actions. Surfaced as a persistent widget so the
user always knows which checkout and branch a thread is operating in.
_Avoid_: Surface, mode (when meaning the whole bundle)

**Ship**:
The one-click publish action available when **Auto-ship** is enabled:
commit all changes, push, open a PR, and merge — spawning a resolver thread
if the merge conflicts. The opt-in alternative to the default manual flow
(stage → commit → push → PR). Replaces the old always-on `feature-done`
behavior; the engine is reused but is never automatic.
_Avoid_: Feature done, auto-merge, chore: ship

**Auto-ship**:
The mode that swaps the Environment widget's manual "Commit or push" row
for a single **Ship** button. A global default in Git settings,
overridable per-thread from the Environment gear.
_Avoid_: Lazy mode, autopilot, one-click mode

**Location**:
The checkout a thread runs against: the user's main checkout (`local`) or
an isolated git worktree (`worktree`). This is the laptop-row axis inside
the Environment widget.
_Avoid_: Environment (for this narrow axis), env, target

## Flagged ambiguities

- "Backend" was used to mean both a hosted service and a local companion
  process — the app has no backend; canonical state lives in the
  Electron main process.
- "Branch" is overloaded. pi owns it for **session/transcript branching**
  (`/tree`, `/clone`, fork). The Environment widget means **git branch**.
  In GUI code and docs, always qualify: say "git branch" (or the branch
  name, e.g. `main`); reserve unqualified "branch"/"fork" for pi sessions.
- pi has no native worktree/branch/commit/PR management; it only *reads*
  the current git branch from a session's cwd (internal footer plumbing).
  The Desktop App owns git/worktree orchestration. The Environment widget's
  git branch read-out must derive from the worktree's cwd (matching pi),
  not a parallel store that can drift.

## History

An earlier attempt to add a parallel SvelteKit + Tauri port (with a Node
"Sidecar" process and a typed "Desktop Protocol" over WebSocket) was
abandoned and removed. See `docs/adr/0002-electron-desktop-only.md`.

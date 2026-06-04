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
state, and safe undo/redo of pi-authored edits.
_Avoid_: Git panel, diff helpers, review UI state

## Flagged ambiguities

- "Backend" was used to mean both a hosted service and a local companion
  process — the app has no backend; canonical state lives in the
  Electron main process.

## History

An earlier attempt to add a parallel SvelteKit + Tauri port (with a Node
"Sidecar" process and a typed "Desktop Protocol" over WebSocket) was
abandoned and removed. See `docs/adr/0002-electron-desktop-only.md`.

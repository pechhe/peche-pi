# pi GUI Desktop

This context defines the shared language for the local-first desktop app
that users run on their machine to operate pi sessions against local
workspaces.

## Language

**Desktop App**:
The Electron + React application users run on their machine to operate
pi sessions against local workspaces.
_Avoid_: Web app, hosted app, backend

## Flagged ambiguities

- "Backend" was used to mean both a hosted service and a local companion
  process — the app has no backend; canonical state lives in the
  Electron main process.

## History

An earlier attempt to add a parallel SvelteKit + Tauri port (with a Node
"Sidecar" process and a typed "Desktop Protocol" over WebSocket) was
abandoned and removed. See `docs/adr/0002-electron-desktop-only.md`.

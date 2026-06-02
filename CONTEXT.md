# pi GUI Desktop Port

This context defines the shared language for the local-first desktop app and its SvelteKit/Tauri port. It captures product and architecture terms used across agents working on the port.

## Language

**Desktop App**:
The local-first application users run on their machine to operate pi sessions against local workspaces.
_Avoid_: Web app, hosted app

**Svelte Desktop**:
The new SvelteKit + Tauri implementation of the Desktop App.
_Avoid_: Web version, cloud app

**Electron Desktop**:
The existing Electron + React implementation of the Desktop App.
_Avoid_: Legacy app until it is actually retired

**Sidecar**:
A companion local process launched by the Desktop App that owns privileged runtime work and canonical app state.
_Avoid_: Backend, daemon, server

**Desktop Client**:
The SvelteKit user interface that connects to the Sidecar and renders app state.
_Avoid_: Frontend when it obscures the local desktop boundary

**Desktop Protocol**:
The typed local message contract used by the Desktop Client and Sidecar to exchange commands, state snapshots, and runtime events.
_Avoid_: IPC when referring to the WebSocket protocol

**Tracer Bullet**:
The first end-to-end slice that proves the Svelte Desktop can launch, connect to the Sidecar, manage a workspace and session, send a message, stream the timeline, and persist/reopen state.
_Avoid_: Prototype when the slice is intended to become production code

**Canonical App**:
The Desktop App implementation treated as the primary releasable and daily-use surface.
_Avoid_: Main app when ambiguous

## Relationships

- The **Svelte Desktop** and **Electron Desktop** are implementations of the **Desktop App**.
- The **Desktop Client** connects to exactly one local **Sidecar** for a running app instance.
- The **Sidecar** owns canonical state; the **Desktop Client** renders a projection of that state.
- The **Desktop Protocol** defines messages between the **Desktop Client** and the **Sidecar**.
- The **Tracer Bullet** is the first promotion candidate for making the **Svelte Desktop** the **Canonical App**.

## Example dialogue

> **Dev:** "Should the **Desktop Client** store session state in Svelte stores?"
> **Domain expert:** "Only as a projection. The **Sidecar** owns canonical state and sends snapshots/events over the **Desktop Protocol**."

## Flagged ambiguities

- "Backend" was used to mean both a hosted service and a local companion process — resolved: use **Sidecar** for the local process.
- "Web app" implies hosted/browser-only behavior — resolved: use **Svelte Desktop** for the SvelteKit + Tauri local-first app.

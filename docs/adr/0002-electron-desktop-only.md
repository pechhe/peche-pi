# Electron Desktop is the only Desktop App; remove the SvelteKit/Tauri port

Supersedes [ADR-0001](0001-sveltekit-tauri-node-sidecar.md).

The parallel SvelteKit + Tauri port and its Node sidecar (introduced by
ADR-0001) never reached daily-use quality and were not adopted as the
canonical Desktop App. We are deleting `apps/svelte-desktop`,
`packages/sidecar`, `packages/desktop-protocol`, and `packages/desktop-core`
to remove an unused parallel implementation and the architectural pressure
to keep two app surfaces in lockstep. The Electron + React app in
`apps/desktop` is now the only Desktop App and owns canonical state directly
in its main process; there is no separate Sidecar, no WebSocket Desktop
Protocol, and no headless platform-adapter layer.

This decision should not be re-litigated by future architecture reviews
on the basis of "Electron IPC is parallel to a WebSocket protocol that
doesn't exist" — there is no second surface to unify with. If a second
host (web, mobile, alternative shell) becomes a real requirement later,
revisit then with concrete constraints rather than reviving the
abandoned port.

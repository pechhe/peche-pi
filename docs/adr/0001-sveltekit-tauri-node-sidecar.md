# Use SvelteKit, Tauri, and a Node sidecar for the local-first desktop port

We will port the desktop app as a parallel SvelteKit + Tauri app that loads a static SvelteKit client and launches a long-lived Node sidecar for privileged local runtime work. The sidecar owns canonical app state and runs the existing `pi-sdk-driver`; the Svelte client communicates over an authenticated localhost WebSocket using shared, runtime-validated protocol schemas. This preserves the local-first pi runtime and avoids rewriting Node-dependent session, filesystem, git, and process logic in Rust or inside a production SvelteKit SSR server.

Considered alternatives: SvelteKit inside Electron would reduce migration risk but keep the current Electron shell; pure Tauri commands would require a high-risk rewrite of Node/TypeScript runtime logic; a SvelteKit SSR server in production would add an unnecessary server lifecycle to a desktop app.

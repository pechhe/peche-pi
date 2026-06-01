/**
 * @pi-gui/sidecar
 *
 * Localhost Sidecar: canonical app state, authenticated WebSocket service,
 * and runtime compatibility gate.
 *
 * This package owns the following responsibilities:
 * - Auth-bound WebSocket that speaks the desktop-protocol message contract
 * - State snapshot / event sync
 * - Desktop Core orchestration (workspace, session, composer, model, persistence)
 * - Runtime probe that decides Bun vs bundled-Node
 */
export const SIDECAR_VERSION = "0.0.0" as const;

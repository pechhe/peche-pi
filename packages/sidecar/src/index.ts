/**
 * @pi-gui/sidecar
 *
 * Localhost Sidecar: canonical app state, authenticated WebSocket service,
 * and runtime compatibility gate.
 */
export const SIDECAR_VERSION = "0.0.0" as const;

export {
  startSidecarServer,
  type SidecarServerOptions,
  type SidecarServer,
} from "./ws-server.js";

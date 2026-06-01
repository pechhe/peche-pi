/**
 * Minimal subset of the desktop app state used by the platform adapter.
 *
 * The full `DesktopAppState` lives in `@pi-gui/desktop-protocol`. The core
 * depends on a structural type so it can stay small and tree-shake friendly
 * for the Svelte Desktop sidecar.
 */
export interface DesktopAppStateShape {
  readonly activeView: "threads" | "new-thread" | "skills" | "extensions" | "settings";
  readonly selectedWorkspaceId: string;
  readonly selectedSessionId: string;
}

export type DesktopAppState = DesktopAppStateShape;

import type { PlatformAdapter } from "./adapter.js";
import { isSessionActivelyViewedPure } from "./adapter.js";
import type { SessionRef } from "@pi-gui/session-driver";
import type { DesktopAppState } from "./state-shape.js";

export interface WindowFocusState {
  readonly isWindowInFocus: () => boolean;
}

/**
 * Build a `PlatformAdapter` from a thin window-focus probe.
 *
 * Electron and Tauri both expose a way to ask "is the user looking at the
 * app window?". Wrap that probe in this factory and the headless core
 * stays host-agnostic.
 *
 * Example (Electron):
 *   createPlatformAdapter({
 *     isWindowInFocus: () => {
 *       const w = mainWindow;
 *       return Boolean(w && !w.isDestroyed() && !w.isMinimized() && w.isVisible() && w.isFocused());
 *     },
 *   });
 */
export function createPlatformAdapter(focus: WindowFocusState): PlatformAdapter {
  return {
    isSessionActivelyViewed(
      state: Pick<DesktopAppState, "activeView" | "selectedWorkspaceId" | "selectedSessionId"> | undefined,
      sessionRef: SessionRef,
    ): boolean {
      return isSessionActivelyViewedPure(state, sessionRef, focus.isWindowInFocus);
    },
  };
}

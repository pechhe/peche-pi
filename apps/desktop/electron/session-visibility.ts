import type { BrowserWindow } from "electron";
import type { DesktopAppState } from "../src/desktop-state";
import type { SessionRef } from "@pi-gui/session-driver";
import { isSessionActivelyViewedPure } from "@pi-gui/desktop-core";

/**
 * Electron adapter for the headless platform adapter. The actual decision
 * logic lives in `@pi-gui/desktop-core` so the Svelte Desktop can reuse it.
 */
export function isSessionActivelyViewed(
  state: Pick<DesktopAppState, "activeView" | "selectedWorkspaceId" | "selectedSessionId"> | undefined,
  sessionRef: SessionRef,
  window: BrowserWindow | null,
): boolean {
  return isSessionActivelyViewedPure(state, sessionRef, () => isWindowInFocus(window));
}

function isWindowInFocus(window: BrowserWindow | null): boolean {
  if (!window || window.isDestroyed() || window.isMinimized() || !window.isVisible()) {
    return false;
  }
  return window.isFocused();
}

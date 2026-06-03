import type { BrowserWindow } from "electron";
import type { DesktopAppState } from "../src/desktop-state";
import type { SessionRef } from "@pi-gui/session-driver";

/**
 * Is the given session the one the user is currently looking at?
 *
 * True when:
 *   - the active view is `threads`,
 *   - the session is the selected session in the selected workspace,
 *   - and the window is focused (visible, not minimised, has OS focus).
 *
 * Tests can override the window-focus answer via the
 * `__PI_GUI_TEST_SESSION_VISIBILITY__` / `__PI_APP_TEST_SESSION_VISIBILITY__`
 * globals.
 */
export function isSessionActivelyViewed(
  state: Pick<DesktopAppState, "activeView" | "selectedWorkspaceId" | "selectedSessionId"> | undefined,
  sessionRef: SessionRef,
  window: BrowserWindow | null,
): boolean {
  if (!state) {
    return false;
  }
  if (state.activeView !== "threads") {
    return false;
  }
  if (state.selectedWorkspaceId !== sessionRef.workspaceId || state.selectedSessionId !== sessionRef.sessionId) {
    return false;
  }
  const override = readSessionVisibilityOverride();
  if (override === "active") {
    return true;
  }
  if (override === "inactive") {
    return false;
  }
  return isWindowInFocus(window);
}

type SessionVisibilityOverride = "active" | "inactive" | undefined;

interface OverrideGlobals {
  __PI_GUI_TEST_SESSION_VISIBILITY__?: SessionVisibilityOverride;
  __PI_APP_TEST_SESSION_VISIBILITY__?: SessionVisibilityOverride;
}

function readSessionVisibilityOverride(): SessionVisibilityOverride {
  const globals = globalThis as OverrideGlobals;
  return globals.__PI_GUI_TEST_SESSION_VISIBILITY__ ?? globals.__PI_APP_TEST_SESSION_VISIBILITY__;
}

function isWindowInFocus(window: BrowserWindow | null): boolean {
  if (!window || window.isDestroyed() || window.isMinimized() || !window.isVisible()) {
    return false;
  }
  return window.isFocused();
}

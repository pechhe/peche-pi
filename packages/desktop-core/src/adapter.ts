import type { SessionRef } from "@pi-gui/session-driver";
import type { DesktopAppState } from "./state-shape.js";

/**
 * Platform-adapter contract for the headless desktop core.
 *
 * The core never imports `electron` or any host-specific module. Each
 * platform (Electron, Tauri-side-shell, headless test) provides a concrete
 * `PlatformAdapter` that implements the few behaviours that depend on
 * window state, OS shells, or user dialogs.
 *
 * The tracer bullet needs only `sessionActivelyViewed`. Adapters for
 * dialogs, shell-open, notifications, theme, terminal, and updates are
 * declared as no-op-friendly and are filled in incrementally.
 */
export interface PlatformAdapter {
  /**
   * Returns true when the session is the selected session, the active
   * view is the thread view, and the user is currently looking at the
   * window (focused, visible, not minimised). Adapters may short-circuit
   * with `true` in test harnesses via the global override hook.
   */
  isSessionActivelyViewed(
    state: Pick<DesktopAppState, "activeView" | "selectedWorkspaceId" | "selectedSessionId"> | undefined,
    sessionRef: SessionRef,
  ): boolean;
}

/**
 * Test-only override. Mirrors the behaviour of the previous Electron-local
 * `__PI_APP_TEST_SESSION_VISIBILITY__` global so existing tests keep working
 * without touching the adapter.
 */
type SessionVisibilityOverride = "active" | "inactive" | undefined;

interface OverrideGlobals {
  __PI_GUI_TEST_SESSION_VISIBILITY__?: SessionVisibilityOverride;
  __PI_APP_TEST_SESSION_VISIBILITY__?: SessionVisibilityOverride;
}

export function setSessionVisibilityOverride(value: SessionVisibilityOverride): void {
  (globalThis as OverrideGlobals).__PI_GUI_TEST_SESSION_VISIBILITY__ = value;
}

export function readSessionVisibilityOverride(): SessionVisibilityOverride {
  const globals = globalThis as OverrideGlobals;
  return globals.__PI_GUI_TEST_SESSION_VISIBILITY__ ?? globals.__PI_APP_TEST_SESSION_VISIBILITY__;
}

/**
 * Pure helper used by both the Electron and Tauri adapters. Pulled out so
 * the "is the user looking at the window" question does not leak Electron
 * into the headless core.
 */
export function isSessionActivelyViewedPure(
  state: Pick<DesktopAppState, "activeView" | "selectedWorkspaceId" | "selectedSessionId"> | undefined,
  sessionRef: SessionRef,
  isWindowInFocus: () => boolean,
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
  return isWindowInFocus();
}

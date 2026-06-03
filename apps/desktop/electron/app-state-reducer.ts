import type { AppView, ComposerDeviceMode, DesktopAppState, ModelSettingsScopeMode, NotificationPreferences, ThemeMode } from "../src/desktop-state";

/**
 * Pure state-transition layer for the desktop app.
 *
 * `reduce(state, action)` is a pure function: no I/O, no Electron, no
 * PiSdkDriver, no clock. Every write to `DesktopAppState` goes through
 * here so the state shape has a single enforcement point and is
 * unit-testable in isolation.
 *
 * Convention: when an action would not change the state, `reduce`
 * returns the *same* state reference. Callers can detect a no-op via
 * identity check (`next === state`).
 *
 * Convention: any action that produces a real state change clears
 * `lastError` and bumps `revision`. Those cross-cutting concerns belong
 * to the reducer, not to each caller.
 *
 * This module is the seam being grown. Today it handles the trivial
 * single-field settings setters; orchestrators with real side effects
 * (composer submit, session lifecycle, runtime refresh) will arrive in
 * later slices of candidate #2.
 */

export type DesktopAction =
  | { readonly type: "settings/setSidebarCollapsed"; readonly sidebarCollapsed: boolean }
  | { readonly type: "settings/setEnableTransparency"; readonly enableTransparency: boolean }
  | { readonly type: "settings/setComposerDeviceMode"; readonly composerDeviceMode: ComposerDeviceMode }
  | { readonly type: "settings/setThemeMode"; readonly themeMode: ThemeMode }
  | { readonly type: "settings/setIntegratedTerminalShell"; readonly integratedTerminalShell: string }
  | { readonly type: "settings/setCommitPushModel"; readonly commitPushModel: string }
  | { readonly type: "settings/mergeNotificationPreferences"; readonly preferences: Partial<NotificationPreferences> }
  | { readonly type: "view/setActiveView"; readonly activeView: AppView }
  | { readonly type: "settings/setModelSettingsScopeMode"; readonly modelSettingsScopeMode: ModelSettingsScopeMode };

export function reduce(state: DesktopAppState, action: DesktopAction): DesktopAppState {
  switch (action.type) {
    case "settings/setSidebarCollapsed": {
      if (state.sidebarCollapsed === action.sidebarCollapsed) {
        return state;
      }
      return bump({ ...state, sidebarCollapsed: action.sidebarCollapsed });
    }
    case "settings/setEnableTransparency": {
      if (state.enableTransparency === action.enableTransparency) {
        return state;
      }
      return bump({ ...state, enableTransparency: action.enableTransparency });
    }
    case "settings/setComposerDeviceMode": {
      if (state.composerDeviceMode === action.composerDeviceMode) {
        return state;
      }
      return bump({ ...state, composerDeviceMode: action.composerDeviceMode });
    }
    case "settings/setThemeMode": {
      if (state.themeMode === action.themeMode) {
        return state;
      }
      return bump({ ...state, themeMode: action.themeMode });
    }
    case "settings/setIntegratedTerminalShell": {
      // Caller is expected to normalise the value (e.g. trim) before
      // dispatching; the reducer stores the exact value it receives.
      if (state.integratedTerminalShell === action.integratedTerminalShell) {
        return state;
      }
      return bump({ ...state, integratedTerminalShell: action.integratedTerminalShell });
    }
    case "settings/setCommitPushModel": {
      if (state.commitPushModel === action.commitPushModel) {
        return state;
      }
      return bump({ ...state, commitPushModel: action.commitPushModel });
    }
    case "settings/mergeNotificationPreferences": {
      // Existing behaviour is to bump revision on every merge, even when
      // the merged result is structurally identical. Preserve that.
      return bump({
        ...state,
        notificationPreferences: { ...state.notificationPreferences, ...action.preferences },
      });
    }
    case "view/setActiveView": {
      // Deliberate deviation from the no-op convention: existing
      // behaviour is to always bump revision even when activeView is
      // unchanged. The orchestrator relies on this so re-selecting the
      // current view still triggers the post-state "mark viewed" side
      // effect via a fresh state-changed event.
      return bump({ ...state, activeView: action.activeView });
    }
    case "settings/setModelSettingsScopeMode": {
      if (state.modelSettingsScopeMode === action.modelSettingsScopeMode) {
        return state;
      }
      return bump({ ...state, modelSettingsScopeMode: action.modelSettingsScopeMode });
    }
  }
}

/**
 * Standard tail applied to every real state change: clear `lastError`
 * and bump `revision`. Kept private to the reducer so the convention
 * cannot drift across action handlers.
 */
function bump(state: DesktopAppState): DesktopAppState {
  return { ...state, lastError: undefined, revision: state.revision + 1 };
}

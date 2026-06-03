import type {
  AppView,
  ComposerAttachment,
  ComposerDeviceMode,
  ComposerDraftSyncSource,
  DesktopAppState,
  ModelSettingsScopeMode,
  NotificationPreferences,
  ThemeMode,
} from "../src/desktop-state";

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
 * This Module is the Seam being grown. It keeps pure composer and
 * selected-session invariants local while callers retain side-effect
 * Implementation ownership (driver calls, persistence, transcript
 * publication).
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
  | { readonly type: "settings/setModelSettingsScopeMode"; readonly modelSettingsScopeMode: ModelSettingsScopeMode }
  | {
      readonly type: "composer/setDraft";
      readonly composerDraft: string;
      readonly syncSource: ComposerDraftSyncSource;
    }
  | { readonly type: "composer/setAttachments"; readonly attachments: readonly ComposerAttachment[] }
  | {
      readonly type: "selection/selectSession";
      readonly workspaceId: string;
      readonly sessionId: string;
      readonly composerDraft: string;
      readonly composerAttachments: readonly ComposerAttachment[];
    };

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
    case "composer/setDraft": {
      if (state.composerDraft === action.composerDraft && state.composerDraftSyncSource === action.syncSource) {
        return state;
      }
      return bump({
        ...state,
        composerDraft: action.composerDraft,
        composerDraftSyncSource: action.syncSource,
        composerDraftSyncNonce: state.composerDraftSyncNonce + 1,
      });
    }
    case "composer/setAttachments": {
      if (composerAttachmentsEqual(state.composerAttachments, action.attachments)) {
        return state;
      }
      return bump({ ...state, composerAttachments: [...action.attachments] });
    }
    case "selection/selectSession": {
      if (
        state.selectedWorkspaceId === action.workspaceId &&
        state.selectedSessionId === action.sessionId &&
        state.activeView === "threads" &&
        state.composerDraft === action.composerDraft &&
        state.composerDraftSyncSource === "selection" &&
        composerAttachmentsEqual(state.composerAttachments, action.composerAttachments)
      ) {
        return state;
      }
      return bump({
        ...state,
        selectedWorkspaceId: action.workspaceId,
        selectedSessionId: action.sessionId,
        activeView: "threads",
        composerDraft: action.composerDraft,
        composerDraftSyncSource: "selection",
        composerDraftSyncNonce: state.composerDraftSyncNonce + 1,
        composerAttachments: [...action.composerAttachments],
      });
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

function composerAttachmentsEqual(
  left: readonly ComposerAttachment[],
  right: readonly ComposerAttachment[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((attachment, index) => {
    const other = right[index];
    if (!other || attachment.id !== other.id || attachment.kind !== other.kind || attachment.name !== other.name || attachment.mimeType !== other.mimeType) {
      return false;
    }
    if (attachment.kind === "image") {
      return other.kind === "image" && attachment.data === other.data;
    }
    return other.kind === "file" && attachment.fsPath === other.fsPath && attachment.sizeBytes === other.sizeBytes;
  });
}

import type {
  AppView,
  ChatRecord,
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
  | { readonly type: "settings/setTranscriptVerbose"; readonly transcriptVerbose: boolean }
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
    }
  | { readonly type: "chats/add"; readonly chat: ChatRecord }
  | { readonly type: "chats/select"; readonly chatId: string }
  | { readonly type: "chats/remove"; readonly chatId: string }
  | { readonly type: "chats/archive"; readonly chatId: string; readonly archivedAt: string }
  | { readonly type: "chats/unarchive"; readonly chatId: string }
  | { readonly type: "chats/rename"; readonly chatId: string; readonly title: string }
  | { readonly type: "chats/setStatus"; readonly chatId: string; readonly status: ChatRecord["status"] };

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
    case "settings/setTranscriptVerbose": {
      if (state.transcriptVerbose === action.transcriptVerbose) {
        return state;
      }
      return bump({ ...state, transcriptVerbose: action.transcriptVerbose });
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
      return bump({
        ...state,
        notificationPreferences: { ...state.notificationPreferences, ...action.preferences },
      });
    }
    case "view/setActiveView": {
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
    case "chats/add": {
      if (state.chats.find((c) => c.id === action.chat.id)) {
        return state;
      }
      return bump({ ...state, chats: [...state.chats, action.chat] });
    }
    case "chats/select": {
      if (state.selectedChatId === action.chatId) {
        return state;
      }
      return bump({ ...state, selectedChatId: action.chatId });
    }
    case "chats/remove": {
      const index = state.chats.findIndex((c) => c.id === action.chatId);
      if (index === -1) {
        return state;
      }
      const nextChats = [...state.chats];
      nextChats.splice(index, 1);
      return bump({
        ...state,
        chats: nextChats,
        selectedChatId: state.selectedChatId === action.chatId ? "" : state.selectedChatId,
      });
    }
    case "chats/archive": {
      return bump({
        ...state,
        chats: state.chats.map((c) => (c.id === action.chatId ? { ...c, archivedAt: action.archivedAt } : c)),
      });
    }
    case "chats/unarchive": {
      return bump({
        ...state,
        chats: state.chats.map((c) => (c.id === action.chatId ? { ...c, archivedAt: undefined } : c)),
      });
    }
    case "chats/rename": {
      return bump({
        ...state,
        chats: state.chats.map((c) =>
          c.id === action.chatId ? { ...c, title: action.title, updatedAt: new Date().toISOString() } : c,
        ),
      });
    }
    case "chats/setStatus": {
      return bump({
        ...state,
        chats: state.chats.map((c) =>
          c.id === action.chatId
            ? {
                ...c,
                status: action.status,
                ...(action.status === "running"
                  ? { runningSince: new Date().toISOString() }
                  : action.status === "idle"
                    ? { runningSince: undefined }
                    : {}),
              }
            : c,
        ),
      });
    }
  }
}

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

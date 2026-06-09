/**
 * Desktop IPC Seam — single source of truth for all renderer↔main IPC contracts.
 *
 * This module owns:
 * - Channel name constants (the `desktopIpc` object)
 * - Method-to-channel bridge metadata (`piDesktopApiIpcBridge`)
 * - Contract registry with validation, adapter grouping, and direction
 * - Preload adapter generation
 * - Main handler registration helpers
 *
 * The renderer-facing `PiDesktopApi` interface in `src/ipc.ts` stays stable.
 * This module does NOT redefine it — it only drives the IPC plumbing.
 */

// NOTE: This module is intentionally free of any runtime `electron` import so
// it can be loaded for its contract metadata (channels, validators, coverage
// checks) under plain `node --test`. Main-process handler registration that
// needs `ipcMain` lives in `desktop-ipc-seam-main.ts`.

// ---------------------------------------------------------------------------
// Contract types
// ---------------------------------------------------------------------------

export type IpcDirection = "renderer-to-main" | "main-to-renderer";

export type IpcMethodKind = "invoke" | "send" | "sendSync" | "event";

/** Adapter group — identifies which main-process adapter owns this channel. */
export type AdapterGroup =
  | "store"
  | "terminal"
  | "notification"
  | "theme"
  | "shell"
  | "git"
  | "composer"
  | "chat"
  | "session"
  | "workspace"
  | "subagent"
  | "window"
  | "system";

export interface IpcContractEntry {
  /** Method name on `window.piApp` / `PiDesktopApi`. */
  readonly methodName: string;
  /** Channel string sent over Electron IPC. */
  readonly channel: string;
  /** Direction of the primary data flow. */
  readonly direction: IpcDirection;
  /** How the renderer invokes this channel. */
  readonly kind: IpcMethodKind;
  /** Which adapter group owns the main-process handler. */
  readonly adapter: AdapterGroup;
  /**
   * Optional input validation for dangerous/command inputs.
   * Runs in the main process before the adapter. Throw to reject.
   * Only needed for privileged inputs (URLs, paths, IDs, payloads).
   */
  readonly validate?: (...args: unknown[]) => void;
  /**
   * If true, this channel is event-only: no ipcMain.handle/on registration.
   * The main process sends events; the renderer subscribes.
   */
  readonly eventOnly?: boolean;
  /**
   * If true, this method has a local (non-IPC) implementation in preload.
   * No ipcRenderer call is generated; the preload supplies the value directly.
   */
  readonly local?: boolean;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

const ALLOWED_URL_PROTOCOLS = ["http:", "https:"];

export function validateUrl(url: unknown): void {
  if (typeof url !== "string") {
    throw new TypeError("URL must be a string");
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new TypeError(`Invalid URL: ${url}`);
  }
  if (!ALLOWED_URL_PROTOCOLS.includes(parsed.protocol)) {
    throw new TypeError(`Refusing to open unsupported URL protocol: ${parsed.protocol}`);
  }
}

export function validateNonEmptyString(value: unknown, label: string): void {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
}

export function validateTerminalId(terminalId: unknown): void {
  validateNonEmptyString(terminalId, "terminalId");
}

function _validateWorkspaceId(workspaceId: unknown): void {
  validateNonEmptyString(workspaceId, "workspaceId");
}

// ---------------------------------------------------------------------------
// Channel name constants
// ---------------------------------------------------------------------------

const desktopIpc = {
  stateRequest: "pi-gui:state-request",
  stateChanged: "pi-gui:state-changed",
  statePatch: "pi-gui:state-patch",
  transcriptDelta: "pi-gui:transcript-delta",
  selectedTranscriptRequest: "pi-gui:selected-transcript-request",
  selectedTranscriptChanged: "pi-gui:selected-transcript-changed",
  appCommand: "pi-gui:app-command",
  workspacePicked: "pi-gui:workspace-picked",
  clipboardImagePasted: "pi-gui:clipboard-image-pasted",
  addWorkspacePath: "pi-gui:add-workspace-path",
  pickWorkspace: "pi-gui:pick-workspace",
  selectWorkspace: "pi-gui:select-workspace",
  renameWorkspace: "pi-gui:rename-workspace",
  removeWorkspace: "pi-gui:remove-workspace",
  reorderWorkspaces: "pi-gui:reorder-workspaces",
  openWorkspaceInFinder: "pi-gui:open-workspace-in-finder",
  showFileInFolder: "pi-gui:show-file-in-folder",
  createWorktree: "pi-gui:create-worktree",
  removeWorktree: "pi-gui:remove-worktree",
  openSkillInFinder: "pi-gui:open-skill-in-finder",
  openExtensionInFinder: "pi-gui:open-extension-in-finder",
  syncCurrentWorkspace: "pi-gui:sync-current-workspace",
  selectSession: "pi-gui:select-session",
  archiveSession: "pi-gui:archive-session",
  unarchiveSession: "pi-gui:unarchive-session",
  snoozeSession: "pi-gui:snooze-session",
  unsnoozeSession: "pi-gui:unsnooze-session",
  markToTestSession: "pi-gui:mark-to-test-session",
  unmarkToTestSession: "pi-gui:unmark-to-test-session",
  archiveAllNonRunningSessions: "pi-gui:archive-all-non-running-sessions",
  createSession: "pi-gui:create-session",
  startThread: "pi-gui:start-thread",
  cancelCurrentRun: "pi-gui:cancel-current-run",
  openSessionInDefaultTerminal: "pi-gui:open-session-in-default-terminal",
  chooseExternalTerminalApp: "pi-gui:choose-external-terminal-app",
  clearExternalTerminalApp: "pi-gui:clear-external-terminal-app",
  setActiveView: "pi-gui:set-active-view",
  setSidebarCollapsed: "pi-gui:set-sidebar-collapsed",
  setQueueMode: "pi-gui:set-queue-mode",
  refreshRuntime: "pi-gui:refresh-runtime",
  setModelSettingsScopeMode: "pi-gui:set-model-settings-scope-mode",
  setDefaultModel: "pi-gui:set-default-model",
  setDefaultThinkingLevel: "pi-gui:set-default-thinking-level",
  getCavemanConfig: "pi-gui:get-caveman-config",
  setCavemanDefaultLevel: "pi-gui:set-caveman-default-level",
  setCavemanOnLevel: "pi-gui:set-caveman-on-level",
  setSessionModel: "pi-gui:set-session-model",
  setSessionThinkingLevel: "pi-gui:set-session-thinking-level",
  loginProvider: "pi-gui:login-provider",
  logoutProvider: "pi-gui:logout-provider",
  setProviderApiKey: "pi-gui:set-provider-api-key",
  addCustomProvider: "pi-gui:add-custom-provider",
  removeCustomProvider: "pi-gui:remove-custom-provider",
  setEnableSkillCommands: "pi-gui:set-enable-skill-commands",
  setRetrySettings: "pi-gui:set-retry-settings",
  getRetrySettings: "pi-gui:get-retry-settings",
  setScopedModelPatterns: "pi-gui:set-scoped-model-patterns",
  setSkillEnabled: "pi-gui:set-skill-enabled",
  setExtensionEnabled: "pi-gui:set-extension-enabled",
  deleteExtension: "pi-gui:delete-extension",
  respondToHostUiRequest: "pi-gui:respond-to-host-ui-request",
  setNotificationPreferences: "pi-gui:set-notification-preferences",
  setIntegratedTerminalShell: "pi-gui:set-integrated-terminal-shell",
  setSubagentSettings: "pi-gui:set-subagent-settings",
  refreshSubagentAgents: "pi-gui:refresh-subagent-agents",
  saveSubagentAgent: "pi-gui:save-subagent-agent",
  deleteSubagentAgent: "pi-gui:delete-subagent-agent",
  setTranscriptVerbose: "pi-gui:set-transcript-verbose",
  setComposerDeviceMode: "pi-gui:set-composer-device-mode",
  setStreamReveal: "pi-gui:set-stream-reveal",
  setStreamRevealSpeed: "pi-gui:set-stream-reveal-speed",
  setPlanModeIdeology: "pi-gui:set-plan-mode-ideology",
  setThreadTransition: "pi-gui:set-thread-transition",
  terminalEnsurePanel: "pi-gui:terminal-ensure-panel",
  terminalCreateSession: "pi-gui:terminal-create-session",
  terminalSetActiveSession: "pi-gui:terminal-set-active-session",
  terminalWrite: "pi-gui:terminal-write",
  terminalResize: "pi-gui:terminal-resize",
  terminalRestartSession: "pi-gui:terminal-restart-session",
  terminalCloseSession: "pi-gui:terminal-close-session",
  terminalSetTitle: "pi-gui:terminal-set-title",
  terminalSetFocused: "pi-gui:terminal-set-focused",
  terminalData: "pi-gui:terminal-data",
  terminalExit: "pi-gui:terminal-exit",
  terminalError: "pi-gui:terminal-error",
  getNotificationPermissionStatus: "pi-gui:get-notification-permission-status",
  requestNotificationPermission: "pi-gui:request-notification-permission",
  openSystemNotificationSettings: "pi-gui:open-system-notification-settings",
  notificationPermissionStatusChanged: "pi-gui:notification-permission-status-changed",
  pickComposerAttachments: "pi-gui:pick-composer-attachments",
  readClipboardImage: "pi-gui:read-clipboard-image",
  addComposerAttachments: "pi-gui:add-composer-attachments",
  removeComposerAttachment: "pi-gui:remove-composer-attachment",
  editQueuedComposerMessage: "pi-gui:edit-queued-composer-message",
  cancelQueuedComposerEdit: "pi-gui:cancel-queued-composer-edit",
  removeQueuedComposerMessage: "pi-gui:remove-queued-composer-message",
  steerQueuedComposerMessage: "pi-gui:steer-queued-composer-message",
  updateComposerDraft: "pi-gui:update-composer-draft",
  submitComposer: "pi-gui:submit-composer",
  getSessionTree: "pi-gui:get-session-tree",
  navigateSessionTree: "pi-gui:navigate-session-tree",
  toggleWindowMaximize: "pi-gui:toggle-window-maximize",
  openOverlay: "pi-gui:open-overlay",
  closeOverlay: "pi-gui:close-overlay",
  listWorkspaceFiles: "pi-gui:list-workspace-files",
  getChangedFiles: "pi-gui:get-changed-files",
  getWorkspaceGitInfo: "pi-gui:get-workspace-git-info",
  getFileDiff: "pi-gui:get-file-diff",
  stageFile: "pi-gui:stage-file",
  undoEdits: "pi-gui:undo-edits",
  redoEdits: "pi-gui:redo-edits",
  commitPushExecute: "pi-gui:commit-push-execute",
  setCommitPushModel: "pi-gui:set-commit-push-model",
  getWorkspacePrInfo: "pi-gui:get-workspace-pr-info",
  startChat: "pi-gui:start-chat",
  selectChat: "pi-gui:select-chat",
  archiveChat: "pi-gui:archive-chat",
  unarchiveChat: "pi-gui:unarchive-chat",
  removeChat: "pi-gui:remove-chat",
  renameChat: "pi-gui:rename-chat",
  getChatAgentsMd: "pi-gui:get-chat-agents-md",
  writeChatAgentsMd: "pi-gui:write-chat-agents-md",
  listBranches: "pi-gui:list-branches",
  generatePrDraft: "pi-gui:generate-pr-draft",
  prCreate: "pi-gui:pr-create",
  featureDone: "pi-gui:feature-done",
  getContextSnapshot: "pi-gui:get-context-snapshot",
  getGraphifyProjectMapStatus: "pi-gui:get-graphify-project-map-status",
  updateGraphifyProjectMap: "pi-gui:update-graphify-project-map",
  buildGraphifyProjectMap: "pi-gui:build-graphify-project-map",
  getGraphifyHealthCheck: "pi-gui:get-graphify-health-check",
  getGraphifyHookStatus: "pi-gui:get-graphify-hook-status",
  setGraphifyHook: "pi-gui:set-graphify-hook",
  getGraphifyWatchStatus: "pi-gui:get-graphify-watch-status",
  setGraphifyWatch: "pi-gui:set-graphify-watch",
  readGraphifyGraph: "pi-gui:read-graphify-graph",
  getThemeMode: "pi-gui:get-theme-mode",
  getResolvedTheme: "pi-gui:get-resolved-theme",
  setThemeMode: "pi-gui:set-theme-mode",
  themeChanged: "pi-gui:theme-changed",
  ping: "app:ping",
  openExternal: "app:open-external",
  getSmartCompactSettings: "pi-gui:get-smart-compact-settings",
  setSmartCompactSettings: "pi-gui:set-smart-compact-settings",
  analyzeExtensionConfig: "pi-gui:analyze-extension-config",
  getExtensionConfig: "pi-gui:get-extension-config",
  setExtensionConfig: "pi-gui:set-extension-config",
  installExtension: "pi-gui:install-extension",
  uninstallExtension: "pi-gui:uninstall-extension",
  checkExtensionUpdates: "pi-gui:check-extension-updates",
  buildHandoffPayload: "pi-gui:build-handoff-payload",
  createSeededSession: "pi-gui:create-seeded-session",
  getSessionTranscript: "pi-gui:get-session-transcript",
  getSubagentSessionEntries: "pi-gui:get-subagent-session-entries",
  searchTranscriptText: "pi-gui:search-transcript-text",
  automationCreate: "pi-gui:automation-create",
  automationUpdate: "pi-gui:automation-update",
  automationDelete: "pi-gui:automation-delete",
  automationList: "pi-gui:automation-list",
  automationFireNow: "pi-gui:automation-fire-now",
  liveEditStats: "pi-gui:live-edit-stats",

  // -- Update --
  updateStateChanged: "pi-gui:update-state-changed",
  checkForUpdate: "pi-gui:check-for-update",
  downloadUpdate: "pi-gui:download-update",
  restartToInstall: "pi-gui:restart-to-install",

  // -- GitHub issue runner --
  listGhMilestones: "pi-gui:gh-list-milestones",
  runGhMilestone: "pi-gui:gh-run-milestone",
  cancelGhRun: "pi-gui:gh-cancel-run",
} as const;

// ---------------------------------------------------------------------------
// Local-only methods (no IPC channel)
// ---------------------------------------------------------------------------

const _piDesktopApiLocalEntries = ["platform", "versions", "getPathForFile"] as const;

// ---------------------------------------------------------------------------
// Contract registry
// ---------------------------------------------------------------------------

export const desktopIpcContracts: readonly IpcContractEntry[] = [
  // -- System / bootstrap --
  { methodName: "ping", channel: desktopIpc.ping, direction: "renderer-to-main", kind: "invoke", adapter: "system" },
  { methodName: "openExternal", channel: desktopIpc.openExternal, direction: "renderer-to-main", kind: "invoke", adapter: "shell", validate: validateUrl },

  // -- Window --
  { methodName: "toggleWindowMaximize", channel: desktopIpc.toggleWindowMaximize, direction: "renderer-to-main", kind: "invoke", adapter: "window" },
  { methodName: "openOverlay", channel: desktopIpc.openOverlay, direction: "renderer-to-main", kind: "invoke", adapter: "window" },
  { methodName: "closeOverlay", channel: desktopIpc.closeOverlay, direction: "renderer-to-main", kind: "invoke", adapter: "window" },

  // -- Theme --
  { methodName: "getThemeMode", channel: desktopIpc.getThemeMode, direction: "renderer-to-main", kind: "invoke", adapter: "theme" },
  { methodName: "getResolvedTheme", channel: desktopIpc.getResolvedTheme, direction: "renderer-to-main", kind: "invoke", adapter: "theme" },
  { methodName: "setThemeMode", channel: desktopIpc.setThemeMode, direction: "renderer-to-main", kind: "invoke", adapter: "theme" },
  { methodName: "onThemeChanged", channel: desktopIpc.themeChanged, direction: "main-to-renderer", kind: "event", adapter: "theme", eventOnly: true },

  // -- State --
  { methodName: "getState", channel: desktopIpc.stateRequest, direction: "renderer-to-main", kind: "invoke", adapter: "store" },
  { methodName: "onStateChanged", channel: desktopIpc.stateChanged, direction: "main-to-renderer", kind: "event", adapter: "store", eventOnly: true },
  { methodName: "onStatePatch", channel: desktopIpc.statePatch, direction: "main-to-renderer", kind: "event", adapter: "store", eventOnly: true },
  { methodName: "onTranscriptDelta", channel: desktopIpc.transcriptDelta, direction: "main-to-renderer", kind: "event", adapter: "store", eventOnly: true },
  { methodName: "getSelectedTranscript", channel: desktopIpc.selectedTranscriptRequest, direction: "renderer-to-main", kind: "invoke", adapter: "store" },
  { methodName: "onSelectedTranscriptChanged", channel: desktopIpc.selectedTranscriptChanged, direction: "main-to-renderer", kind: "event", adapter: "store", eventOnly: true },
  { methodName: "onCommand", channel: desktopIpc.appCommand, direction: "main-to-renderer", kind: "event", adapter: "store", eventOnly: true },
  { methodName: "onWorkspacePicked", channel: desktopIpc.workspacePicked, direction: "main-to-renderer", kind: "event", adapter: "store", eventOnly: true },
  { methodName: "onClipboardImagePasted", channel: desktopIpc.clipboardImagePasted, direction: "main-to-renderer", kind: "event", adapter: "store", eventOnly: true },

  // -- Workspace --
  { methodName: "addWorkspacePath", channel: desktopIpc.addWorkspacePath, direction: "renderer-to-main", kind: "invoke", adapter: "workspace" },
  { methodName: "pickWorkspace", channel: desktopIpc.pickWorkspace, direction: "renderer-to-main", kind: "invoke", adapter: "workspace" },
  { methodName: "selectWorkspace", channel: desktopIpc.selectWorkspace, direction: "renderer-to-main", kind: "invoke", adapter: "workspace" },
  { methodName: "renameWorkspace", channel: desktopIpc.renameWorkspace, direction: "renderer-to-main", kind: "invoke", adapter: "workspace" },
  { methodName: "removeWorkspace", channel: desktopIpc.removeWorkspace, direction: "renderer-to-main", kind: "invoke", adapter: "workspace" },
  { methodName: "reorderWorkspaces", channel: desktopIpc.reorderWorkspaces, direction: "renderer-to-main", kind: "invoke", adapter: "workspace" },
  { methodName: "openWorkspaceInFinder", channel: desktopIpc.openWorkspaceInFinder, direction: "renderer-to-main", kind: "invoke", adapter: "workspace" },
  { methodName: "showFileInFolder", channel: desktopIpc.showFileInFolder, direction: "renderer-to-main", kind: "invoke", adapter: "workspace" },
  { methodName: "createWorktree", channel: desktopIpc.createWorktree, direction: "renderer-to-main", kind: "invoke", adapter: "workspace" },
  { methodName: "removeWorktree", channel: desktopIpc.removeWorktree, direction: "renderer-to-main", kind: "invoke", adapter: "workspace" },
  { methodName: "openSkillInFinder", channel: desktopIpc.openSkillInFinder, direction: "renderer-to-main", kind: "invoke", adapter: "workspace" },
  { methodName: "openExtensionInFinder", channel: desktopIpc.openExtensionInFinder, direction: "renderer-to-main", kind: "invoke", adapter: "workspace" },
  { methodName: "syncCurrentWorkspace", channel: desktopIpc.syncCurrentWorkspace, direction: "renderer-to-main", kind: "invoke", adapter: "workspace" },
  { methodName: "listWorkspaceFiles", channel: desktopIpc.listWorkspaceFiles, direction: "renderer-to-main", kind: "invoke", adapter: "workspace" },
  { methodName: "getChangedFiles", channel: desktopIpc.getChangedFiles, direction: "renderer-to-main", kind: "invoke", adapter: "workspace" },
  { methodName: "getWorkspaceGitInfo", channel: desktopIpc.getWorkspaceGitInfo, direction: "renderer-to-main", kind: "invoke", adapter: "workspace" },

  // -- Session --
  { methodName: "selectSession", channel: desktopIpc.selectSession, direction: "renderer-to-main", kind: "invoke", adapter: "session" },
  { methodName: "archiveSession", channel: desktopIpc.archiveSession, direction: "renderer-to-main", kind: "invoke", adapter: "session" },
  { methodName: "unarchiveSession", channel: desktopIpc.unarchiveSession, direction: "renderer-to-main", kind: "invoke", adapter: "session" },
  { methodName: "snoozeSession", channel: desktopIpc.snoozeSession, direction: "renderer-to-main", kind: "invoke", adapter: "session" },
  { methodName: "unsnoozeSession", channel: desktopIpc.unsnoozeSession, direction: "renderer-to-main", kind: "invoke", adapter: "session" },
  { methodName: "markToTestSession", channel: desktopIpc.markToTestSession, direction: "renderer-to-main", kind: "invoke", adapter: "session" },
  { methodName: "unmarkToTestSession", channel: desktopIpc.unmarkToTestSession, direction: "renderer-to-main", kind: "invoke", adapter: "session" },
  { methodName: "archiveAllNonRunningSessions", channel: desktopIpc.archiveAllNonRunningSessions, direction: "renderer-to-main", kind: "invoke", adapter: "session" },
  { methodName: "createSession", channel: desktopIpc.createSession, direction: "renderer-to-main", kind: "invoke", adapter: "session" },
  { methodName: "startThread", channel: desktopIpc.startThread, direction: "renderer-to-main", kind: "invoke", adapter: "session" },
  { methodName: "cancelCurrentRun", channel: desktopIpc.cancelCurrentRun, direction: "renderer-to-main", kind: "invoke", adapter: "session" },
  { methodName: "openSessionInDefaultTerminal", channel: desktopIpc.openSessionInDefaultTerminal, direction: "renderer-to-main", kind: "invoke", adapter: "session" },
  { methodName: "chooseExternalTerminalApp", channel: desktopIpc.chooseExternalTerminalApp, direction: "renderer-to-main", kind: "invoke", adapter: "session" },
  { methodName: "clearExternalTerminalApp", channel: desktopIpc.clearExternalTerminalApp, direction: "renderer-to-main", kind: "invoke", adapter: "session" },
  { methodName: "getSessionTree", channel: desktopIpc.getSessionTree, direction: "renderer-to-main", kind: "invoke", adapter: "session" },
  { methodName: "navigateSessionTree", channel: desktopIpc.navigateSessionTree, direction: "renderer-to-main", kind: "invoke", adapter: "session" },

  // -- View / UI state --
  { methodName: "setActiveView", channel: desktopIpc.setActiveView, direction: "renderer-to-main", kind: "invoke", adapter: "store" },
  { methodName: "setSidebarCollapsed", channel: desktopIpc.setSidebarCollapsed, direction: "renderer-to-main", kind: "invoke", adapter: "store" },
  { methodName: "setQueueMode", channel: desktopIpc.setQueueMode, direction: "renderer-to-main", kind: "invoke", adapter: "store" },
  { methodName: "refreshRuntime", channel: desktopIpc.refreshRuntime, direction: "renderer-to-main", kind: "invoke", adapter: "store" },

  // -- Model / settings --
  { methodName: "setModelSettingsScopeMode", channel: desktopIpc.setModelSettingsScopeMode, direction: "renderer-to-main", kind: "invoke", adapter: "store" },
  { methodName: "setDefaultModel", channel: desktopIpc.setDefaultModel, direction: "renderer-to-main", kind: "invoke", adapter: "store" },
  { methodName: "setDefaultThinkingLevel", channel: desktopIpc.setDefaultThinkingLevel, direction: "renderer-to-main", kind: "invoke", adapter: "store" },
  { methodName: "getCavemanConfig", channel: desktopIpc.getCavemanConfig, direction: "renderer-to-main", kind: "invoke", adapter: "store" },
  { methodName: "setCavemanDefaultLevel", channel: desktopIpc.setCavemanDefaultLevel, direction: "renderer-to-main", kind: "invoke", adapter: "store" },
  { methodName: "setCavemanOnLevel", channel: desktopIpc.setCavemanOnLevel, direction: "renderer-to-main", kind: "invoke", adapter: "store" },
  { methodName: "setSessionModel", channel: desktopIpc.setSessionModel, direction: "renderer-to-main", kind: "invoke", adapter: "store" },
  { methodName: "setSessionThinkingLevel", channel: desktopIpc.setSessionThinkingLevel, direction: "renderer-to-main", kind: "invoke", adapter: "store" },

  // -- Smart compact --
  { methodName: "getSmartCompactSettings", channel: desktopIpc.getSmartCompactSettings, direction: "renderer-to-main", kind: "invoke", adapter: "store" },
  { methodName: "setSmartCompactSettings", channel: desktopIpc.setSmartCompactSettings, direction: "renderer-to-main", kind: "invoke", adapter: "store" },

  // -- Provider / auth --
  { methodName: "loginProvider", channel: desktopIpc.loginProvider, direction: "renderer-to-main", kind: "invoke", adapter: "store" },
  { methodName: "logoutProvider", channel: desktopIpc.logoutProvider, direction: "renderer-to-main", kind: "invoke", adapter: "store" },
  { methodName: "setProviderApiKey", channel: desktopIpc.setProviderApiKey, direction: "renderer-to-main", kind: "invoke", adapter: "store" },
  { methodName: "addCustomProvider", channel: desktopIpc.addCustomProvider, direction: "renderer-to-main", kind: "invoke", adapter: "store" },
  { methodName: "removeCustomProvider", channel: desktopIpc.removeCustomProvider, direction: "renderer-to-main", kind: "invoke", adapter: "store" },

  // -- Skills / extensions --
  { methodName: "setEnableSkillCommands", channel: desktopIpc.setEnableSkillCommands, direction: "renderer-to-main", kind: "invoke", adapter: "store" },
  { methodName: "setRetrySettings", channel: desktopIpc.setRetrySettings, direction: "renderer-to-main", kind: "invoke", adapter: "store" },
  { methodName: "getRetrySettings", channel: desktopIpc.getRetrySettings, direction: "renderer-to-main", kind: "invoke", adapter: "store" },
  { methodName: "setScopedModelPatterns", channel: desktopIpc.setScopedModelPatterns, direction: "renderer-to-main", kind: "invoke", adapter: "store" },
  { methodName: "setSkillEnabled", channel: desktopIpc.setSkillEnabled, direction: "renderer-to-main", kind: "invoke", adapter: "store" },
  { methodName: "setExtensionEnabled", channel: desktopIpc.setExtensionEnabled, direction: "renderer-to-main", kind: "invoke", adapter: "store" },
  { methodName: "deleteExtension", channel: desktopIpc.deleteExtension, direction: "renderer-to-main", kind: "invoke", adapter: "store" },
  
  // -- Extension config --
  { methodName: "analyzeExtensionConfig", channel: desktopIpc.analyzeExtensionConfig, direction: "renderer-to-main", kind: "invoke", adapter: "store" },
  { methodName: "getExtensionConfig", channel: desktopIpc.getExtensionConfig, direction: "renderer-to-main", kind: "invoke", adapter: "store" },
  { methodName: "setExtensionConfig", channel: desktopIpc.setExtensionConfig, direction: "renderer-to-main", kind: "invoke", adapter: "store" },
  { methodName: "installExtension", channel: desktopIpc.installExtension, direction: "renderer-to-main", kind: "invoke", adapter: "store" },
  { methodName: "uninstallExtension", channel: desktopIpc.uninstallExtension, direction: "renderer-to-main", kind: "invoke", adapter: "store" },
  { methodName: "checkExtensionUpdates", channel: desktopIpc.checkExtensionUpdates, direction: "renderer-to-main", kind: "invoke", adapter: "store" },

  // -- Host UI --
  { methodName: "respondToHostUiRequest", channel: desktopIpc.respondToHostUiRequest, direction: "renderer-to-main", kind: "invoke", adapter: "store" },

  // -- Notifications --
  { methodName: "setNotificationPreferences", channel: desktopIpc.setNotificationPreferences, direction: "renderer-to-main", kind: "invoke", adapter: "notification" },
  { methodName: "getNotificationPermissionStatus", channel: desktopIpc.getNotificationPermissionStatus, direction: "renderer-to-main", kind: "invoke", adapter: "notification" },
  { methodName: "requestNotificationPermission", channel: desktopIpc.requestNotificationPermission, direction: "renderer-to-main", kind: "invoke", adapter: "notification" },
  { methodName: "openSystemNotificationSettings", channel: desktopIpc.openSystemNotificationSettings, direction: "renderer-to-main", kind: "invoke", adapter: "notification" },
  { methodName: "onNotificationPermissionStatusChanged", channel: desktopIpc.notificationPermissionStatusChanged, direction: "main-to-renderer", kind: "event", adapter: "notification", eventOnly: true },

  // -- Terminal --
  { methodName: "setIntegratedTerminalShell", channel: desktopIpc.setIntegratedTerminalShell, direction: "renderer-to-main", kind: "invoke", adapter: "terminal" },
  { methodName: "ensureTerminalPanel", channel: desktopIpc.terminalEnsurePanel, direction: "renderer-to-main", kind: "invoke", adapter: "terminal" },
  { methodName: "createTerminalSession", channel: desktopIpc.terminalCreateSession, direction: "renderer-to-main", kind: "invoke", adapter: "terminal" },
  { methodName: "setActiveTerminalSession", channel: desktopIpc.terminalSetActiveSession, direction: "renderer-to-main", kind: "invoke", adapter: "terminal" },
  { methodName: "writeTerminal", channel: desktopIpc.terminalWrite, direction: "renderer-to-main", kind: "invoke", adapter: "terminal" },
  { methodName: "resizeTerminal", channel: desktopIpc.terminalResize, direction: "renderer-to-main", kind: "invoke", adapter: "terminal" },
  { methodName: "restartTerminalSession", channel: desktopIpc.terminalRestartSession, direction: "renderer-to-main", kind: "invoke", adapter: "terminal" },
  { methodName: "closeTerminalSession", channel: desktopIpc.terminalCloseSession, direction: "renderer-to-main", kind: "invoke", adapter: "terminal" },
  { methodName: "setTerminalTitle", channel: desktopIpc.terminalSetTitle, direction: "renderer-to-main", kind: "invoke", adapter: "terminal" },
  { methodName: "setTerminalFocused", channel: desktopIpc.terminalSetFocused, direction: "renderer-to-main", kind: "send", adapter: "terminal" },
  { methodName: "onTerminalData", channel: desktopIpc.terminalData, direction: "main-to-renderer", kind: "event", adapter: "terminal", eventOnly: true },
  { methodName: "onTerminalExit", channel: desktopIpc.terminalExit, direction: "main-to-renderer", kind: "event", adapter: "terminal", eventOnly: true },
  { methodName: "onTerminalError", channel: desktopIpc.terminalError, direction: "main-to-renderer", kind: "event", adapter: "terminal", eventOnly: true },

  // -- Subagent --
  { methodName: "setSubagentSettings", channel: desktopIpc.setSubagentSettings, direction: "renderer-to-main", kind: "invoke", adapter: "subagent" },
  { methodName: "refreshSubagentAgents", channel: desktopIpc.refreshSubagentAgents, direction: "renderer-to-main", kind: "invoke", adapter: "subagent" },
  { methodName: "saveSubagentAgent", channel: desktopIpc.saveSubagentAgent, direction: "renderer-to-main", kind: "invoke", adapter: "subagent" },
  { methodName: "deleteSubagentAgent", channel: desktopIpc.deleteSubagentAgent, direction: "renderer-to-main", kind: "invoke", adapter: "subagent" },

  // -- UI prefs --
  { methodName: "setTranscriptVerbose", channel: desktopIpc.setTranscriptVerbose, direction: "renderer-to-main", kind: "invoke", adapter: "store" },
  { methodName: "setComposerDeviceMode", channel: desktopIpc.setComposerDeviceMode, direction: "renderer-to-main", kind: "invoke", adapter: "store" },
  { methodName: "setStreamReveal", channel: desktopIpc.setStreamReveal, direction: "renderer-to-main", kind: "invoke", adapter: "store" },
  { methodName: "setStreamRevealSpeed", channel: desktopIpc.setStreamRevealSpeed, direction: "renderer-to-main", kind: "invoke", adapter: "store" },
  { methodName: "setPlanModeIdeology", channel: desktopIpc.setPlanModeIdeology, direction: "renderer-to-main", kind: "invoke", adapter: "store" },
  { methodName: "setThreadTransition", channel: desktopIpc.setThreadTransition, direction: "renderer-to-main", kind: "invoke", adapter: "store" },

  // -- Composer --
  { methodName: "pickComposerAttachments", channel: desktopIpc.pickComposerAttachments, direction: "renderer-to-main", kind: "invoke", adapter: "composer" },
  { methodName: "readClipboardImage", channel: desktopIpc.readClipboardImage, direction: "renderer-to-main", kind: "sendSync", adapter: "composer" },
  { methodName: "addComposerAttachments", channel: desktopIpc.addComposerAttachments, direction: "renderer-to-main", kind: "invoke", adapter: "composer" },
  { methodName: "removeComposerAttachment", channel: desktopIpc.removeComposerAttachment, direction: "renderer-to-main", kind: "invoke", adapter: "composer" },
  { methodName: "editQueuedComposerMessage", channel: desktopIpc.editQueuedComposerMessage, direction: "renderer-to-main", kind: "invoke", adapter: "composer" },
  { methodName: "cancelQueuedComposerEdit", channel: desktopIpc.cancelQueuedComposerEdit, direction: "renderer-to-main", kind: "invoke", adapter: "composer" },
  { methodName: "removeQueuedComposerMessage", channel: desktopIpc.removeQueuedComposerMessage, direction: "renderer-to-main", kind: "invoke", adapter: "composer" },
  { methodName: "steerQueuedComposerMessage", channel: desktopIpc.steerQueuedComposerMessage, direction: "renderer-to-main", kind: "invoke", adapter: "composer" },
  { methodName: "updateComposerDraft", channel: desktopIpc.updateComposerDraft, direction: "renderer-to-main", kind: "invoke", adapter: "composer" },
  { methodName: "submitComposer", channel: desktopIpc.submitComposer, direction: "renderer-to-main", kind: "invoke", adapter: "composer" },

  // -- Git / review --
  { methodName: "getFileDiff", channel: desktopIpc.getFileDiff, direction: "renderer-to-main", kind: "invoke", adapter: "git" },
  { methodName: "stageFile", channel: desktopIpc.stageFile, direction: "renderer-to-main", kind: "invoke", adapter: "git" },
  { methodName: "undoEdits", channel: desktopIpc.undoEdits, direction: "renderer-to-main", kind: "invoke", adapter: "git" },
  { methodName: "redoEdits", channel: desktopIpc.redoEdits, direction: "renderer-to-main", kind: "invoke", adapter: "git" },
  { methodName: "commitPushExecute", channel: desktopIpc.commitPushExecute, direction: "renderer-to-main", kind: "invoke", adapter: "git" },
  { methodName: "setCommitPushModel", channel: desktopIpc.setCommitPushModel, direction: "renderer-to-main", kind: "invoke", adapter: "git" },
  { methodName: "getWorkspacePrInfo", channel: desktopIpc.getWorkspacePrInfo, direction: "renderer-to-main", kind: "invoke", adapter: "git" },
  { methodName: "generatePrDraft", channel: desktopIpc.generatePrDraft, direction: "renderer-to-main", kind: "invoke", adapter: "git" },
  { methodName: "prCreate", channel: desktopIpc.prCreate, direction: "renderer-to-main", kind: "invoke", adapter: "git" },
  { methodName: "listBranches", channel: desktopIpc.listBranches, direction: "renderer-to-main", kind: "invoke", adapter: "git" },
  { methodName: "featureDone", channel: desktopIpc.featureDone, direction: "renderer-to-main", kind: "invoke", adapter: "git" },
  { methodName: "getContextSnapshot", channel: desktopIpc.getContextSnapshot, direction: "renderer-to-main", kind: "invoke", adapter: "store" },
  { methodName: "getGraphifyProjectMapStatus", channel: desktopIpc.getGraphifyProjectMapStatus, direction: "renderer-to-main", kind: "invoke", adapter: "store" },
  { methodName: "updateGraphifyProjectMap", channel: desktopIpc.updateGraphifyProjectMap, direction: "renderer-to-main", kind: "invoke", adapter: "store" },
  { methodName: "buildGraphifyProjectMap", channel: desktopIpc.buildGraphifyProjectMap, direction: "renderer-to-main", kind: "invoke", adapter: "store" },
  { methodName: "getGraphifyHealthCheck", channel: desktopIpc.getGraphifyHealthCheck, direction: "renderer-to-main", kind: "invoke", adapter: "store" },
  { methodName: "getGraphifyHookStatus", channel: desktopIpc.getGraphifyHookStatus, direction: "renderer-to-main", kind: "invoke", adapter: "store" },
  { methodName: "setGraphifyHook", channel: desktopIpc.setGraphifyHook, direction: "renderer-to-main", kind: "invoke", adapter: "store" },
  { methodName: "getGraphifyWatchStatus", channel: desktopIpc.getGraphifyWatchStatus, direction: "renderer-to-main", kind: "invoke", adapter: "store" },
  { methodName: "setGraphifyWatch", channel: desktopIpc.setGraphifyWatch, direction: "renderer-to-main", kind: "invoke", adapter: "store" },
  { methodName: "readGraphifyGraph", channel: desktopIpc.readGraphifyGraph, direction: "renderer-to-main", kind: "invoke", adapter: "store" },

  // -- Chat --
  { methodName: "startChat", channel: desktopIpc.startChat, direction: "renderer-to-main", kind: "invoke", adapter: "chat" },
  { methodName: "selectChat", channel: desktopIpc.selectChat, direction: "renderer-to-main", kind: "invoke", adapter: "chat" },
  { methodName: "archiveChat", channel: desktopIpc.archiveChat, direction: "renderer-to-main", kind: "invoke", adapter: "chat" },
  { methodName: "unarchiveChat", channel: desktopIpc.unarchiveChat, direction: "renderer-to-main", kind: "invoke", adapter: "chat" },
  { methodName: "removeChat", channel: desktopIpc.removeChat, direction: "renderer-to-main", kind: "invoke", adapter: "chat" },
  { methodName: "renameChat", channel: desktopIpc.renameChat, direction: "renderer-to-main", kind: "invoke", adapter: "chat" },
  { methodName: "getChatAgentsMd", channel: desktopIpc.getChatAgentsMd, direction: "renderer-to-main", kind: "invoke", adapter: "chat" },
  { methodName: "writeChatAgentsMd", channel: desktopIpc.writeChatAgentsMd, direction: "renderer-to-main", kind: "invoke", adapter: "chat" },

  // -- Handoff / Advisor --
  { methodName: "buildHandoffPayload", channel: desktopIpc.buildHandoffPayload, direction: "renderer-to-main", kind: "invoke", adapter: "session" },
  { methodName: "createSeededSession", channel: desktopIpc.createSeededSession, direction: "renderer-to-main", kind: "invoke", adapter: "session" },
  { methodName: "getSessionTranscript", channel: desktopIpc.getSessionTranscript, direction: "renderer-to-main", kind: "invoke", adapter: "session" },
  { methodName: "getSubagentSessionEntries", channel: desktopIpc.getSubagentSessionEntries, direction: "renderer-to-main", kind: "invoke", adapter: "session" },
  { methodName: "searchTranscriptText", channel: desktopIpc.searchTranscriptText, direction: "renderer-to-main", kind: "invoke", adapter: "session" },

  // -- Automation --
  { methodName: "automationCreate", channel: desktopIpc.automationCreate, direction: "renderer-to-main", kind: "invoke", adapter: "store" },
  { methodName: "automationUpdate", channel: desktopIpc.automationUpdate, direction: "renderer-to-main", kind: "invoke", adapter: "store" },
  { methodName: "automationDelete", channel: desktopIpc.automationDelete, direction: "renderer-to-main", kind: "invoke", adapter: "store" },
  { methodName: "automationList", channel: desktopIpc.automationList, direction: "renderer-to-main", kind: "invoke", adapter: "store" },
  { methodName: "automationFireNow", channel: desktopIpc.automationFireNow, direction: "renderer-to-main", kind: "invoke", adapter: "store" },
  { methodName: "onLiveEditStats", channel: desktopIpc.liveEditStats, direction: "main-to-renderer", kind: "event", adapter: "store", eventOnly: true },

  // -- Update --
  { methodName: "onUpdateStateChanged", channel: desktopIpc.updateStateChanged, direction: "main-to-renderer", kind: "event", adapter: "system", eventOnly: true },
  { methodName: "triggerCheckForUpdate", channel: desktopIpc.checkForUpdate, direction: "renderer-to-main", kind: "invoke", adapter: "system" },
  { methodName: "triggerDownloadUpdate", channel: desktopIpc.downloadUpdate, direction: "renderer-to-main", kind: "invoke", adapter: "system" },
  { methodName: "triggerRestartToInstall", channel: desktopIpc.restartToInstall, direction: "renderer-to-main", kind: "invoke", adapter: "system" },

  // -- GitHub issue runner --
  { methodName: "listGhMilestones", channel: desktopIpc.listGhMilestones, direction: "renderer-to-main", kind: "invoke", adapter: "chat" },
  { methodName: "runGhMilestone", channel: desktopIpc.runGhMilestone, direction: "renderer-to-main", kind: "invoke", adapter: "chat" },
  { methodName: "cancelGhRun", channel: desktopIpc.cancelGhRun, direction: "renderer-to-main", kind: "invoke", adapter: "chat" },
] as const;

// ---------------------------------------------------------------------------
// Derived: bridge metadata (backward-compatible with piDesktopApiIpcBridge)
// ---------------------------------------------------------------------------

type BridgeKind = "invoke" | "send" | "sendSync" | "event";

const piDesktopApiIpcBridge: Record<string, { kind: BridgeKind; channel: string }> = {};
for (const contract of desktopIpcContracts) {
  piDesktopApiIpcBridge[contract.methodName] = {
    kind: contract.kind,
    channel: contract.channel,
  };
}

// ---------------------------------------------------------------------------
// Registry lookup helpers
// ---------------------------------------------------------------------------

/** Find a contract by method name. */
export function getContract(methodName: string): IpcContractEntry | undefined {
  return desktopIpcContracts.find((c) => c.methodName === methodName);
}

/** Find a contract by channel string. */
export function getContractByChannel(channel: string): IpcContractEntry | undefined {
  return desktopIpcContracts.find((c) => c.channel === channel);
}

/** Get all contracts for a given adapter group. */
function _getContractsByAdapter(adapter: AdapterGroup): readonly IpcContractEntry[] {
  return desktopIpcContracts.filter((c) => c.adapter === adapter);
}

// ---------------------------------------------------------------------------
// Preload adapter — generates the window.piApp object from contracts
// ---------------------------------------------------------------------------

type UnsubscribeFn = () => void;

interface PreloadIpcRenderer {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  send(channel: string, ...args: unknown[]): void;
  sendSync(channel: string, ...args: unknown[]): unknown;
  on(channel: string, handler: (event: unknown, ...args: unknown[]) => void): void;
  removeListener(channel: string, handler: (event: unknown, ...args: unknown[]) => void): void;
}

interface PreloadContextBridge {
  exposeInMainWorld(key: string, api: Record<string, unknown>): void;
}

interface PreloadWebUtils {
  getPathForFile(file: File): string;
}

/**
 * Build the `window.piApp` object from the contract registry.
 *
 * Each contract entry maps to the correct ipcRenderer method:
 * - `invoke` → ipcRenderer.invoke(channel, ...args)
 * - `send` → ipcRenderer.send(channel, ...args); returns Promise.resolve()
 * - `sendSync` → ipcRenderer.sendSync(channel, ...args)
 * - `event` (eventOnly) → subscribe via ipcRenderer.on / removeListener
 *
 * Local entries (platform, versions, getPathForFile) are supplied directly.
 */
export function buildPreloadApi(
  ipcRenderer: PreloadIpcRenderer,
  contextBridge: PreloadContextBridge,
  webUtils: PreloadWebUtils,
  localEntries: Record<string, unknown>,
): void {
  const api: Record<string, unknown> = { ...localEntries };

  for (const contract of desktopIpcContracts) {
    if (contract.local) {
      continue;
    }

    switch (contract.kind) {
      case "invoke":
        api[contract.methodName] = (...args: unknown[]) =>
          ipcRenderer.invoke(contract.channel, ...args);
        break;
      case "send":
        api[contract.methodName] = (...args: unknown[]) => {
          ipcRenderer.send(contract.channel, ...args);
          return Promise.resolve();
        };
        break;
      case "sendSync":
        api[contract.methodName] = (...args: unknown[]) =>
          ipcRenderer.sendSync(contract.channel, ...args);
        break;
      case "event":
        // Event methods accept a typed listener and return an unsubscribe fn.
        // The listener signature varies per event (TerminalDataEvent, theme string, etc.).
        // We use a generic wrapper that forwards all payload args to the listener.
        api[contract.methodName] = (listener: (...payload: unknown[]) => void): UnsubscribeFn => {
          const handler = (_event: unknown, ...payload: unknown[]) => listener(...payload);
          ipcRenderer.on(contract.channel, handler);
          return () => {
            ipcRenderer.removeListener(contract.channel, handler);
          };
        };
        break;
    }
  }

  contextBridge.exposeInMainWorld("piApp", api);
}

// ---------------------------------------------------------------------------
// Contract test helpers
// ---------------------------------------------------------------------------

/**
 * Get all unique channel values from the registry.
 * Used by the contract test to verify uniqueness and completeness.
 */
function getAllChannelValues(): readonly string[] {
  return [...new Set(desktopIpcContracts.map((c) => c.channel))];
}

/**
 * Get all method names from the registry.
 */
function _getAllMethodNames(): readonly string[] {
  return desktopIpcContracts.map((c) => c.methodName);
}

/**
 * Verify the registry has no duplicate channel names.
 */
export function verifyChannelUniqueness(): void {
  const channels = getAllChannelValues();
  if (channels.length !== desktopIpcContracts.length) {
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const c of desktopIpcContracts) {
      if (seen.has(c.channel)) {
        dupes.push(c.channel);
      }
      seen.add(c.channel);
    }
    throw new Error(`Duplicate channels in registry: ${dupes.join(", ")}`);
  }
}

/**
 * Verify every desktopIpc constant is represented in the registry.
 */
export function verifyDesktopIpcCoverage(): void {
  const registryChannels = new Set(desktopIpcContracts.map((c) => c.channel));
  const constantEntries = Object.entries(desktopIpc);
  for (const [key, value] of constantEntries) {
    if (!registryChannels.has(value)) {
      throw new Error(`desktopIpc.${key} (${value}) is not in the contract registry`);
    }
  }
}

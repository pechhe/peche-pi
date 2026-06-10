import type { RuntimeSettingsSnapshot } from "@pi-gui/session-driver/runtime-types";
import type { ChassisAction } from "./chassis";
import type {
  NavigateSessionTreeOptions,
  NavigateSessionTreeResult,
  SessionTreeSnapshot,
} from "@pi-gui/session-driver/types";
import type {
  AppView,
  ContextSnapshot,
  ComposerAttachment,
  ComposerDeviceMode,
  StreamRevealMode,
  StreamRevealSpeed,
  ComposerImageAttachment,
  CreateSessionInput,
  CreateWorktreeInput,
  DesktopAppState,
  ModelSettingsScopeMode,
  NotificationPreferences,
  RemoveWorktreeInput,
  SelectedTranscriptRecord,
  SessionRecord,
  SessionExtensionUiStateRecord,
  StartChatInput,
  StartThreadInput,
  ThreadTransitionSettings,
  TranscriptMessage,
  WorkspaceSessionTarget,
} from "./desktop-state";
import type { ComposerMode } from "./composer-mode";

export type DesktopNotificationPermissionStatus =
  | "granted"
  | "denied"
  | "default"
  | "unsupported"
  | "unknown";

export type CavemanLevel = "off" | "lite" | "full" | "ultra";

export interface CavemanConfigSnapshot {
  readonly defaultLevel: CavemanLevel;
  readonly enabled: boolean;
}

export const desktopIpc = {
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
  getWorktreeRemovalPreview: "pi-gui:worktree-removal-preview",
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
  setScopedModelPatterns: "pi-gui:set-scoped-model-patterns",
  setSkillEnabled: "pi-gui:set-skill-enabled",
  setExtensionEnabled: "pi-gui:set-extension-enabled",
  deleteExtension: "pi-gui:delete-extension",
  respondToHostUiRequest: "pi-gui:respond-to-host-ui-request",
  setNotificationPreferences: "pi-gui:set-notification-preferences",
  setIntegratedTerminalShell: "pi-gui:set-integrated-terminal-shell",
  setRetrySettings: "pi-gui:set-retry-settings",
  getRetrySettings: "pi-gui:get-retry-settings",
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
  setAutoShip: "pi-gui:set-auto-ship",
  getSmartCompactSettings: "pi-gui:get-smart-compact-settings",
  setSmartCompactSettings: "pi-gui:set-smart-compact-settings",
  analyzeExtensionConfig: "pi-gui:analyze-extension-config",
  getExtensionConfig: "pi-gui:get-extension-config",
  setExtensionConfig: "pi-gui:set-extension-config",
  installExtension: "pi-gui:install-extension",
  uninstallExtension: "pi-gui:uninstall-extension",
  checkExtensionUpdates: "pi-gui:check-extension-updates",
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
  checkoutBranch: "pi-gui:checkout-branch",
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
  buildHandoffPayload: "pi-gui:build-handoff-payload",
  createSeededSession: "pi-gui:create-seeded-session",
  getSessionTranscript: "pi-gui:get-session-transcript",
  getSubagentSessionEntries: "pi-gui:get-subagent-session-entries",
  searchTranscriptText: "pi-gui:search-transcript-text",
  getThemeMode: "pi-gui:get-theme-mode",
  getResolvedTheme: "pi-gui:get-resolved-theme",
  setThemeMode: "pi-gui:set-theme-mode",
  themeChanged: "pi-gui:theme-changed",
  ping: "app:ping",
  openExternal: "app:open-external",
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

export const desktopCommands = {
  openSettings: "open-settings",
  openNewThread: "open-new-thread",
  toggleTerminal: "toggle-terminal",
  toggleSidebar: "toggle-sidebar",
  commitAndPush: "commit-and-push",
  setBuildMode: "set-build-mode",
  setPlanMode: "set-plan-mode",
} as const;

export const piDesktopApiLocalEntries = [
  "platform",
  "versions",
  "getPathForFile",
] as const;

export const piDesktopApiIpcBridge = {
  ping: { kind: "invoke", channel: desktopIpc.ping },
  getState: { kind: "invoke", channel: desktopIpc.stateRequest },
  onStateChanged: { kind: "event", channel: desktopIpc.stateChanged },
  onStatePatch: { kind: "event", channel: desktopIpc.statePatch },
  onTranscriptDelta: { kind: "event", channel: desktopIpc.transcriptDelta },
  getSelectedTranscript: { kind: "invoke", channel: desktopIpc.selectedTranscriptRequest },
  onSelectedTranscriptChanged: { kind: "event", channel: desktopIpc.selectedTranscriptChanged },
  onCommand: { kind: "event", channel: desktopIpc.appCommand },
  onWorkspacePicked: { kind: "event", channel: desktopIpc.workspacePicked },
  onClipboardImagePasted: { kind: "event", channel: desktopIpc.clipboardImagePasted },
  onUpdateStateChanged: { kind: "event", channel: desktopIpc.updateStateChanged },
  triggerCheckForUpdate: { kind: "invoke", channel: desktopIpc.checkForUpdate },
  triggerDownloadUpdate: { kind: "invoke", channel: desktopIpc.downloadUpdate },
  triggerRestartToInstall: { kind: "invoke", channel: desktopIpc.restartToInstall },
  addWorkspacePath: { kind: "invoke", channel: desktopIpc.addWorkspacePath },
  pickWorkspace: { kind: "invoke", channel: desktopIpc.pickWorkspace },
  selectWorkspace: { kind: "invoke", channel: desktopIpc.selectWorkspace },
  renameWorkspace: { kind: "invoke", channel: desktopIpc.renameWorkspace },
  removeWorkspace: { kind: "invoke", channel: desktopIpc.removeWorkspace },
  reorderWorkspaces: { kind: "invoke", channel: desktopIpc.reorderWorkspaces },
  openWorkspaceInFinder: { kind: "invoke", channel: desktopIpc.openWorkspaceInFinder },
  showFileInFolder: { kind: "invoke", channel: desktopIpc.showFileInFolder },
  createWorktree: { kind: "invoke", channel: desktopIpc.createWorktree },
  removeWorktree: { kind: "invoke", channel: desktopIpc.removeWorktree },
  getWorktreeRemovalPreview: { kind: "invoke", channel: desktopIpc.getWorktreeRemovalPreview },
  openSkillInFinder: { kind: "invoke", channel: desktopIpc.openSkillInFinder },
  openExtensionInFinder: { kind: "invoke", channel: desktopIpc.openExtensionInFinder },
  syncCurrentWorkspace: { kind: "invoke", channel: desktopIpc.syncCurrentWorkspace },
  selectSession: { kind: "invoke", channel: desktopIpc.selectSession },
  archiveSession: { kind: "invoke", channel: desktopIpc.archiveSession },
  unarchiveSession: { kind: "invoke", channel: desktopIpc.unarchiveSession },
  snoozeSession: { kind: "invoke", channel: desktopIpc.snoozeSession },
  unsnoozeSession: { kind: "invoke", channel: desktopIpc.unsnoozeSession },
  markToTestSession: { kind: "invoke", channel: desktopIpc.markToTestSession },
  unmarkToTestSession: { kind: "invoke", channel: desktopIpc.unmarkToTestSession },
  archiveAllNonRunningSessions: { kind: "invoke", channel: desktopIpc.archiveAllNonRunningSessions },
  createSession: { kind: "invoke", channel: desktopIpc.createSession },
  startThread: { kind: "invoke", channel: desktopIpc.startThread },
  cancelCurrentRun: { kind: "invoke", channel: desktopIpc.cancelCurrentRun },
  openSessionInDefaultTerminal: { kind: "invoke", channel: desktopIpc.openSessionInDefaultTerminal },
  chooseExternalTerminalApp: { kind: "invoke", channel: desktopIpc.chooseExternalTerminalApp },
  clearExternalTerminalApp: { kind: "invoke", channel: desktopIpc.clearExternalTerminalApp },
  setActiveView: { kind: "invoke", channel: desktopIpc.setActiveView },
  setSidebarCollapsed: { kind: "invoke", channel: desktopIpc.setSidebarCollapsed },
  setQueueMode: { kind: "invoke", channel: desktopIpc.setQueueMode },
  refreshRuntime: { kind: "invoke", channel: desktopIpc.refreshRuntime },
  setModelSettingsScopeMode: { kind: "invoke", channel: desktopIpc.setModelSettingsScopeMode },
  setDefaultModel: { kind: "invoke", channel: desktopIpc.setDefaultModel },
  setDefaultThinkingLevel: { kind: "invoke", channel: desktopIpc.setDefaultThinkingLevel },
  getCavemanConfig: { kind: "invoke", channel: desktopIpc.getCavemanConfig },
  setCavemanDefaultLevel: { kind: "invoke", channel: desktopIpc.setCavemanDefaultLevel },
  setCavemanOnLevel: { kind: "invoke", channel: desktopIpc.setCavemanOnLevel },
  setSessionModel: { kind: "invoke", channel: desktopIpc.setSessionModel },
  setSessionThinkingLevel: { kind: "invoke", channel: desktopIpc.setSessionThinkingLevel },
  loginProvider: { kind: "invoke", channel: desktopIpc.loginProvider },
  logoutProvider: { kind: "invoke", channel: desktopIpc.logoutProvider },
  setProviderApiKey: { kind: "invoke", channel: desktopIpc.setProviderApiKey },
  addCustomProvider: { kind: "invoke", channel: desktopIpc.addCustomProvider },
  removeCustomProvider: { kind: "invoke", channel: desktopIpc.removeCustomProvider },
  setEnableSkillCommands: { kind: "invoke", channel: desktopIpc.setEnableSkillCommands },
  setScopedModelPatterns: { kind: "invoke", channel: desktopIpc.setScopedModelPatterns },
  setSkillEnabled: { kind: "invoke", channel: desktopIpc.setSkillEnabled },
  setExtensionEnabled: { kind: "invoke", channel: desktopIpc.setExtensionEnabled },
  deleteExtension: { kind: "invoke", channel: desktopIpc.deleteExtension },
  respondToHostUiRequest: { kind: "invoke", channel: desktopIpc.respondToHostUiRequest },
  setNotificationPreferences: { kind: "invoke", channel: desktopIpc.setNotificationPreferences },
  setIntegratedTerminalShell: { kind: "invoke", channel: desktopIpc.setIntegratedTerminalShell },
  setRetrySettings: { kind: "invoke", channel: desktopIpc.setRetrySettings },
  getRetrySettings: { kind: "invoke", channel: desktopIpc.getRetrySettings },
  setSubagentSettings: { kind: "invoke", channel: desktopIpc.setSubagentSettings },
  refreshSubagentAgents: { kind: "invoke", channel: desktopIpc.refreshSubagentAgents },
  saveSubagentAgent: { kind: "invoke", channel: desktopIpc.saveSubagentAgent },
  deleteSubagentAgent: { kind: "invoke", channel: desktopIpc.deleteSubagentAgent },
  setTranscriptVerbose: { kind: "invoke", channel: desktopIpc.setTranscriptVerbose },
  setComposerDeviceMode: { kind: "invoke", channel: desktopIpc.setComposerDeviceMode },
  setStreamReveal: { kind: "invoke", channel: desktopIpc.setStreamReveal },
  setStreamRevealSpeed: { kind: "invoke", channel: desktopIpc.setStreamRevealSpeed },
  setPlanModeIdeology: { kind: "invoke", channel: desktopIpc.setPlanModeIdeology },
  setThreadTransition: { kind: "invoke", channel: desktopIpc.setThreadTransition },
  ensureTerminalPanel: { kind: "invoke", channel: desktopIpc.terminalEnsurePanel },
  createTerminalSession: { kind: "invoke", channel: desktopIpc.terminalCreateSession },
  setActiveTerminalSession: { kind: "invoke", channel: desktopIpc.terminalSetActiveSession },
  writeTerminal: { kind: "invoke", channel: desktopIpc.terminalWrite },
  resizeTerminal: { kind: "invoke", channel: desktopIpc.terminalResize },
  restartTerminalSession: { kind: "invoke", channel: desktopIpc.terminalRestartSession },
  closeTerminalSession: { kind: "invoke", channel: desktopIpc.terminalCloseSession },
  setTerminalTitle: { kind: "invoke", channel: desktopIpc.terminalSetTitle },
  setTerminalFocused: { kind: "send", channel: desktopIpc.terminalSetFocused },
  onTerminalData: { kind: "event", channel: desktopIpc.terminalData },
  onTerminalExit: { kind: "event", channel: desktopIpc.terminalExit },
  onTerminalError: { kind: "event", channel: desktopIpc.terminalError },
  getNotificationPermissionStatus: { kind: "invoke", channel: desktopIpc.getNotificationPermissionStatus },
  requestNotificationPermission: { kind: "invoke", channel: desktopIpc.requestNotificationPermission },
  openSystemNotificationSettings: { kind: "invoke", channel: desktopIpc.openSystemNotificationSettings },
  onNotificationPermissionStatusChanged: { kind: "event", channel: desktopIpc.notificationPermissionStatusChanged },
  pickComposerAttachments: { kind: "invoke", channel: desktopIpc.pickComposerAttachments },
  readClipboardImage: { kind: "sendSync", channel: desktopIpc.readClipboardImage },
  addComposerAttachments: { kind: "invoke", channel: desktopIpc.addComposerAttachments },
  removeComposerAttachment: { kind: "invoke", channel: desktopIpc.removeComposerAttachment },
  editQueuedComposerMessage: { kind: "invoke", channel: desktopIpc.editQueuedComposerMessage },
  cancelQueuedComposerEdit: { kind: "invoke", channel: desktopIpc.cancelQueuedComposerEdit },
  removeQueuedComposerMessage: { kind: "invoke", channel: desktopIpc.removeQueuedComposerMessage },
  steerQueuedComposerMessage: { kind: "invoke", channel: desktopIpc.steerQueuedComposerMessage },
  updateComposerDraft: { kind: "invoke", channel: desktopIpc.updateComposerDraft },
  submitComposer: { kind: "invoke", channel: desktopIpc.submitComposer },
  getSessionTree: { kind: "invoke", channel: desktopIpc.getSessionTree },
  navigateSessionTree: { kind: "invoke", channel: desktopIpc.navigateSessionTree },
  listWorkspaceFiles: { kind: "invoke", channel: desktopIpc.listWorkspaceFiles },
  getChangedFiles: { kind: "invoke", channel: desktopIpc.getChangedFiles },
  getWorkspaceGitInfo: { kind: "invoke", channel: desktopIpc.getWorkspaceGitInfo },
  getFileDiff: { kind: "invoke", channel: desktopIpc.getFileDiff },
  stageFile: { kind: "invoke", channel: desktopIpc.stageFile },
  undoEdits: { kind: "invoke", channel: desktopIpc.undoEdits },
  redoEdits: { kind: "invoke", channel: desktopIpc.redoEdits },
  commitPushExecute: { kind: "invoke", channel: desktopIpc.commitPushExecute },
  setCommitPushModel: { kind: "invoke", channel: desktopIpc.setCommitPushModel },
  setAutoShip: { kind: "invoke", channel: desktopIpc.setAutoShip },
  getSmartCompactSettings: { kind: "invoke", channel: desktopIpc.getSmartCompactSettings },
  setSmartCompactSettings: { kind: "invoke", channel: desktopIpc.setSmartCompactSettings },
  analyzeExtensionConfig: { kind: "invoke", channel: desktopIpc.analyzeExtensionConfig },
  getExtensionConfig: { kind: "invoke", channel: desktopIpc.getExtensionConfig },
  setExtensionConfig: { kind: "invoke", channel: desktopIpc.setExtensionConfig },
  installExtension: { kind: "invoke", channel: desktopIpc.installExtension },
  uninstallExtension: { kind: "invoke", channel: desktopIpc.uninstallExtension },
  checkExtensionUpdates: { kind: "invoke", channel: desktopIpc.checkExtensionUpdates },
  getWorkspacePrInfo: { kind: "invoke", channel: desktopIpc.getWorkspacePrInfo },
  listBranches: { kind: "invoke", channel: desktopIpc.listBranches },
  checkoutBranch: { kind: "invoke", channel: desktopIpc.checkoutBranch },
  generatePrDraft: { kind: "invoke", channel: desktopIpc.generatePrDraft },
  prCreate: { kind: "invoke", channel: desktopIpc.prCreate },
  featureDone: { kind: "invoke", channel: desktopIpc.featureDone },
  getContextSnapshot: { kind: "invoke", channel: desktopIpc.getContextSnapshot },
  getGraphifyProjectMapStatus: { kind: "invoke", channel: desktopIpc.getGraphifyProjectMapStatus },
  updateGraphifyProjectMap: { kind: "invoke", channel: desktopIpc.updateGraphifyProjectMap },
  buildGraphifyProjectMap: { kind: "invoke", channel: desktopIpc.buildGraphifyProjectMap },
  getGraphifyHealthCheck: { kind: "invoke", channel: desktopIpc.getGraphifyHealthCheck },
  getGraphifyHookStatus: { kind: "invoke", channel: desktopIpc.getGraphifyHookStatus },
  setGraphifyHook: { kind: "invoke", channel: desktopIpc.setGraphifyHook },
  getGraphifyWatchStatus: { kind: "invoke", channel: desktopIpc.getGraphifyWatchStatus },
  setGraphifyWatch: { kind: "invoke", channel: desktopIpc.setGraphifyWatch },
  readGraphifyGraph: { kind: "invoke", channel: desktopIpc.readGraphifyGraph },
  buildHandoffPayload: { kind: "invoke", channel: desktopIpc.buildHandoffPayload },
  createSeededSession: { kind: "invoke", channel: desktopIpc.createSeededSession },
  getSessionTranscript: { kind: "invoke", channel: desktopIpc.getSessionTranscript },
  getSubagentSessionEntries: { kind: "invoke", channel: desktopIpc.getSubagentSessionEntries },
  searchTranscriptText: { kind: "invoke", channel: desktopIpc.searchTranscriptText },
  toggleWindowMaximize: { kind: "invoke", channel: desktopIpc.toggleWindowMaximize },
  openOverlay: { kind: "invoke", channel: desktopIpc.openOverlay },
  closeOverlay: { kind: "invoke", channel: desktopIpc.closeOverlay },
  automationCreate: { kind: "invoke", channel: desktopIpc.automationCreate },
  automationUpdate: { kind: "invoke", channel: desktopIpc.automationUpdate },
  automationDelete: { kind: "invoke", channel: desktopIpc.automationDelete },
  automationList: { kind: "invoke", channel: desktopIpc.automationList },
  automationFireNow: { kind: "invoke", channel: desktopIpc.automationFireNow },
  startChat: { kind: "invoke", channel: desktopIpc.startChat },
  selectChat: { kind: "invoke", channel: desktopIpc.selectChat },
  archiveChat: { kind: "invoke", channel: desktopIpc.archiveChat },
  unarchiveChat: { kind: "invoke", channel: desktopIpc.unarchiveChat },
  removeChat: { kind: "invoke", channel: desktopIpc.removeChat },
  renameChat: { kind: "invoke", channel: desktopIpc.renameChat },
  getChatAgentsMd: { kind: "invoke", channel: desktopIpc.getChatAgentsMd },
  writeChatAgentsMd: { kind: "invoke", channel: desktopIpc.writeChatAgentsMd },
  openExternal: { kind: "invoke", channel: desktopIpc.openExternal },
  getThemeMode: { kind: "invoke", channel: desktopIpc.getThemeMode },
  getResolvedTheme: { kind: "invoke", channel: desktopIpc.getResolvedTheme },
  setThemeMode: { kind: "invoke", channel: desktopIpc.setThemeMode },
  onThemeChanged: { kind: "event", channel: desktopIpc.themeChanged },
  onLiveEditStats: { kind: "event", channel: desktopIpc.liveEditStats },
  listGhMilestones: { kind: "invoke", channel: desktopIpc.listGhMilestones },
  runGhMilestone: { kind: "invoke", channel: desktopIpc.runGhMilestone },
  cancelGhRun: { kind: "invoke", channel: desktopIpc.cancelGhRun },
} as const;

export function getDesktopShortcutLabel(platform: NodeJS.Platform, key: string): string {
  return `${platform === "darwin" ? "⌘" : "Ctrl+"}${key.toUpperCase()}`;
}

export type PiDesktopStateListener = (state: DesktopAppState) => void;
export type PiDesktopSelectedTranscriptListener = (payload: SelectedTranscriptRecord | null) => void;
export type PiDesktopCommand = (typeof desktopCommands)[keyof typeof desktopCommands];

export interface TerminalSize {
  readonly cols: number;
  readonly rows: number;
}

export type TerminalSessionStatus = "running" | "exited" | "error";

export interface TerminalSessionSnapshot {
  readonly id: string;
  readonly workspaceId: string;
  readonly cwd: string;
  readonly shell: string;
  readonly title: string;
  readonly status: TerminalSessionStatus;
  readonly replay: string;
  readonly truncated: boolean;
  readonly exitCode?: number;
  readonly signal?: number;
}

export interface TerminalPanelSnapshot {
  readonly workspaceId: string;
  readonly rootKey: string;
  readonly activeSessionId: string;
  readonly sessions: readonly TerminalSessionSnapshot[];
}

export interface TerminalDataEvent {
  readonly terminalId: string;
  readonly data: string;
}

export interface TerminalExitEvent {
  readonly terminalId: string;
  readonly exitCode?: number;
  readonly signal?: number;
}

export interface TerminalErrorEvent {
  readonly terminalId: string;
  readonly message: string;
}

export interface DesktopShortcutInput {
  readonly modifier: boolean;
  readonly shift: boolean;
  readonly key: string;
  readonly code?: string;
}

const shortcutTable: ReadonlyArray<{
  readonly shift: boolean;
  readonly match: (input: DesktopShortcutInput) => boolean;
  readonly command: PiDesktopCommand;
}> = [
  { shift: false, match: (i) => i.key === "," || i.code === "Comma", command: desktopCommands.openSettings },
  { shift: false, match: (i) => i.key.toLowerCase() === "j" || i.code === "KeyJ", command: desktopCommands.toggleTerminal },
  { shift: false, match: (i) => i.key.toLowerCase() === "s" || i.code === "KeyS", command: desktopCommands.toggleSidebar },
  { shift: false, match: (i) => i.key.toLowerCase() === "n" || i.code === "KeyN", command: desktopCommands.openNewThread },
  { shift: true, match: (i) => i.key.toLowerCase() === "o" || i.code === "KeyO", command: desktopCommands.openNewThread },
  { shift: true, match: (i) => i.key.toLowerCase() === "k" || i.code === "KeyK", command: desktopCommands.commitAndPush },
  { shift: false, match: (i) => i.key.toLowerCase() === "b" || i.code === "KeyB", command: desktopCommands.setBuildMode },
  { shift: false, match: (i) => i.key.toLowerCase() === "p" || i.code === "KeyP", command: desktopCommands.setPlanMode },
];

export function getDesktopCommandFromShortcut(input: DesktopShortcutInput): PiDesktopCommand | undefined {
  if (!input.modifier) return undefined;
  for (const entry of shortcutTable) {
    if (entry.shift === input.shift && entry.match(input)) return entry.command;
  }
  return undefined;
}

export type PrState = "none" | "open" | "closed" | "merged";

export interface WorkspacePrInfo {
  readonly ghAvailable: boolean;
  readonly isGitRepo: boolean;
  readonly hasUpstream: boolean;
  readonly headBranch: string;
  readonly defaultBranch: string;
  readonly prState: PrState;
  readonly prUrl?: string;
  readonly prNumber?: number;
  readonly baseBranch?: string;
}

export interface PrDraftResult {
  readonly success: boolean;
  readonly title: string;
  readonly body: string;
  readonly message?: string;
}

export interface UndoEditReplacement {
  readonly oldText: string;
  readonly newText: string;
}

export interface UndoEditOp {
  readonly kind: "edit" | "write";
  readonly path: string;
  readonly replacements?: readonly UndoEditReplacement[];
}

export interface UndoEditsResult {
  readonly reverted: string[];
  readonly failed: { path: string; reason: string }[];
}

export interface LiveEditStats {
  readonly callId: string;
  readonly filePath: string;
  readonly added: number;
  readonly removed: number;
}

export interface CreatePrInput {
  readonly title: string;
  readonly body: string;
  readonly base: string;
  readonly draft: boolean;
}

export interface CreatePrResult {
  readonly success: boolean;
  readonly message: string;
  readonly url?: string;
  readonly number?: number;
}

export interface BranchInfo {
  readonly name: string;
  readonly isCurrent: boolean;
  readonly isRemote: boolean;
}

export interface BranchListResult {
  readonly branches: readonly BranchInfo[];
  readonly currentBranch: string;
  readonly isDirty: boolean;
}

export interface FeatureDoneInput {
  readonly workspaceId: string;
  readonly threadTitle: string;
  readonly modelString: string;
}

export interface FeatureDoneResult {
  readonly status: "ok" | "conflicts" | "error";
  readonly message: string;
  readonly prUrl?: string;
  readonly prNumber?: number;
  readonly branchName?: string;
  readonly conflicts?: ReadonlyArray<{ file: string; content: string }>;
  readonly handoffPrompt?: string;
}

export interface DesktopLivePatch {
  readonly workspaceId: string;
  readonly session: SessionRecord | null;
  readonly extensionUi?: SessionExtensionUiStateRecord;
}

export interface TranscriptSearchMatch {
  readonly sessionKey: string;
  readonly snippet: string;
  readonly messageId: string;
}

export interface TranscriptDelta {
  readonly sessionId: string;
  readonly workspaceId: string;
  readonly initial: boolean;
  readonly messages: readonly TranscriptMessage[];
}

export interface ExtensionConfigField {
  readonly key: string;
  readonly label: string;
  readonly type: "string" | "number" | "boolean" | "select";
  readonly description?: string;
  readonly defaultValue?: string | number | boolean;
  readonly currentValue?: string | number | boolean;
  readonly options?: readonly string[];
  readonly source: "env" | "file" | "flag" | "constant";
  readonly sourcePath?: string;
}

export interface ExtensionConfigSchema {
  readonly extensionPath: string;
  readonly displayName: string;
  readonly fields: readonly ExtensionConfigField[];
  readonly analyzedAt: string;
  readonly analyzedBy?: string;
}

export interface ExtensionConfigValue {
  readonly key: string;
  readonly value: string | number | boolean;
}

export type HandoffScope = "compressed" | "full" | "plan" | "selection";

export interface BuildHandoffPayloadInput {
  readonly workspaceId: string;
  readonly sessionId: string;
  readonly scope: HandoffScope;
  readonly quotedText?: string;
  readonly userNote?: string;
  readonly framing?: string;
}

export interface HandoffPayload {
  readonly seedText: string;
  readonly scope: HandoffScope;
  readonly tokenEstimate: number;
}

export type UpdateStatus =
  | "checking"
  | "update-available"
  | "downloading"
  | "downloaded"
  | "up-to-date"
  | "error";

export interface UpdateState {
  readonly status: UpdateStatus;
  readonly currentVersion?: string;
  readonly latestVersion?: string;
  readonly downloadProgress?: number; // 0-100
  readonly errorMessage?: string;
}

export type UpdateCheckResult =
  | { status: "up-to-date"; currentVersion: string; latestVersion: string }
  | { status: "update-available"; currentVersion: string; latestVersion: string }
  | { status: "downloading"; currentVersion: string; latestVersion: string }
  | { status: "downloaded"; currentVersion: string; latestVersion: string }
  | { status: "error"; message: string };

export interface CreateSeededSessionInput {
  readonly workspaceId: string;
  readonly title: string;
  readonly seedText: string;
  readonly model?: string;
}

export interface CreateSeededSessionResult {
  readonly sessionId: string;
}

export interface SmartCompactSettings {
  readonly summaryModel?: string;
  readonly minContextPercent?: number;
  readonly minTokenThreshold?: number;
  readonly autoTrigger?: boolean;
}

export interface GraphifyCommunitySummary {
  readonly name: string;
  readonly nodeCount?: number;
  readonly edgeCount?: number;
}

export interface GraphifyProjectMapStatus {
  readonly workspaceId: string;
  readonly workspacePath: string;
  readonly available: boolean;
  readonly stale: boolean;
  readonly graphPath?: string;
  readonly reportPath?: string;
  readonly htmlPath?: string;
  readonly builtCommit?: string;
  readonly currentCommit?: string;
  readonly nodeCount?: number;
  readonly edgeCount?: number;
  readonly communityCount?: number;
  readonly communities: readonly GraphifyCommunitySummary[];
  readonly reportPreview?: string;
  readonly error?: string;
}

export interface GraphifyRunResult {
  readonly success: boolean;
  readonly message: string;
  readonly status?: GraphifyProjectMapStatus;
}

export interface GraphifyHealthIssue {
  readonly severity: "error" | "warning";
  readonly code: string;
  readonly message: string;
  readonly fixHint?: string;
}

export interface GraphifyHealthCheckResult {
  readonly healthy: boolean;
  readonly issues: readonly GraphifyHealthIssue[];
  readonly debugPrompt?: string;
}

export interface GraphifyHookStatus {
  readonly postCommit: boolean;
  readonly postCheckout: boolean;
}

export interface GraphifyWatchStatus {
  readonly running: boolean;
  readonly pid?: number;
}

export interface CustomProviderConfig {
  readonly providerId: string;
  readonly displayName: string;
  readonly baseUrl: string;
  readonly api: "openai-completions" | "openai-responses" | "anthropic-messages";
  readonly apiKey: string;
  readonly models: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly reasoning: boolean;
    readonly input: readonly ("text" | "image")[];
    readonly contextWindow: number;
    readonly maxTokens: number;
  }>;
}

export interface PiDesktopApi {
  platform: NodeJS.Platform;
  versions: NodeJS.ProcessVersions;
  ping(): Promise<string>;
  getState(): Promise<DesktopAppState>;
  onStateChanged(listener: PiDesktopStateListener): () => void;
  onStatePatch(listener: (patch: DesktopLivePatch) => void): () => void;
  onTranscriptDelta(listener: (delta: TranscriptDelta) => void): () => void;

  getSelectedTranscript(): Promise<SelectedTranscriptRecord | null>;
  onSelectedTranscriptChanged(listener: PiDesktopSelectedTranscriptListener): () => void;
  onCommand(listener: (command: PiDesktopCommand) => void): () => void;
  onWorkspacePicked(listener: (workspaceId: string) => void): () => void;
  onClipboardImagePasted(listener: (attachment: ComposerImageAttachment) => void): () => void;
  getPathForFile(file: File): string;
  addWorkspacePath(path: string): Promise<DesktopAppState>;
  pickWorkspace(): Promise<DesktopAppState>;
  selectWorkspace(workspaceId: string): Promise<DesktopAppState>;
  renameWorkspace(workspaceId: string, displayName: string): Promise<DesktopAppState>;
  removeWorkspace(workspaceId: string): Promise<DesktopAppState>;
  reorderWorkspaces(workspaceOrder: readonly string[]): Promise<DesktopAppState>;
  openWorkspaceInFinder(workspaceId: string): Promise<void>;
  showFileInFolder(workspaceId: string, filePath: string): Promise<void>;
  createWorktree(input: CreateWorktreeInput): Promise<DesktopAppState>;
  removeWorktree(input: RemoveWorktreeInput): Promise<DesktopAppState>;
  getWorktreeRemovalPreview(worktreeId: string): Promise<{ readonly uncommittedFiles: number; readonly unpushedCommits: number }>;
  openSkillInFinder(workspaceId: string, filePath: string): Promise<void>;
  openExtensionInFinder(workspaceId: string, filePath: string): Promise<void>;
  syncCurrentWorkspace(): Promise<DesktopAppState>;
  selectSession(target: WorkspaceSessionTarget): Promise<DesktopAppState>;
  archiveSession(target: WorkspaceSessionTarget): Promise<DesktopAppState>;
  unarchiveSession(target: WorkspaceSessionTarget): Promise<DesktopAppState>;
  snoozeSession(target: WorkspaceSessionTarget, until: string): Promise<DesktopAppState>;
  unsnoozeSession(target: WorkspaceSessionTarget): Promise<DesktopAppState>;
  markToTestSession(target: WorkspaceSessionTarget): Promise<DesktopAppState>;
  unmarkToTestSession(target: WorkspaceSessionTarget): Promise<DesktopAppState>;
  archiveAllNonRunningSessions(workspaceId: string, olderThanMs?: number): Promise<DesktopAppState>;
  createSession(input: CreateSessionInput): Promise<DesktopAppState>;
  startThread(input: StartThreadInput): Promise<DesktopAppState>;
  cancelCurrentRun(): Promise<DesktopAppState>;
  openSessionInDefaultTerminal(): Promise<DesktopAppState>;
  chooseExternalTerminalApp(): Promise<DesktopAppState>;
  clearExternalTerminalApp(): Promise<DesktopAppState>;
  setActiveView(view: AppView): Promise<DesktopAppState>;
  setSidebarCollapsed(collapsed: boolean): Promise<DesktopAppState>;
  setQueueMode(enabled: boolean): Promise<DesktopAppState>;
  refreshRuntime(workspaceId?: string): Promise<DesktopAppState>;
  setModelSettingsScopeMode(mode: ModelSettingsScopeMode): Promise<DesktopAppState>;
  setDefaultModel(workspaceId: string, provider: string, modelId: string): Promise<DesktopAppState>;
  setDefaultThinkingLevel(
    workspaceId: string,
    thinkingLevel: RuntimeSettingsSnapshot["defaultThinkingLevel"],
  ): Promise<DesktopAppState>;
  getCavemanConfig(): Promise<CavemanConfigSnapshot>;
  setCavemanDefaultLevel(level: CavemanLevel): Promise<CavemanConfigSnapshot>;
  setCavemanOnLevel(level: CavemanLevel): Promise<CavemanConfigSnapshot>;
  getChassisActions(): Promise<ChassisAction[]>;
  setChassisActions(actions: ChassisAction[]): Promise<ChassisAction[]>;
  setSessionModel(
    workspaceId: string,
    sessionId: string,
    provider: string,
    modelId: string,
  ): Promise<DesktopAppState>;
  setSessionThinkingLevel(
    workspaceId: string,
    sessionId: string,
    thinkingLevel: NonNullable<RuntimeSettingsSnapshot["defaultThinkingLevel"]>,
  ): Promise<DesktopAppState>;
  loginProvider(workspaceId: string, providerId: string): Promise<DesktopAppState>;
  logoutProvider(workspaceId: string, providerId: string): Promise<DesktopAppState>;
  setProviderApiKey(workspaceId: string, providerId: string, apiKey: string): Promise<DesktopAppState>;
  addCustomProvider(workspaceId: string, config: CustomProviderConfig): Promise<DesktopAppState>;
  removeCustomProvider(workspaceId: string, providerId: string): Promise<DesktopAppState>;
  setEnableSkillCommands(workspaceId: string, enabled: boolean): Promise<DesktopAppState>;
  setScopedModelPatterns(workspaceId: string, patterns: readonly string[]): Promise<DesktopAppState>;
  setSkillEnabled(workspaceId: string, filePath: string, enabled: boolean): Promise<DesktopAppState>;
  setExtensionEnabled(workspaceId: string, filePath: string, enabled: boolean): Promise<DesktopAppState>;
  deleteExtension(workspaceId: string, filePath: string): Promise<DesktopAppState>;
  respondToHostUiRequest(
    workspaceId: string,
    sessionId: string,
    response:
      | { readonly requestId: string; readonly value: string }
      | { readonly requestId: string; readonly confirmed: boolean }
      | { readonly requestId: string; readonly answers: readonly { readonly id: string; readonly value: string; readonly label: string; readonly wasCustom: boolean; readonly index?: number }[] }
      | { readonly requestId: string; readonly cancelled: true }
      | { readonly requestId: string; readonly terminalInput: string },
  ): Promise<DesktopAppState>;
  setNotificationPreferences(preferences: Partial<NotificationPreferences>): Promise<DesktopAppState>;
  setIntegratedTerminalShell(shell: string): Promise<DesktopAppState>;
  setRetrySettings(settings: { enabled: boolean; maxRetries: number; baseDelayMs: number }): Promise<DesktopAppState>;
  getRetrySettings(): Promise<{ enabled: boolean; maxRetries: number; baseDelayMs: number }>;
  setSubagentSettings(settings: Partial<import("./desktop-state").SubagentSettingsRecord>): Promise<DesktopAppState>;
  refreshSubagentAgents(workspaceId: string): Promise<DesktopAppState>;
  saveSubagentAgent(workspaceId: string, input: { readonly name: string; readonly raw: string; readonly scope?: "project" | "global" }): Promise<DesktopAppState>;
  deleteSubagentAgent(workspaceId: string, name: string, scope?: "project" | "global"): Promise<DesktopAppState>;
  setTranscriptVerbose(enabled: boolean): Promise<DesktopAppState>;
  setComposerDeviceMode(mode: ComposerDeviceMode): Promise<DesktopAppState>;
  setStreamReveal(mode: StreamRevealMode): Promise<DesktopAppState>;
  setStreamRevealSpeed(speed: StreamRevealSpeed): Promise<DesktopAppState>;
  setPlanModeIdeology(ideology: import("./desktop-state").PlanModeIdeologySetting): Promise<DesktopAppState>;
  setThreadTransition(settings: Partial<ThreadTransitionSettings>): Promise<DesktopAppState>;
  ensureTerminalPanel(
    workspaceId: string,
    terminalScopeId: string,
    size?: Partial<TerminalSize>,
  ): Promise<TerminalPanelSnapshot>;
  createTerminalSession(
    workspaceId: string,
    terminalScopeId: string,
    size?: Partial<TerminalSize>,
  ): Promise<TerminalPanelSnapshot>;
  setActiveTerminalSession(
    workspaceId: string,
    terminalScopeId: string,
    terminalId: string,
  ): Promise<TerminalPanelSnapshot>;
  writeTerminal(terminalId: string, data: string): Promise<void>;
  resizeTerminal(terminalId: string, size: TerminalSize): Promise<void>;
  restartTerminalSession(terminalId: string, size?: Partial<TerminalSize>): Promise<TerminalPanelSnapshot>;
  closeTerminalSession(terminalId: string): Promise<TerminalPanelSnapshot | null>;
  setTerminalTitle(terminalId: string, title: string): Promise<void>;
  setTerminalFocused(focused: boolean): Promise<void>;
  onTerminalData(listener: (event: TerminalDataEvent) => void): () => void;
  onTerminalExit(listener: (event: TerminalExitEvent) => void): () => void;
  onTerminalError(listener: (event: TerminalErrorEvent) => void): () => void;
  getNotificationPermissionStatus(): Promise<DesktopNotificationPermissionStatus>;
  requestNotificationPermission(): Promise<DesktopNotificationPermissionStatus>;
  openSystemNotificationSettings(): Promise<void>;
  onNotificationPermissionStatusChanged(
    callback: (status: DesktopNotificationPermissionStatus) => void,
  ): () => void;
  pickComposerAttachments(): Promise<DesktopAppState>;
  readClipboardImage(): ComposerImageAttachment | null;
  addComposerAttachments(attachments: readonly ComposerAttachment[]): Promise<DesktopAppState>;
  removeComposerAttachment(attachmentId: string): Promise<DesktopAppState>;
  editQueuedComposerMessage(messageId: string, currentDraft?: string): Promise<DesktopAppState>;
  cancelQueuedComposerEdit(): Promise<DesktopAppState>;
  removeQueuedComposerMessage(messageId: string): Promise<DesktopAppState>;
  steerQueuedComposerMessage(messageId: string): Promise<DesktopAppState>;
  updateComposerDraft(composerDraft: string): Promise<DesktopAppState>;
  submitComposer(text: string, options?: { readonly deliverAs?: "steer" | "followUp"; readonly mode?: ComposerMode; readonly isFirstPlanPrompt?: boolean }): Promise<DesktopAppState>;
  getSessionTree(target: WorkspaceSessionTarget): Promise<SessionTreeSnapshot>;
  navigateSessionTree(
    target: WorkspaceSessionTarget,
    targetId: string,
    options?: NavigateSessionTreeOptions,
  ): Promise<{ readonly state: DesktopAppState; readonly result: NavigateSessionTreeResult }>;
  listWorkspaceFiles(workspaceId: string): Promise<string[]>;
  getChangedFiles(workspaceId: string): Promise<{ path: string; status: "added" | "modified" | "deleted" | "untracked"; staged: boolean }[]>;
  getWorkspaceGitInfo(workspaceId: string): Promise<{ readonly isGitRepo: boolean; readonly changedCount: number }>;
  getFileDiff(workspaceId: string, filePath: string): Promise<string>;
  stageFile(workspaceId: string, filePath: string): Promise<void>;
  undoEdits(workspaceId: string, ops: readonly UndoEditOp[]): Promise<UndoEditsResult>;
  redoEdits(workspaceId: string, ops: readonly UndoEditOp[]): Promise<UndoEditsResult>;
  commitPushExecute(workspaceId: string, branchHint?: string): Promise<{ readonly success: boolean; readonly message: string; readonly commitMessage?: string }>;
  setCommitPushModel(workspaceId: string, model: string): Promise<DesktopAppState>;
  setAutoShip(value: boolean): Promise<DesktopAppState>;
  getSmartCompactSettings(): Promise<SmartCompactSettings>;
  setSmartCompactSettings(settings: Partial<SmartCompactSettings>): Promise<SmartCompactSettings>;
  analyzeExtensionConfig(extensionPath: string, model?: string): Promise<ExtensionConfigSchema>;
  getExtensionConfig(extensionPath: string): Promise<ExtensionConfigSchema | null>;
  setExtensionConfig(extensionPath: string, values: readonly ExtensionConfigValue[]): Promise<void>;
  installExtension(source: string, local?: boolean): Promise<{ success: boolean; message: string }>;
  uninstallExtension(source: string, local?: boolean): Promise<{ success: boolean; message: string }>;
  checkExtensionUpdates(): Promise<{ source: string; current: string; latest: string }[]>;
  getWorkspacePrInfo(workspaceId: string): Promise<WorkspacePrInfo>;
  startChat(input: StartChatInput): Promise<DesktopAppState>;
  selectChat(chatId: string): Promise<DesktopAppState>;
  archiveChat(chatId: string): Promise<DesktopAppState>;
  unarchiveChat(chatId: string): Promise<DesktopAppState>;
  removeChat(chatId: string): Promise<DesktopAppState>;
  renameChat(chatId: string, title: string): Promise<DesktopAppState>;
  getChatAgentsMd(chatId: string): Promise<string>;
  writeChatAgentsMd(chatId: string, content: string): Promise<void>;
  generatePrDraft(workspaceId: string, baseBranch?: string): Promise<PrDraftResult>;
  prCreate(workspaceId: string, input: CreatePrInput): Promise<CreatePrResult>;
  listBranches(workspaceId: string): Promise<BranchListResult>;
  checkoutBranch(workspaceId: string, branchName: string): Promise<{ readonly success: boolean; readonly message: string }>;
  createBranch(workspaceId: string, branchName: string): Promise<{ readonly success: boolean; readonly message: string }>;
  getWorkspaceDiffStat(workspaceId: string): Promise<{ readonly insertions: number; readonly deletions: number }>;
  featureDone(input: FeatureDoneInput): Promise<FeatureDoneResult>;
  getContextSnapshot(workspaceId: string, sessionId?: string): Promise<ContextSnapshot>;
  getGraphifyProjectMapStatus(workspaceId: string): Promise<GraphifyProjectMapStatus>;
  updateGraphifyProjectMap(workspaceId: string): Promise<GraphifyRunResult>;
  buildGraphifyProjectMap(workspaceId: string): Promise<GraphifyRunResult>;
  getGraphifyHealthCheck(workspaceId: string): Promise<GraphifyHealthCheckResult>;
  getGraphifyHookStatus(workspaceId: string): Promise<GraphifyHookStatus>;
  setGraphifyHook(workspaceId: string, enable: boolean): Promise<{ success: boolean; message: string }>;
  getGraphifyWatchStatus(workspaceId: string): Promise<GraphifyWatchStatus>;
  setGraphifyWatch(workspaceId: string, enable: boolean): Promise<{ success: boolean; message: string }>;
  readGraphifyGraph(workspaceId: string): Promise<Record<string, unknown>>;
  buildHandoffPayload(input: BuildHandoffPayloadInput): Promise<HandoffPayload>;
  createSeededSession(input: CreateSeededSessionInput): Promise<CreateSeededSessionResult>;
  getSessionTranscript(workspaceId: string, sessionId: string): Promise<readonly TranscriptMessage[]>;
  getSubagentSessionEntries(sessionFilePath: string): Promise<readonly unknown[]>;
  searchTranscriptText(sessionKeys: readonly string[], query: string): Promise<readonly TranscriptSearchMatch[]>;
  automationCreate(input: { name?: string; prompt: string; schedule: import("./desktop-state").AutomationSchedule; workspaceId: string; environment?: import("./desktop-state").ThreadLocation; model?: { provider: string; modelId: string }; thinkingLevel?: string; enabled?: boolean }): Promise<DesktopAppState>;
  automationUpdate(id: string, patch: Partial<Pick<import("./desktop-state").Automation, "name" | "prompt" | "schedule" | "workspaceId" | "environment" | "model" | "thinkingLevel" | "enabled">>): Promise<DesktopAppState>;
  automationDelete(id: string): Promise<DesktopAppState>;
  automationList(): Promise<DesktopAppState>;
  automationFireNow(id: string): Promise<DesktopAppState>;
  onLiveEditStats(listener: (stats: LiveEditStats) => void): () => void;
  // -- Update --
  onUpdateStateChanged(listener: (state: UpdateState) => void): () => void;
  triggerCheckForUpdate(): Promise<UpdateCheckResult>;
  triggerDownloadUpdate(): Promise<void>;
  triggerRestartToInstall(): Promise<void>;

  toggleWindowMaximize(): Promise<void>;
  openOverlay(): Promise<void>;
  closeOverlay(): Promise<void>;
  openExternal(url: string): Promise<void>;
  getThemeMode(): Promise<"system" | "light" | "dark" | "dracula">;
  getResolvedTheme(): Promise<"light" | "dark">;
  setThemeMode(mode: "system" | "light" | "dark" | "dracula"): Promise<string>;
  onThemeChanged(callback: (theme: "light" | "dark") => void): () => void;

  listGhMilestones(workspaceId?: string): Promise<DesktopAppState>;
  runGhMilestone(workspaceId: string, milestoneNumber: number): Promise<DesktopAppState>;
  cancelGhRun(): Promise<DesktopAppState>;
}

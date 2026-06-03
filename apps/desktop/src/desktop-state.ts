import type { HostUiRequest, SessionConfig } from "@pi-gui/session-driver";
import type { ModelSettingsSnapshot, RuntimeCommandRecord, RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
export type SessionStatus = "idle" | "running" | "failed";
export type { SessionRole, TranscriptMessage } from "./timeline-types";
import type { TranscriptMessage } from "./timeline-types";

export type AppView = "threads" | "new-thread" | "skills" | "extensions" | "settings";
export type WorkspaceKind = "primary" | "worktree";
export type WorktreeStatus = "ready" | "missing" | "error";
export type NewThreadEnvironment = "local" | "worktree";
export type ThemeMode = "system" | "light" | "dark" | "dracula";

export type ComposerDeviceMode = "off" | "screen" | "modular" | "screen-neon";
export type ModelSettingsScopeMode = "app-global" | "per-repo";
export type ComposerDraftSyncSource =
  | "state"
  | "selection"
  | "persist"
  | "command"
  | "extension-editor-text"
  | "queued-message-edit";

export type ChatStatus = "idle" | "running" | "failed";

export interface ChatConfig {
  readonly provider?: string;
  readonly modelId?: string;
  readonly thinkingLevel?: string;
}

export interface ChatContextUsage {
  readonly tokenCount?: number;
  readonly percentUsed?: number;
}

export interface ChatRecord {
  readonly id: string;
  readonly title: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly archivedAt?: string;
  readonly preview: string;
  readonly status: ChatStatus;
  readonly runningSince?: string;
  readonly hasUnseenUpdate: boolean;
  readonly isAwaitingAssistantText: boolean;
  readonly config?: ChatConfig;
  readonly contextUsage?: ChatContextUsage;
  readonly chatWorkspaceId?: string;
}

export interface NotificationPreferences {
  readonly backgroundCompletion: boolean;
  readonly backgroundFailure: boolean;
  readonly attentionNeeded: boolean;
}

export interface SubagentSettingsRecord {
  readonly orchestratorMode: boolean;
  readonly disableCoordinatorOnlyTurn: boolean;
  readonly disableChildContextBoundary: boolean;
  readonly disableSessionTitles: boolean;
  readonly mux: "auto" | "cmux" | "tmux" | "zellij" | "wezterm";
  readonly piCommandOverride: string;
}

export interface SubagentAgentRecord {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly model?: string;
  readonly thinking?: string;
  readonly mode?: "interactive" | "background";
  readonly async?: boolean;
  readonly autoExit?: boolean;
  readonly sessionMode?: "standalone" | "lineage-only" | "fork";
  readonly allowModelOverride?: boolean;
  readonly filePath: string;
  readonly scope: "project" | "global";
  readonly raw: string;
}

export interface ComposerImageAttachment {
  readonly id: string;
  readonly kind: "image";
  readonly name: string;
  readonly mimeType: string;
  readonly data: string;
}

export interface ComposerFileAttachment {
  readonly id: string;
  readonly kind: "file";
  readonly name: string;
  readonly mimeType: string;
  readonly fsPath: string;
  readonly sizeBytes?: number;
}

export type ComposerAttachment = ComposerImageAttachment | ComposerFileAttachment;

export type QueuedComposerMessageMode = "steer" | "followUp";

export interface QueuedComposerMessage {
  readonly id: string;
  readonly mode: QueuedComposerMessageMode;
  readonly text: string;
  readonly attachments: readonly ComposerAttachment[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SessionContextUsage {
  readonly usedTokens: number;
  readonly contextWindow: number;
}

/**
 * A runnable, incomplete Ralph plan (a `.ralph/` bundle) discovered in a
 * workspace. Surfaced in the new-thread Ralph picker so a plan can be launched
 * as a loop.
 */
export interface RalphPlanSummary {
  /** Human title taken from `.ralph/plan.md`'s first heading. */
  readonly title: string;
  readonly totalItems: number;
  readonly doneItems: number;
  /** Prompt reference passed to `/ralph-loop` bundle mode. */
  readonly promptRef: string;
  /** Pre-filled max-iterations (from a prior loop run, else the ralph default). */
  readonly defaultMaxIterations: number;
}

/**
 * Status of a Ralph loop owning the selected workspace, read from
 * `.ralph/loop.md`. Drives the loop thread's locked composer + control bar.
 */
export interface RalphLoopStatus {
  readonly running: boolean;
  readonly iteration: number;
  readonly maxIterations: number;
  readonly stopReason?: string;
  readonly sessionId?: string;
  /** True when the selected session is the loop's current active iteration. */
  readonly isSelectedSessionActive: boolean;
}

export interface SessionRecord {
  readonly id: string;
  readonly title: string;
  readonly updatedAt: string;
  readonly lastViewedAt?: string;
  readonly archivedAt?: string;
  readonly preview: string;
  readonly status: SessionStatus;
  readonly runningSince?: string;
  readonly hasUnseenUpdate: boolean;
  readonly isAwaitingAssistantText: boolean;
  readonly config?: SessionConfig;
  readonly contextUsage?: SessionContextUsage;
}

export interface SelectedTranscriptRecord {
  readonly workspaceId: string;
  readonly sessionId: string;
  readonly transcript: readonly TranscriptMessage[];
}

export interface WorktreeRecord {
  readonly id: string;
  readonly rootWorkspaceId: string;
  readonly linkedWorkspaceId?: string;
  readonly name: string;
  readonly path: string;
  readonly status: WorktreeStatus;
  readonly branchName?: string;
  readonly updatedAt: string;
}

export interface SessionExtensionStatusRecord {
  readonly key: string;
  readonly text: string;
}

export interface SessionExtensionWidgetRecord {
  readonly key: string;
  readonly lines: readonly string[];
  readonly placement: "aboveComposer" | "belowComposer";
}

export type SessionExtensionDialogRecord = Extract<
  HostUiRequest,
  { readonly kind: "confirm" | "select" | "input" | "editor" | "questionnaire" }
>;

export interface SessionExtensionUiStateRecord {
  readonly statuses: readonly SessionExtensionStatusRecord[];
  readonly widgets: readonly SessionExtensionWidgetRecord[];
  readonly pendingDialogs: readonly SessionExtensionDialogRecord[];
  readonly title?: string;
  readonly editorText?: string;
}

export type ExtensionCommandCompatibilityStatus = "supported" | "terminal-only";

export interface ExtensionCommandCompatibilityRecord {
  readonly commandName: string;
  readonly extensionPath: string;
  readonly status: ExtensionCommandCompatibilityStatus;
  readonly message: string;
  readonly capability: string;
  readonly updatedAt: string;
}

export interface WorkspaceRecord {
  readonly id: string;
  readonly name: string;
  readonly path: string;
  readonly lastOpenedAt: string;
  readonly kind: WorkspaceKind;
  readonly rootWorkspaceId?: string;
  readonly branchName?: string;
  readonly sessions: readonly SessionRecord[];
  /** Incomplete Ralph plans found in this workspace, launchable as loops. */
  readonly ralphPlans?: readonly RalphPlanSummary[];
}

export interface CreateWorktreeInput {
  readonly workspaceId: string;
  readonly fromSessionWorkspaceId?: string;
  readonly fromSessionId?: string;
}

export type StartThreadInput = {
  readonly rootWorkspaceId: string;
  readonly environment: NewThreadEnvironment;
  readonly prompt?: string;
  readonly attachments?: readonly ComposerAttachment[];
  readonly provider?: string;
  readonly modelId?: string;
  readonly thinkingLevel?: string;
};

export type StartChatInput = {
  readonly prompt?: string;
  readonly attachments?: readonly ComposerAttachment[];
  readonly provider?: string;
  readonly modelId?: string;
  readonly thinkingLevel?: string;
};

export interface RemoveWorktreeInput {
  readonly workspaceId: string;
  readonly worktreeId: string;
}

export interface DesktopAppState {
  readonly workspaces: readonly WorkspaceRecord[];
  readonly worktreesByWorkspace: Readonly<Record<string, readonly WorktreeRecord[]>>;
  readonly selectedWorkspaceId: string;
  readonly selectedSessionId: string;
  readonly activeView: AppView;
  readonly composerDraft: string;
  readonly composerDraftSyncSource: ComposerDraftSyncSource;
  readonly composerDraftSyncNonce: number;
  readonly composerAttachments: readonly ComposerAttachment[];
  readonly queuedComposerMessages: readonly QueuedComposerMessage[];
  readonly editingQueuedMessageId?: string;
  readonly runtimeByWorkspace: Readonly<Record<string, RuntimeSnapshot>>;
  readonly sessionCommandsBySession: Readonly<Record<string, readonly RuntimeCommandRecord[]>>;
  readonly sessionExtensionUiBySession: Readonly<Record<string, SessionExtensionUiStateRecord>>;
  readonly extensionCommandCompatibilityByWorkspace: Readonly<Record<string, readonly ExtensionCommandCompatibilityRecord[]>>;
  readonly notificationPreferences: NotificationPreferences;
  readonly subagentSettings: SubagentSettingsRecord;
  readonly subagentAgentsByWorkspace: Record<string, readonly SubagentAgentRecord[]>;
  readonly integratedTerminalShell: string;
  readonly externalTerminalApp: string;
  readonly lastViewedAtBySession: Readonly<Record<string, string>>;
  readonly workspaceOrder: readonly string[];
  readonly modelSettingsScopeMode: ModelSettingsScopeMode;
  readonly globalModelSettings: ModelSettingsSnapshot;
  readonly sidebarCollapsed: boolean;
  readonly enableTransparency: boolean;
  readonly transcriptVerbose: boolean;
  readonly autoAcceptVisionProxy: boolean;
  readonly composerDeviceMode: ComposerDeviceMode;
  readonly themeMode: ThemeMode;
  readonly commitPushModel?: string;
  readonly chats: readonly ChatRecord[];
  readonly selectedChatId: string;
  readonly selectedLoopStatus?: RalphLoopStatus;
  // True when the selected chat is the one that wrote the workspace's Ralph
  // plan; scopes the "Begin Ralph loop" banner to the creating chat.
  readonly selectedSessionCreatedRalphPlan?: boolean;
  readonly revision: number;
  readonly lastError?: string;
}

export interface CreateSessionInput {
  readonly workspaceId: string;
  readonly title?: string;
}

export interface WorkspaceSessionTarget {
  readonly workspaceId: string;
  readonly sessionId: string;
}

export function createEmptyDesktopAppState(): DesktopAppState {
  return {
    workspaces: [],
    worktreesByWorkspace: {},
    selectedWorkspaceId: "",
    selectedSessionId: "",
    activeView: "threads",
    composerDraft: "",
    composerDraftSyncSource: "state",
    composerDraftSyncNonce: 0,
    composerAttachments: [],
    queuedComposerMessages: [],
    runtimeByWorkspace: {},
    sessionCommandsBySession: {},
    sessionExtensionUiBySession: {},
    extensionCommandCompatibilityByWorkspace: {},
    notificationPreferences: {
      backgroundCompletion: true,
      backgroundFailure: true,
      attentionNeeded: true,
    },
    subagentSettings: {
      orchestratorMode: false,
      disableCoordinatorOnlyTurn: false,
      disableChildContextBoundary: false,
      disableSessionTitles: false,
      mux: "auto",
      piCommandOverride: "",
    },
    subagentAgentsByWorkspace: {},
    integratedTerminalShell: "",
    externalTerminalApp: "",
    lastViewedAtBySession: {},
    workspaceOrder: [],
    modelSettingsScopeMode: "app-global",
    globalModelSettings: {
      enabledModelPatterns: [],
    },
    sidebarCollapsed: false,
    enableTransparency: false,
    transcriptVerbose: false,
    autoAcceptVisionProxy: false,
    composerDeviceMode: "off",
    themeMode: "system",
    commitPushModel: undefined,
    chats: [],
    selectedChatId: "",
    revision: 0,
  };
}

export function getSelectedWorkspace(state: DesktopAppState): WorkspaceRecord | undefined {
  return state.workspaces.find((workspace) => workspace.id === state.selectedWorkspaceId);
}

export function getSelectedSession(state: DesktopAppState): SessionRecord | undefined {
  return getSelectedWorkspace(state)?.sessions.find((session) => session.id === state.selectedSessionId);
}

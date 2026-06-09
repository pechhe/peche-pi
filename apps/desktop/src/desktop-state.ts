import type { HostUiRequest, SessionConfig } from "@pi-gui/session-driver";
import type { GhMilestoneRecord, GhRunnerState } from "./gh-types";
import type { ModelSettingsSnapshot, RuntimeCommandRecord, RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import type { ButtonSoundSettings } from "./button-click-sound";
export type SessionStatus = "idle" | "running" | "failed";

// ── Automation types ─────────────────────────────────────

export type AutomationFrequency = "hourly" | "daily" | "weekly";

/** Simplified recurring schedule: a frequency plus a time-of-day. */
export interface AutomationSchedule {
  readonly frequency: AutomationFrequency;
  /** "HH:MM" 24h. For hourly only the minute is used. */
  readonly time: string;
  /** 0 (Sun) – 6 (Sat). Only used for weekly. */
  readonly dayOfWeek?: number;
}

export interface Automation {
  readonly id: string;
  readonly name: string;
  readonly prompt: string;
  readonly schedule: AutomationSchedule;
  readonly workspaceId: string;
  readonly environment: ThreadLocation;
  readonly model?: { readonly provider: string; readonly modelId: string };
  readonly thinkingLevel?: string;
  readonly enabled: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lastRunAt?: string;
}

export interface AutomationRun {
  readonly id: string;
  readonly automationId: string;
  readonly sessionId: string;
  readonly status: "running" | "completed" | "failed";
  readonly startedAt: string;
  readonly completedAt?: string;
}

const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function parseScheduleTime(time: string): { hour: number; minute: number } {
  const [h, m] = (time ?? "").split(":");
  const hour = Number.parseInt(h ?? "0", 10);
  const minute = Number.parseInt(m ?? "0", 10);
  return {
    hour: Number.isFinite(hour) ? Math.max(0, Math.min(23, hour)) : 0,
    minute: Number.isFinite(minute) ? Math.max(0, Math.min(59, minute)) : 0,
  };
}

/** Convert a simplified schedule into a 5-field cron expression. */
export function scheduleToCron(schedule: AutomationSchedule): string {
  const { hour, minute } = parseScheduleTime(schedule.time);
  switch (schedule.frequency) {
    case "hourly":
      return `${minute} * * * *`;
    case "daily":
      return `${minute} ${hour} * * *`;
    case "weekly":
      return `${minute} ${hour} * * ${schedule.dayOfWeek ?? 1}`;
  }
}

function formatScheduleTime(time: string): string {
  const { hour, minute } = parseScheduleTime(time);
  return `${hour}:${minute.toString().padStart(2, "0")}`;
}

export function automationScheduleLabel(schedule: AutomationSchedule): string {
  switch (schedule.frequency) {
    case "hourly":
      return "Hourly";
    case "daily":
      return `Daily at ${formatScheduleTime(schedule.time)}`;
    case "weekly": {
      const day = DAY_LABELS[schedule.dayOfWeek ?? 1] ?? "Monday";
      return `${day}s at ${formatScheduleTime(schedule.time)}`;
    }
  }
}

/** Returns the next scheduled run Date for a given automation schedule. */
function nextAutomationRun(schedule: AutomationSchedule): Date {
  return nextCronRun(scheduleToCron(schedule), new Date());
}

/** Naive next-run for common cron patterns. Handles minute, hour, day-of-week fields. */
function nextCronRun(expr: string, from: Date): Date {
  const parts = expr.split(" ");
  if (parts.length < 5) return new Date(from.getTime() + 3600_000); // fallback: 1h
  const minField = parts[0]!;
  const hourField = parts[1]!;
  const dowField = parts[4]!;
  const minute = minField === "*" ? -1 : parseInt(minField, 10);
  const hour = hourField === "*" ? -1 : parseInt(hourField, 10);
  const dows = dowField === "*" ? null : dowField.split(",").map((d) => {
    if (d.includes("-")) {
      const [a, b] = d.split("-").map(Number);
      return { a: a!, b: b! };
    }
    const v = parseInt(d, 10);
    return { a: v, b: v };
  });

  // Try up to 8 days ahead
  for (let dayOffset = 0; dayOffset < 8; dayOffset++) {
    const candidate = new Date(from);
    candidate.setDate(candidate.getDate() + dayOffset);
    candidate.setSeconds(0, 0);

    // Check day-of-week
    if (dows) {
      const dow = candidate.getDay();
      const matches = dows.some((r) => dow >= r.a && dow <= r.b);
      if (!matches) continue;
    }

    if (hour === -1 && minute === -1) {
      // Every minute — next run is next minute
      if (dayOffset === 0) {
        candidate.setMinutes(candidate.getMinutes() + 1);
      } else {
        candidate.setHours(0, 0);
      }
      return candidate;
    }

    if (hour === -1) {
      // Every hour at specific minute
      if (dayOffset === 0) {
        candidate.setHours(from.getHours(), minute);
        if (candidate <= from) candidate.setHours(candidate.getHours() + 1);
      } else {
        candidate.setHours(0, minute);
      }
      return candidate;
    }

    // Specific hour + minute
    candidate.setHours(hour, minute);
    if (dayOffset === 0 && candidate <= from) continue;
    return candidate;
  }
  // Fallback
  return new Date(from.getTime() + 86400_000);
}

/** Count how many enabled automations will fire within the next 24 hours. */
export function countAutomationsNext24h(automations: readonly Automation[]): number {
  const now = new Date();
  const horizon = new Date(now.getTime() + 24 * 3600_000);
  let count = 0;
  for (const a of automations) {
    if (!a.enabled) continue;
    const next = nextAutomationRun(a.schedule);
    if (next <= horizon) count++;
  }
  return count;
}

export type { TranscriptMessage } from "./timeline-types";
import type { TranscriptMessage } from "./timeline-types";


export type AppView = "threads" | "new-thread" | "skills" | "extensions" | "settings" | "context" | "queue" | "kanban" | "automations" | "agents" | "graph" | "testing";
export type WorkspaceKind = "primary" | "worktree";
export type WorktreeStatus = "ready" | "missing" | "error";
/**
 * Location: the checkout a thread runs against — the user's main checkout
 * (`local`) or an isolated git worktree (`worktree`). The laptop-row axis of
 * the Environment widget. See CONTEXT.md ("Location") and ADR 0003.
 */
export type ThreadLocation = "local" | "worktree";
export type ThemeMode = "system" | "light" | "dark" | "dracula";

export type ComposerDeviceMode = "modular-cream" | "modular-metal";

/** How freshly-streamed words animate in. Curated presets over the per-word reveal CSS vars. */
export type StreamRevealMode = "plain" | "blur" | "blur-rise" | "warm" | "glow";

/** Maps a reveal preset to the space-separated `data-stream-fx` tokens the .sw CSS reads. */
export const STREAM_REVEAL_FX_TOKENS: Record<StreamRevealMode, string> = {
  plain: "plain",
  blur: "blur",
  "blur-rise": "rise",
  warm: "warm",
  glow: "glow",
};

/** How fast streamed words are revealed by the typewriter. Orthogonal to the look preset. */
export type StreamRevealSpeed = "low" | "medium" | "high";

/** How the composer travels from the centered new-thread position into the docked footer when the first message is sent. */
export type ThreadTransitionMotion = "off" | "curve" | "dock" | "spring";

export interface ThreadTransitionSettings {
  /** Composer travel motion. */
  readonly motion: ThreadTransitionMotion;
  /** Animate the hero (logo + title) lifting and fading out as the composer leaves. */
  readonly heroExit: boolean;
  /** Delay the first user bubble so it rises out of the composer as it docks. */
  readonly bubbleHandoff: boolean;
}
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
  readonly tools?: readonly string[];
  readonly enabled?: boolean;
  readonly mode?: "interactive" | "background";
  readonly async?: boolean;
  readonly autoExit?: boolean;
  readonly sessionMode?: "standalone" | "lineage-only" | "fork";
  readonly allowModelOverride?: boolean;
  readonly systemPromptMode?: "replace" | "append" | "prepend";
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



export interface SessionRecord {
  readonly id: string;
  readonly title: string;
  readonly updatedAt: string;
  readonly lastViewedAt?: string;
  readonly archivedAt?: string;
  readonly snoozedUntil?: string;
  readonly toTestAt?: string;
  readonly toTestNote?: string;
  readonly preview: string;
  readonly status: SessionStatus;
  readonly runningSince?: string;
  readonly hasUnseenUpdate: boolean;
  readonly isAwaitingAssistantText: boolean;
  readonly config?: SessionConfig;
  readonly contextUsage?: SessionContextUsage;
  readonly automationId?: string;
  readonly threadType?: string;
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

}

export interface CreateWorktreeInput {
  readonly workspaceId: string;
  readonly fromSessionWorkspaceId?: string;
  readonly fromSessionId?: string;
}

export type StartThreadInput = {
  readonly rootWorkspaceId: string;
  readonly environment: ThreadLocation;
  readonly prompt?: string;
  readonly attachments?: readonly ComposerAttachment[];
  readonly provider?: string;
  readonly modelId?: string;
  readonly thinkingLevel?: string;
  readonly startBranch?: string;
  readonly existingWorktreeId?: string;
};

export type StartAutomationThreadInput = {
  readonly rootWorkspaceId: string;
  readonly environment: ThreadLocation;
  readonly prompt: string;
  readonly name?: string;
  readonly provider?: string;
  readonly modelId?: string;
  readonly thinkingLevel?: string;
  /** If true, navigate to the new session after creation (for manual fire). */
  readonly select?: boolean;
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

export type PlanModeIdeologySetting = "default" | "grill";

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
  readonly retrySettings: { readonly enabled: boolean; readonly maxRetries: number; readonly baseDelayMs: number };
  readonly lastViewedAtBySession: Readonly<Record<string, string>>;
  readonly workspaceOrder: readonly string[];
  readonly modelSettingsScopeMode: ModelSettingsScopeMode;
  readonly globalModelSettings: ModelSettingsSnapshot;
  readonly sidebarCollapsed: boolean;
  /** Chromium zoom factor applied to the window. 0.9 == the labelled "100%". */
  readonly zoomFactor: number;
  readonly queueMode: boolean;
  readonly transcriptVerbose: boolean;
  readonly autoAcceptVisionProxy: boolean;
  readonly composerDeviceMode: ComposerDeviceMode;
  readonly streamReveal: StreamRevealMode;
  readonly streamRevealSpeed: StreamRevealSpeed;
  readonly planModeIdeology: PlanModeIdeologySetting;
  readonly threadTransition: ThreadTransitionSettings;
  readonly themeMode: ThemeMode;
  readonly buttonSoundSettings: ButtonSoundSettings;
  readonly commitPushModel?: string;
  readonly chats: readonly ChatRecord[];
  readonly selectedChatId: string;
  readonly automations: readonly Automation[];
  readonly automationFilterWorkspaceId?: string;
  readonly threadTypeBySession: Readonly<Record<string, string>>;
  readonly ghMilestones?: readonly GhMilestoneRecord[];
  readonly ghRunnerState?: GhRunnerState;
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
  /** When set, the backend selects this session after archiving instead of the default heuristic. */
  readonly selectNextSessionId?: string;
}

export type ContextSectionKind =
  | "system-prompt"
  | "context-file"
  | "skill"
  | "extension"
  | "command"
  | "model-settings"
  | "user-message";

export interface ContextSection {
  readonly kind: ContextSectionKind;
  readonly label: string;
  readonly origin: string;
  readonly scope?: string;
  readonly enabled?: boolean;
  readonly path?: string;
  readonly content?: string;
  readonly detail?: string;
  readonly tokenCount?: number;
}

export interface ContextSnapshot {
  readonly workspaceId: string;
  readonly sessionId?: string;
  readonly sections: readonly ContextSection[];
}

/**
 * Zoom factor we present to the user as "100%". The raw Chromium default (1.0)
 * renders too tight, so the comfortable baseline is 0.9.
 */
export const ZOOM_BASELINE = 0.9;

/** Discrete zoom ladder (raw Chromium factors). Keeps layout predictable. */
export const ZOOM_FACTOR_LADDER: readonly number[] = [0.72, 0.81, 0.9, 0.99, 1.125, 1.35, 1.575, 1.8];

/** Map a raw zoom factor to the user-facing percent, rebased so 0.9 == 100%. */
export function zoomFactorToPercent(factor: number): number {
  return Math.round((factor / ZOOM_BASELINE) * 100);
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
    retrySettings: { enabled: true, maxRetries: 3, baseDelayMs: 2000 },
    lastViewedAtBySession: {},
    workspaceOrder: [],
    modelSettingsScopeMode: "app-global",
    globalModelSettings: {
      enabledModelPatterns: [],
    },
    sidebarCollapsed: false,
    zoomFactor: ZOOM_BASELINE,
    queueMode: false,
    transcriptVerbose: false,
    autoAcceptVisionProxy: false,
    composerDeviceMode: "modular-cream",
    streamReveal: "blur",
    streamRevealSpeed: "medium",
    planModeIdeology: "default",
    threadTransition: { motion: "curve", heroExit: false, bubbleHandoff: false },
    themeMode: "system",
    buttonSoundSettings: { primary: "click", navigation: "none", toggle: "key", secondary: "none", destructive: "click" },
    commitPushModel: undefined,
    chats: [],
    selectedChatId: "",
    automations: [],
    automationFilterWorkspaceId: undefined,
    threadTypeBySession: {},
    revision: 0,
  };
}

export function getSelectedWorkspace(state: DesktopAppState): WorkspaceRecord | undefined {
  return state.workspaces.find((workspace) => workspace.id === state.selectedWorkspaceId);
}

export function getSelectedSession(state: DesktopAppState): SessionRecord | undefined {
  return getSelectedWorkspace(state)?.sessions.find((session) => session.id === state.selectedSessionId);
}

import type {
  AppView,
  ChatRecord,
  ExtensionCommandCompatibilityRecord,
  ModelSettingsScopeMode,
  NotificationPreferences,
  SubagentSettingsRecord,
  ThemeMode,
  ThreadTransitionSettings,
} from "../src/desktop-state";
import type { ModelSettingsSnapshot } from "@pi-gui/session-driver/runtime-types";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const uiStateWriteQueueByPath = new Map<string, Promise<void>>();
export interface PersistedUiState {
  readonly version?: 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
  readonly selectedWorkspaceId?: string;
  readonly selectedSessionId?: string;
  readonly activeView?: AppView;
  readonly composerDraft?: string;
  readonly composerDraftsBySession?: Record<string, string>;
  readonly extensionCommandCompatibilityByWorkspace?: Record<string, readonly ExtensionCommandCompatibilityRecord[]>;
  readonly notificationPreferences?: NotificationPreferences;
  readonly subagentSettings?: Partial<SubagentSettingsRecord>;
  readonly integratedTerminalShell?: string;
  readonly externalTerminalApp?: string;
  readonly retrySettings?: { readonly enabled: boolean; readonly maxRetries: number; readonly baseDelayMs: number };
  readonly lastViewedAtBySession?: Record<string, string>;
  readonly workspaceOrder?: readonly string[];
  readonly modelSettingsScopeMode?: ModelSettingsScopeMode;
  readonly appGlobalModelSettings?: ModelSettingsSnapshot;
  readonly sidebarCollapsed?: boolean;
  readonly zoomFactor?: number;
  readonly allowMultiple?: boolean;
  readonly transcriptVerbose?: boolean;
  readonly composerDeviceMode?: "modular-cream" | "modular-metal";
  readonly streamReveal?: "plain" | "blur" | "blur-rise" | "warm" | "glow";
  readonly streamRevealSpeed?: "low" | "medium" | "high";
  readonly threadTransition?: ThreadTransitionSettings;
  readonly themeMode?: ThemeMode;
  readonly commitPushModel?: string;
  readonly autoShip?: boolean;
  readonly commitPushMode?: string;
  readonly modelSelectorPinnedKeys?: readonly string[];
  readonly modelSelectorHiddenKeys?: readonly string[];
  readonly chats?: readonly ChatRecord[];
  readonly selectedChatId?: string;
  readonly threadTypeBySession?: Record<string, string>;
}

export interface LegacyPersistedUiState extends PersistedUiState {
  readonly composerAttachmentsBySession?: Record<string, readonly unknown[]>;
  readonly transcripts?: Record<string, readonly unknown[]>;
}

const VALID_VERSIONS: ReadonlySet<number> = new Set([2, 3, 4, 5, 6, 7, 8, 9, 10]);

function normalizeComposerDeviceMode(
  raw: unknown,
): "modular-cream" | "modular-metal" | undefined {
  if (raw === "modular-cream" || raw === "modular-metal") {
    return raw;
  }
  return undefined;
}

function normalizeStreamReveal(
  raw: unknown,
): "plain" | "blur" | "blur-rise" | "warm" | "glow" | undefined {
  return raw === "plain" || raw === "blur" || raw === "blur-rise" || raw === "warm" || raw === "glow"
    ? raw
    : undefined;
}

function normalizeStreamRevealSpeed(raw: unknown): "low" | "medium" | "high" | undefined {
  return raw === "low" || raw === "medium" || raw === "high" ? raw : undefined;
}

function normalizeThemeMode(raw: unknown): ThemeMode | undefined {
  return raw === "dracula" || raw === "dark" || raw === "light" || raw === "system" ? raw : undefined;
}

function normalizeModelSettingsScopeMode(raw: unknown): ModelSettingsScopeMode | undefined {
  return raw === "per-repo" || raw === "app-global" ? raw : undefined;
}

function normalizeCommitPushMode(raw: unknown): string | undefined {
  return raw === "manual" || raw === "semi-auto" || raw === "auto-ship" ? raw : undefined;
}

export async function readPersistedUiState(uiStateFilePath: string): Promise<LegacyPersistedUiState> {
  try {
    const raw = await readFile(uiStateFilePath, "utf8");
    const parsed = JSON.parse(raw) as LegacyPersistedUiState;
    return {
      version: VALID_VERSIONS.has(parsed.version as number) ? parsed.version : undefined,
      selectedWorkspaceId: parsed.selectedWorkspaceId,
      selectedSessionId: parsed.selectedSessionId,
      activeView: parsed.activeView,
      composerDraft: parsed.composerDraft ?? "",
      composerDraftsBySession: parsed.composerDraftsBySession,
      extensionCommandCompatibilityByWorkspace: parsed.extensionCommandCompatibilityByWorkspace,
      notificationPreferences: parsed.notificationPreferences,
      subagentSettings: normalizeSubagentSettings(parsed.subagentSettings),
      integratedTerminalShell:
        typeof parsed.integratedTerminalShell === "string" ? parsed.integratedTerminalShell : undefined,
      externalTerminalApp:
        typeof parsed.externalTerminalApp === "string" ? parsed.externalTerminalApp : undefined,
      lastViewedAtBySession: parsed.lastViewedAtBySession,
      workspaceOrder: Array.isArray(parsed.workspaceOrder) ? parsed.workspaceOrder : undefined,
      modelSettingsScopeMode: normalizeModelSettingsScopeMode(parsed.modelSettingsScopeMode),
      appGlobalModelSettings: toPersistedModelSettingsSnapshot(parsed.appGlobalModelSettings),
      sidebarCollapsed: typeof parsed.sidebarCollapsed === "boolean" ? parsed.sidebarCollapsed : undefined,
      zoomFactor:
        typeof parsed.zoomFactor === "number" && Number.isFinite(parsed.zoomFactor) ? parsed.zoomFactor : undefined,
      allowMultiple: typeof parsed.allowMultiple === "boolean" ? parsed.allowMultiple : undefined,
      transcriptVerbose: typeof parsed.transcriptVerbose === "boolean" ? parsed.transcriptVerbose : undefined,
      composerDeviceMode: normalizeComposerDeviceMode(parsed.composerDeviceMode),
      streamReveal: normalizeStreamReveal(parsed.streamReveal),
      streamRevealSpeed: normalizeStreamRevealSpeed(parsed.streamRevealSpeed),
      threadTransition: normalizeThreadTransition(parsed.threadTransition),
      themeMode: normalizeThemeMode(parsed.themeMode),
      commitPushModel: typeof parsed.commitPushModel === "string" ? parsed.commitPushModel : undefined,
      autoShip: typeof parsed.autoShip === "boolean" ? parsed.autoShip : undefined,
      commitPushMode: normalizeCommitPushMode(parsed.commitPushMode),
      chats: Array.isArray(parsed.chats) ? (parsed.chats as readonly ChatRecord[]) : undefined,
      selectedChatId: typeof parsed.selectedChatId === "string" ? parsed.selectedChatId : undefined,
      composerAttachmentsBySession: parsed.composerAttachmentsBySession,
      transcripts: parsed.transcripts,
      threadTypeBySession: parsed.threadTypeBySession,
    };
  } catch {
    return {};
  }
}

export async function writePersistedUiState(
  uiStateFilePath: string,
  payload: PersistedUiState,
): Promise<void> {
  await enqueueUiStateWrite(uiStateFilePath, async () => {
    await mkdir(dirname(uiStateFilePath), { recursive: true });
    const serialized = `${JSON.stringify(
      {
        version: 10,
        ...payload,
      } satisfies PersistedUiState,
      null,
      2,
    )}\n`;
    const tmpPath = `${uiStateFilePath}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(tmpPath, serialized, "utf8");

    try {
      await rename(tmpPath, uiStateFilePath);
    } catch (error) {
      if (!isReplaceRenameError(error)) {
        await cleanupTempFile(tmpPath);
        throw error;
      }

      try {
        await unlink(uiStateFilePath);
      } catch (unlinkError) {
        if (!isMissingFileError(unlinkError)) {
          await cleanupTempFile(tmpPath);
          throw unlinkError;
        }
      }

      try {
        await rename(tmpPath, uiStateFilePath);
      } catch (renameError) {
        await cleanupTempFile(tmpPath);
        throw renameError;
      }
    }
  });
}

function normalizeThreadTransition(value: unknown): ThreadTransitionSettings | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Record<string, unknown>;
  const motion =
    candidate.motion === "off" ||
    candidate.motion === "curve" ||
    candidate.motion === "dock" ||
    candidate.motion === "spring"
      ? candidate.motion
      : "curve";
  return {
    motion,
    heroExit: candidate.heroExit === true,
    bubbleHandoff: candidate.bubbleHandoff === true,
  };
}

function normalizeSubagentSettings(value: unknown): Partial<SubagentSettingsRecord> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Record<string, unknown>;
  return {
    ...(typeof candidate.orchestratorMode === "boolean" ? { orchestratorMode: candidate.orchestratorMode } : {}),
    ...(typeof candidate.disableCoordinatorOnlyTurn === "boolean" ? { disableCoordinatorOnlyTurn: candidate.disableCoordinatorOnlyTurn } : {}),
    ...(typeof candidate.disableChildContextBoundary === "boolean" ? { disableChildContextBoundary: candidate.disableChildContextBoundary } : {}),
    ...(typeof candidate.disableSessionTitles === "boolean" ? { disableSessionTitles: candidate.disableSessionTitles } : {}),
    ...(candidate.mux === "cmux" || candidate.mux === "tmux" || candidate.mux === "zellij" || candidate.mux === "wezterm" || candidate.mux === "auto" ? { mux: candidate.mux } : {}),
    ...(typeof candidate.piCommandOverride === "string" ? { piCommandOverride: candidate.piCommandOverride } : {}),
  };
}

function toPersistedModelSettingsSnapshot(value: unknown): ModelSettingsSnapshot | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const candidate = value as Record<string, unknown>;
  const enabledModelPatterns = Array.isArray(candidate.enabledModelPatterns)
    ? candidate.enabledModelPatterns.filter((entry): entry is string => typeof entry === "string")
    : [];
  return {
    ...(typeof candidate.defaultProvider === "string" ? { defaultProvider: candidate.defaultProvider } : {}),
    ...(typeof candidate.defaultModelId === "string" ? { defaultModelId: candidate.defaultModelId } : {}),
    ...(typeof candidate.defaultThinkingLevel === "string"
      ? { defaultThinkingLevel: candidate.defaultThinkingLevel as ModelSettingsSnapshot["defaultThinkingLevel"] }
      : {}),
    enabledModelPatterns,
  };
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function isReplaceRenameError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error.code === "EEXIST" || error.code === "EPERM");
}

async function cleanupTempFile(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error;
    }
  }
}

async function enqueueUiStateWrite(uiStateFilePath: string, write: () => Promise<void>): Promise<void> {
  const previous = uiStateWriteQueueByPath.get(uiStateFilePath) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(write);
  uiStateWriteQueueByPath.set(uiStateFilePath, next);

  try {
    await next;
  } finally {
    if (uiStateWriteQueueByPath.get(uiStateFilePath) === next) {
      uiStateWriteQueueByPath.delete(uiStateFilePath);
    }
  }
}

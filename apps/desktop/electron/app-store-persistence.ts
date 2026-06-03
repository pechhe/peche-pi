import type {
  AppView,
  ChatRecord,
  ExtensionCommandCompatibilityRecord,
  ModelSettingsScopeMode,
  NotificationPreferences,
  ThemeMode,
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
  readonly integratedTerminalShell?: string;
  readonly externalTerminalApp?: string;
  readonly lastViewedAtBySession?: Record<string, string>;
  readonly workspaceOrder?: readonly string[];
  readonly modelSettingsScopeMode?: ModelSettingsScopeMode;
  readonly appGlobalModelSettings?: ModelSettingsSnapshot;
  readonly sidebarCollapsed?: boolean;
  readonly allowMultiple?: boolean;
  readonly enableTransparency?: boolean;
  readonly transcriptVerbose?: boolean;
  readonly composerDeviceMode?: "off" | "screen" | "modular" | "screen-neon";
  readonly themeMode?: ThemeMode;
  readonly commitPushModel?: string;
  readonly chats?: readonly ChatRecord[];
  readonly selectedChatId?: string;
}

export interface LegacyPersistedUiState extends PersistedUiState {
  readonly composerAttachmentsBySession?: Record<string, readonly unknown[]>;
  readonly transcripts?: Record<string, readonly unknown[]>;
}

export async function readPersistedUiState(uiStateFilePath: string): Promise<LegacyPersistedUiState> {
  try {
    const raw = await readFile(uiStateFilePath, "utf8");
    const parsed = JSON.parse(raw) as LegacyPersistedUiState;
    return {
      version:
        parsed.version === 10
          ? 10
          : parsed.version === 9
            ? 9
            : parsed.version === 8
              ? 8
              : parsed.version === 7
                ? 7
                : parsed.version === 6
                  ? 6
                  : parsed.version === 5
                    ? 5
                    : parsed.version === 4
                      ? 4
                      : parsed.version === 3
                        ? 3
                        : parsed.version === 2
                          ? 2
                          : undefined,
      selectedWorkspaceId: parsed.selectedWorkspaceId,
      selectedSessionId: parsed.selectedSessionId,
      activeView: parsed.activeView,
      composerDraft: parsed.composerDraft ?? "",
      composerDraftsBySession: parsed.composerDraftsBySession,
      extensionCommandCompatibilityByWorkspace: parsed.extensionCommandCompatibilityByWorkspace,
      notificationPreferences: parsed.notificationPreferences,
      integratedTerminalShell:
        typeof parsed.integratedTerminalShell === "string" ? parsed.integratedTerminalShell : undefined,
      externalTerminalApp:
        typeof parsed.externalTerminalApp === "string" ? parsed.externalTerminalApp : undefined,
      lastViewedAtBySession: parsed.lastViewedAtBySession,
      workspaceOrder: Array.isArray(parsed.workspaceOrder) ? parsed.workspaceOrder : undefined,
      modelSettingsScopeMode:
        parsed.modelSettingsScopeMode === "per-repo" || parsed.modelSettingsScopeMode === "app-global"
          ? parsed.modelSettingsScopeMode
          : undefined,
      appGlobalModelSettings: toPersistedModelSettingsSnapshot(parsed.appGlobalModelSettings),
      sidebarCollapsed: typeof parsed.sidebarCollapsed === "boolean" ? parsed.sidebarCollapsed : undefined,
      allowMultiple: typeof parsed.allowMultiple === "boolean" ? parsed.allowMultiple : undefined,
      enableTransparency: typeof parsed.enableTransparency === "boolean" ? parsed.enableTransparency : undefined,
      transcriptVerbose: typeof parsed.transcriptVerbose === "boolean" ? parsed.transcriptVerbose : undefined,
      composerDeviceMode:
        parsed.composerDeviceMode === "screen" || parsed.composerDeviceMode === "modular" || parsed.composerDeviceMode === "screen-neon" || parsed.composerDeviceMode === "off"
          ? parsed.composerDeviceMode
          : // Migrate legacy boolean: true → screen, false/undefined → off
            (parsed as { composerDeviceMode?: unknown }).composerDeviceMode === true
            ? "screen"
            : undefined,
      themeMode:
        parsed.themeMode === "dracula" || parsed.themeMode === "dark" || parsed.themeMode === "light" || parsed.themeMode === "system"
          ? parsed.themeMode
          : undefined,
      commitPushModel: typeof parsed.commitPushModel === "string" ? parsed.commitPushModel : undefined,
      chats: Array.isArray(parsed.chats) ? (parsed.chats as readonly ChatRecord[]) : undefined,
      selectedChatId: typeof parsed.selectedChatId === "string" ? parsed.selectedChatId : undefined,
      composerAttachmentsBySession: parsed.composerAttachmentsBySession,
      transcripts: parsed.transcripts,
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

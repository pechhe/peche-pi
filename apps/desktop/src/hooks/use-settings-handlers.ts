import type { Dispatch, SetStateAction } from "react";
import type { RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import type { DesktopAppState, WorkspaceRecord } from "../desktop-state";
import type { CavemanLevel, PiDesktopApi, UndoEditsResult } from "../ipc";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SettingsHandlerDeps {
  readonly api: PiDesktopApi | undefined;
  readonly setSnapshot: Dispatch<SetStateAction<import("../desktop-state").DesktopAppState | null>>;
  readonly updateSnapshot: (
    api: NonNullable<typeof window.piApp>,
    setSnapshot: Dispatch<SetStateAction<DesktopAppState | null>>,
    action: () => Promise<DesktopAppState>,
  ) => Promise<DesktopAppState>;
  readonly settingsWorkspace: WorkspaceRecord | undefined;
  readonly selectedWorkspace: WorkspaceRecord | undefined;
  readonly selectedSession: import("../desktop-state").SessionRecord | undefined;
  readonly setThemeMode: Dispatch<SetStateAction<"system" | "light" | "dark" | "dracula">>;
}

export interface SettingsHandlers {
  readonly handleSetDefaultModel: (provider: string, modelId: string) => void;
  readonly handleSetThinkingLevel: (thinkingLevel: RuntimeSnapshot["settings"]["defaultThinkingLevel"]) => void;
  readonly handleToggleSkillCommands: (enabled: boolean) => void;
  readonly handleSetScopedModelPatterns: (patterns: readonly string[]) => void;
  readonly handleSetModelSettingsScopeMode: (mode: "app-global" | "per-repo") => void;
  readonly handleLoginProvider: (providerId: string) => void;
  readonly handleLogoutProvider: (providerId: string) => void;
  readonly handleSetProviderApiKey: (providerId: string, apiKey: string) => Promise<string | undefined>;
  readonly handleRemoveProviderApiKey: (providerId: string) => Promise<string | undefined>;
  readonly handleSetThemeMode: (mode: "system" | "light" | "dark" | "dracula") => void;
  readonly handleSetNotificationPreferences: (preferences: Partial<DesktopAppState["notificationPreferences"]>) => void;
  readonly handleSetIntegratedTerminalShell: (shellPath: string) => void;
  readonly handleSetSubagentSettings: (settings: Partial<DesktopAppState["subagentSettings"]>) => void;
  readonly handleRefreshSubagentAgents: (workspaceId: string) => void;
  readonly handleSaveSubagentAgent: (workspaceId: string, input: { readonly name: string; readonly raw: string; readonly scope?: "project" | "global" }) => void;
  readonly handleDeleteSubagentAgent: (workspaceId: string, name: string, scope?: "project" | "global") => void;
  readonly handleChooseExternalTerminalApp: () => void;
  readonly handleClearExternalTerminalApp: () => void;
  readonly handleSetDefaultCavemanLevel: (level: CavemanLevel) => void;
  readonly handleSetSessionCavemanLevel: (level: CavemanLevel) => void;
  readonly handleSetSessionModel: (provider: string, modelId: string) => void;
  readonly handleSetSessionThinking: (level: string) => void;
  readonly handleUndoEdits: (ops: readonly import("../ipc").UndoEditOp[]) => Promise<UndoEditsResult>;
  readonly handleRedoEdits: (ops: readonly import("../ipc").UndoEditOp[]) => Promise<UndoEditsResult>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useSettingsHandlers({
  api,
  setSnapshot,
  updateSnapshot,
  settingsWorkspace,
  selectedWorkspace,
  selectedSession,
  setThemeMode,
}: SettingsHandlerDeps): SettingsHandlers {
  const handleSetDefaultModel = (provider: string, modelId: string) => {
    if (!api || !settingsWorkspace) return;
    void updateSnapshot(api, setSnapshot, () => api.setDefaultModel(settingsWorkspace.id, provider, modelId));
  };

  const handleSetThinkingLevel = (thinkingLevel: RuntimeSnapshot["settings"]["defaultThinkingLevel"]) => {
    if (!api || !settingsWorkspace) return;
    void updateSnapshot(api, setSnapshot, () => api.setDefaultThinkingLevel(settingsWorkspace.id, thinkingLevel));
  };

  const handleToggleSkillCommands = (enabled: boolean) => {
    if (!api || !settingsWorkspace) return;
    void updateSnapshot(api, setSnapshot, () => api.setEnableSkillCommands(settingsWorkspace.id, enabled));
  };

  const handleSetScopedModelPatterns = (patterns: readonly string[]) => {
    if (!api || !settingsWorkspace) return;
    void updateSnapshot(api, setSnapshot, () => api.setScopedModelPatterns(settingsWorkspace.id, patterns));
  };

  const handleSetModelSettingsScopeMode = (mode: "app-global" | "per-repo") => {
    if (!api) return;
    void updateSnapshot(api, setSnapshot, () => api.setModelSettingsScopeMode(mode));
  };

  const handleLoginProvider = (providerId: string) => {
    if (!api || !settingsWorkspace) return;
    void updateSnapshot(api, setSnapshot, () => api.loginProvider(settingsWorkspace.id, providerId));
  };

  const handleLogoutProvider = (providerId: string) => {
    if (!api || !settingsWorkspace) return;
    void updateSnapshot(api, setSnapshot, () => api.logoutProvider(settingsWorkspace.id, providerId));
  };

  const handleSetProviderApiKey = async (providerId: string, apiKey: string): Promise<string | undefined> => {
    if (!api || !settingsWorkspace) return "Select a workspace first.";
    const state = await updateSnapshot(api, setSnapshot, () =>
      api.setProviderApiKey(settingsWorkspace.id, providerId, apiKey),
    );
    return state.lastError;
  };

  const handleRemoveProviderApiKey = async (providerId: string): Promise<string | undefined> => {
    if (!api || !settingsWorkspace) return "Select a workspace first.";
    const state = await updateSnapshot(api, setSnapshot, () =>
      api.logoutProvider(settingsWorkspace.id, providerId),
    );
    return state.lastError;
  };

  const handleSetThemeMode = (mode: "system" | "light" | "dark" | "dracula") => {
    if (!api) return;
    setThemeMode(mode);
    document.documentElement.classList.toggle("dracula", mode === "dracula");
    void api.setThemeMode(mode);
  };

  const handleSetNotificationPreferences = (preferences: Partial<DesktopAppState["notificationPreferences"]>) => {
    if (!api) return;
    void updateSnapshot(api, setSnapshot, () => api.setNotificationPreferences(preferences));
  };

  const handleSetIntegratedTerminalShell = (shellPath: string) => {
    if (!api) return;
    void updateSnapshot(api, setSnapshot, () => api.setIntegratedTerminalShell(shellPath));
  };

  const handleSetSubagentSettings = (settings: Partial<DesktopAppState["subagentSettings"]>) => {
    if (!api) return;
    void updateSnapshot(api, setSnapshot, () => api.setSubagentSettings(settings));
  };

  const handleRefreshSubagentAgents = (workspaceId: string) => {
    if (!api) return;
    void updateSnapshot(api, setSnapshot, () => api.refreshSubagentAgents(workspaceId));
  };

  const handleSaveSubagentAgent = (workspaceId: string, input: { readonly name: string; readonly raw: string; readonly scope?: "project" | "global" }) => {
    if (!api) return;
    void updateSnapshot(api, setSnapshot, () => api.saveSubagentAgent(workspaceId, input));
  };

  const handleDeleteSubagentAgent = (workspaceId: string, name: string, scope?: "project" | "global") => {
    if (!api) return;
    void updateSnapshot(api, setSnapshot, () => api.deleteSubagentAgent(workspaceId, name, scope));
  };

  const handleChooseExternalTerminalApp = () => {
    if (!api) return;
    void updateSnapshot(api, setSnapshot, () => api.chooseExternalTerminalApp());
  };

  const handleClearExternalTerminalApp = () => {
    if (!api) return;
    void updateSnapshot(api, setSnapshot, () => api.clearExternalTerminalApp());
  };

  const handleSetDefaultCavemanLevel = (level: CavemanLevel) => {
    if (!api) return;
    void api.setCavemanDefaultLevel(level);
  };

  const handleSetSessionCavemanLevel = (level: CavemanLevel) => {
    if (!api) return;
    void api.setCavemanDefaultLevel(level);
  };

  const handleSetSessionModel = (provider: string, modelId: string) => {
    if (!api || !selectedWorkspace || !selectedSession) return;
    void updateSnapshot(api, setSnapshot, () =>
      api.setSessionModel(selectedWorkspace.id, selectedSession.id, provider, modelId),
    );
  };

  const handleSetSessionThinking = (level: string) => {
    if (!api || !selectedWorkspace || !selectedSession) return;
    void updateSnapshot(api, setSnapshot, () =>
      api.setSessionThinkingLevel(
        selectedWorkspace.id,
        selectedSession.id,
        level as NonNullable<RuntimeSnapshot["settings"]["defaultThinkingLevel"]>,
      ),
    );
  };

  const handleUndoEdits = async (ops: readonly import("../ipc").UndoEditOp[]): Promise<UndoEditsResult> => {
    const workspaceId = selectedWorkspace?.id;
    if (!api || !workspaceId) return { reverted: [], failed: [] };
    return api.undoEdits(workspaceId, ops);
  };

  const handleRedoEdits = async (ops: readonly import("../ipc").UndoEditOp[]): Promise<UndoEditsResult> => {
    const workspaceId = selectedWorkspace?.id;
    if (!api || !workspaceId) return { reverted: [], failed: [] };
    return api.redoEdits(workspaceId, ops);
  };

  return {
    handleSetDefaultModel,
    handleSetThinkingLevel,
    handleToggleSkillCommands,
    handleSetScopedModelPatterns,
    handleSetModelSettingsScopeMode,
    handleLoginProvider,
    handleLogoutProvider,
    handleSetProviderApiKey,
    handleRemoveProviderApiKey,
    handleSetThemeMode,
    handleSetNotificationPreferences,
    handleSetIntegratedTerminalShell,
    handleSetSubagentSettings,
    handleRefreshSubagentAgents,
    handleSaveSubagentAgent,
    handleDeleteSubagentAgent,
    handleChooseExternalTerminalApp,
    handleClearExternalTerminalApp,
    handleSetDefaultCavemanLevel,
    handleSetSessionCavemanLevel,
    handleSetSessionModel,
    handleSetSessionThinking,
    handleUndoEdits,
    handleRedoEdits,
  };
}

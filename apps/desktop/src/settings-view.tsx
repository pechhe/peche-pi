import type { RuntimeSettingsSnapshot, RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import type { ModelSettingsScopeMode, NotificationPreferences, ThreadTransitionSettings, WorkspaceRecord } from "./desktop-state";
import type { ButtonSoundSettings } from "./button-click-sound";
import type { CavemanLevel, DesktopNotificationPermissionStatus } from "./ipc";
import { SettingsAppearanceSection } from "./settings-appearance-section";
import { SettingsGeneralSection } from "./settings-general-section";
import { SettingsModelsSection } from "./settings-models-section";
import { SettingsNotificationsSection } from "./settings-notifications-section";
import { SettingsProvidersSection } from "./settings-providers-section";
import { SettingsSoundsSection } from "./settings-sounds-section";
import { type SettingsSection, sectionTitle } from "./settings-utils";

export type { SettingsSection } from "./settings-utils";

interface SettingsViewProps {
  readonly workspace?: WorkspaceRecord;
  readonly runtime?: RuntimeSnapshot;
  readonly section: SettingsSection;
  readonly onSelectSection: (section: SettingsSection) => void;
  readonly onBack: () => void;
  readonly notificationPreferences: NotificationPreferences;
  readonly notificationPermissionStatus: DesktopNotificationPermissionStatus;
  readonly notificationPermissionPending: boolean;
  readonly modelSettingsScopeMode: ModelSettingsScopeMode;
  readonly integratedTerminalShell: string;
  readonly externalTerminalApp: string;
  readonly themeMode: import("./desktop-state").ThemeMode;
  readonly enableTransparency: boolean;
  readonly composerDeviceMode: import("./desktop-state").ComposerDeviceMode;
  readonly threadTransition: ThreadTransitionSettings;
  readonly buttonSoundSettings: ButtonSoundSettings;
  readonly onSetModelSettingsScopeMode: (mode: ModelSettingsScopeMode) => void;
  readonly onSetDefaultModel: (provider: string, modelId: string) => void;
  readonly onSetThinkingLevel: (thinkingLevel: RuntimeSettingsSnapshot["defaultThinkingLevel"]) => void;
  readonly onToggleSkillCommands: (enabled: boolean) => void;
  readonly onSetScopedModelPatterns: (patterns: readonly string[]) => void;
  readonly onLoginProvider: (providerId: string) => void;
  readonly onLogoutProvider: (providerId: string) => void;
  readonly onSetProviderApiKey: (providerId: string, apiKey: string) => Promise<string | undefined>;
  readonly onRemoveProviderApiKey: (providerId: string) => Promise<string | undefined>;
  readonly onSetNotificationPreferences: (preferences: Partial<NotificationPreferences>) => void;
  readonly onSetIntegratedTerminalShell: (shellPath: string) => void;
  readonly onChooseExternalTerminalApp: () => void;
  readonly onClearExternalTerminalApp: () => void;
  readonly onRequestNotificationPermission: () => void;
  readonly onOpenSystemNotificationSettings: () => void;
  readonly onSetThemeMode: (mode: import("./desktop-state").ThemeMode) => void;
  readonly onSetEnableTransparency: (enabled: boolean) => void;
  readonly onSetComposerDeviceMode: (mode: import("./desktop-state").ComposerDeviceMode) => void;
  readonly onSetThreadTransition: (settings: Partial<ThreadTransitionSettings>) => void;
  readonly onSetButtonSoundSettings: (settings: ButtonSoundSettings) => void;
  readonly retrySettings: { readonly enabled: boolean; readonly maxRetries: number; readonly baseDelayMs: number };
  readonly onSetRetrySettings: (settings: { readonly enabled: boolean; readonly maxRetries: number; readonly baseDelayMs: number }) => void;
  readonly planModeIdeology: import("./desktop-state").PlanModeIdeologySetting;
  readonly onSetPlanModeIdeology: (ideology: import("./desktop-state").PlanModeIdeologySetting) => void;
  readonly commitPushModel?: string;
  readonly onSetCommitPushModel: (model: string) => void;
  readonly smartCompactSettings: import("./ipc").SmartCompactSettings;
  readonly onSetSmartCompactSettings: (settings: Partial<import("./ipc").SmartCompactSettings>) => void;
  readonly cavemanOnLevel: CavemanLevel;
  readonly onSetCavemanOnLevel: (level: CavemanLevel) => void;
}

export function SettingsView({
  workspace,
  runtime,
  section,
  onSelectSection,
  onBack: _onBack,
  notificationPreferences,
  notificationPermissionStatus,
  notificationPermissionPending,
  modelSettingsScopeMode,
  integratedTerminalShell,
  externalTerminalApp,
  themeMode,
  enableTransparency,
  composerDeviceMode,
  threadTransition,
  buttonSoundSettings,
  onSetModelSettingsScopeMode,
  onSetDefaultModel,
  onSetThinkingLevel,
  onToggleSkillCommands,
  onSetScopedModelPatterns,
  onLoginProvider,
  onLogoutProvider,
  onSetProviderApiKey,
  onRemoveProviderApiKey,
  onSetNotificationPreferences,
  onSetIntegratedTerminalShell,
  onChooseExternalTerminalApp,
  onClearExternalTerminalApp,
  onRequestNotificationPermission,
  onOpenSystemNotificationSettings,
  onSetThemeMode,
  onSetEnableTransparency,
  onSetComposerDeviceMode,
  onSetThreadTransition,
  onSetButtonSoundSettings,
  retrySettings,
  onSetRetrySettings,
  planModeIdeology,
  onSetPlanModeIdeology,
  commitPushModel,
  onSetCommitPushModel,
  smartCompactSettings,
  onSetSmartCompactSettings,
  cavemanOnLevel,
  onSetCavemanOnLevel,
}: SettingsViewProps) {
  if (!workspace && section !== "general" && section !== "notifications" && section !== "appearance" && section !== "sounds") {
    return (
      <div className="empty-panel">
        <div className="session-header__eyebrow">Settings</div>
        <h1>Select a workspace</h1>
        <p>Provider and skill settings need a selected workspace.</p>
      </div>
    );
  }

  return (
    <div className="settings-view">
      <nav className="settings-sidebar">
        {(["appearance", "general", "providers", "models", "notifications", "sounds"] as const).map((item) => (
          <button
            key={item}
            className={`settings-sidebar__item${section === item ? " settings-sidebar__item--active" : ""}`}
            type="button"
            onClick={() => onSelectSection(item)}
          >
            {sectionTitle(item)}
          </button>
        ))}
      </nav>

      <div className="settings-content">
        <h1 className="view-header__title">{sectionTitle(section)}</h1>
        <div className="settings-grid">
          {section === "appearance" ? (
            <SettingsAppearanceSection
              themeMode={themeMode}
              onSetThemeMode={onSetThemeMode}
              enableTransparency={enableTransparency}
              onSetEnableTransparency={onSetEnableTransparency}
              composerDeviceMode={composerDeviceMode}
              onSetComposerDeviceMode={onSetComposerDeviceMode}
              threadTransition={threadTransition}
              onSetThreadTransition={onSetThreadTransition}
            />
          ) : null}

          {section === "general" ? (
            <SettingsGeneralSection
              runtime={runtime}
              modelSettingsScopeMode={modelSettingsScopeMode}
              integratedTerminalShell={integratedTerminalShell}
              externalTerminalApp={externalTerminalApp}
              retrySettings={retrySettings}
              commitPushModel={commitPushModel}
              onSetCommitPushModel={onSetCommitPushModel}
              onSetModelSettingsScopeMode={onSetModelSettingsScopeMode}
              onSetIntegratedTerminalShell={onSetIntegratedTerminalShell}
              onChooseExternalTerminalApp={onChooseExternalTerminalApp}
              onClearExternalTerminalApp={onClearExternalTerminalApp}
              onToggleSkillCommands={onToggleSkillCommands}
              onSetRetrySettings={onSetRetrySettings}
              planModeIdeology={planModeIdeology}
              onSetPlanModeIdeology={onSetPlanModeIdeology}
              smartCompactSettings={smartCompactSettings}
              onSetSmartCompactSettings={onSetSmartCompactSettings}
              cavemanOnLevel={cavemanOnLevel}
              onSetCavemanOnLevel={onSetCavemanOnLevel}
            />
          ) : null}

          {section === "providers" ? (
            <SettingsProvidersSection
              runtime={runtime}
              onLoginProvider={onLoginProvider}
              onLogoutProvider={onLogoutProvider}
              onSetProviderApiKey={onSetProviderApiKey}
              onRemoveProviderApiKey={onRemoveProviderApiKey}
            />
          ) : null}

          {section === "models" ? (
            <SettingsModelsSection
              runtime={runtime}
              onSetDefaultModel={onSetDefaultModel}
              onSetScopedModelPatterns={onSetScopedModelPatterns}
              onSetThinkingLevel={onSetThinkingLevel}
            />
          ) : null}

          {section === "notifications" ? (
            <SettingsNotificationsSection
              notificationPreferences={notificationPreferences}
              notificationPermissionStatus={notificationPermissionStatus}
              notificationPermissionPending={notificationPermissionPending}
              onSetNotificationPreferences={onSetNotificationPreferences}
              onRequestNotificationPermission={onRequestNotificationPermission}
              onOpenSystemNotificationSettings={onOpenSystemNotificationSettings}
            />
          ) : null}

          {section === "sounds" ? (
            <SettingsSoundsSection
              soundSettings={buttonSoundSettings}
              onSetSoundSettings={onSetButtonSoundSettings}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

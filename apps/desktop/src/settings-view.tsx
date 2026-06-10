import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
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
import { SettingsActionsSection } from "./settings-actions-section";
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
  readonly composerDeviceMode: import("./desktop-state").ComposerDeviceMode;
  readonly streamReveal: import("./desktop-state").StreamRevealMode;
  readonly streamRevealSpeed: import("./desktop-state").StreamRevealSpeed;
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
  readonly onAddCustomProvider: (config: import("./ipc").CustomProviderConfig) => Promise<string | undefined>;
  readonly onRemoveCustomProvider: (providerId: string) => Promise<string | undefined>;
  readonly onSetNotificationPreferences: (preferences: Partial<NotificationPreferences>) => void;
  readonly onSetIntegratedTerminalShell: (shellPath: string) => void;
  readonly onChooseExternalTerminalApp: () => void;
  readonly onClearExternalTerminalApp: () => void;
  readonly onRequestNotificationPermission: () => void;
  readonly onOpenSystemNotificationSettings: () => void;
  readonly onSetThemeMode: (mode: import("./desktop-state").ThemeMode) => void;
  readonly onSetComposerDeviceMode: (mode: import("./desktop-state").ComposerDeviceMode) => void;
  readonly onSetStreamReveal: (mode: import("./desktop-state").StreamRevealMode) => void;
  readonly onSetStreamRevealSpeed: (speed: import("./desktop-state").StreamRevealSpeed) => void;
  readonly onSetThreadTransition: (settings: Partial<ThreadTransitionSettings>) => void;
  readonly onSetButtonSoundSettings: (settings: ButtonSoundSettings) => void;
  readonly retrySettings: { readonly enabled: boolean; readonly maxRetries: number; readonly baseDelayMs: number };
  readonly onSetRetrySettings: (settings: { readonly enabled: boolean; readonly maxRetries: number; readonly baseDelayMs: number }) => void;
  readonly planModeIdeology: import("./desktop-state").PlanModeIdeologySetting;
  readonly onSetPlanModeIdeology: (ideology: import("./desktop-state").PlanModeIdeologySetting) => void;
  readonly commitPushModel?: string;
  readonly onSetCommitPushModel: (model: string) => void;
  readonly autoShip?: boolean;
  readonly onSetAutoShip: (value: boolean) => void;
  readonly smartCompactSettings: import("./ipc").SmartCompactSettings;
  readonly onSetSmartCompactSettings: (settings: Partial<import("./ipc").SmartCompactSettings>) => void;
  readonly cavemanLevel: CavemanLevel;
  readonly activeView: string;
  readonly queueMode: boolean;
  readonly onSetCavemanLevel: (level: CavemanLevel) => void;
  readonly onSetActiveView: (view: import("./desktop-state").AppView) => void;
  readonly onSetQueueMode: (enabled: boolean) => void;
  readonly onOpenKanban: () => void;
  readonly chassisActions?: readonly import("./chassis").ChassisAction[];
  readonly refreshChassisActions?: () => void;
  readonly chassisFolderPath?: string;
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
  composerDeviceMode,
  streamReveal,
  streamRevealSpeed,
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
  onAddCustomProvider,
  onRemoveCustomProvider,
  onSetNotificationPreferences,
  onSetIntegratedTerminalShell,
  onChooseExternalTerminalApp,
  onClearExternalTerminalApp,
  onRequestNotificationPermission,
  onOpenSystemNotificationSettings,
  onSetThemeMode,
  onSetComposerDeviceMode,
  onSetStreamReveal,
  onSetStreamRevealSpeed,
  onSetThreadTransition,
  onSetButtonSoundSettings,
  retrySettings,
  onSetRetrySettings,
  planModeIdeology,
  onSetPlanModeIdeology,
  commitPushModel,
  onSetCommitPushModel,
  autoShip,
  onSetAutoShip,
  smartCompactSettings,
  onSetSmartCompactSettings,
  cavemanLevel,
  activeView,
  queueMode,
  onSetCavemanLevel,
  onSetActiveView,
  onSetQueueMode,
  onOpenKanban,
  chassisActions,
  refreshChassisActions,
  chassisFolderPath,
}: SettingsViewProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [noResults, setNoResults] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const settingsContentRef = useRef<HTMLDivElement | null>(null);

  // DOM-based filtering: hide settings rows/groups that don't match.
  useEffect(() => {
    const root = settingsContentRef.current;
    if (!root) return;

    const q = searchQuery.trim().toLowerCase();
    if (!q) {
      // Show everything.
      root.querySelectorAll<HTMLElement>("[data-searchable]").forEach((el) => {
        el.style.removeProperty("display");
      });
      root.querySelectorAll<HTMLElement>("[data-section]").forEach((el) => {
        el.style.removeProperty("display");
      });
      setNoResults(false);
      return;
    }

    const allSearchable = root.querySelectorAll<HTMLElement>("[data-searchable]");

    // First pass: mark which elements match.
    const visible = new Set<HTMLElement>();
    for (const el of allSearchable) {
      const text = (el.dataset.searchable ?? "").toLowerCase();
      if (text.includes(q)) {
        // This element matches — mark it and all ancestors.
        let node: HTMLElement | null = el;
        while (node) {
          if (visible.has(node)) break; // already marked
          if (node.dataset.searchable !== undefined) {
            visible.add(node);
          }
          node = node.parentElement?.closest<HTMLElement>("[data-searchable]") ?? null;
        }
      }
    }

    // Second pass: apply visibility.
    for (const el of allSearchable) {
      el.style.display = visible.has(el) ? "" : "none";
    }

    // Third pass: hide section wrappers with no visible searchable children.
    let anyVisible = false;
    root.querySelectorAll<HTMLElement>("[data-section]").forEach((wrapper) => {
      const hasVisibleChild = wrapper.querySelector<HTMLElement>("[data-searchable]:not([style*='display: none'])");
      wrapper.style.display = hasVisibleChild ? "" : "none";
      if (hasVisibleChild) anyVisible = true;
    });
    setNoResults(!anyVisible);
  }, [searchQuery]);



  const isSearching = searchQuery.trim().length > 0;

  if (!workspace && section !== "general" && section !== "notifications" && section !== "appearance" && section !== "sounds" && section !== "actions") {
    return (
      <div className="empty-panel">
        <div className="session-header__eyebrow">Settings</div>
        <h1>Select a workspace</h1>
        <p>Provider and skill settings need a selected workspace.</p>
      </div>
    );
  }

  return (
    <div className="settings-view mx-auto flex w-full max-w-[1080px] gap-10 animate-in fade-in duration-300">
      <nav className="settings-sidebar flex w-44 shrink-0 flex-col gap-1">
        <div className="settings-search-bar relative mb-2">
          <Search
            aria-hidden
            className="settings-search-bar__icon pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <input
            ref={searchInputRef}
            className="settings-search-bar__input h-8 w-full rounded-lg border border-input bg-card pr-2 pl-8 text-[13px] text-foreground shadow-xs outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
            type="text"
            placeholder="Search settings…"
            value={searchQuery}
            data-settings-search
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") setSearchQuery(""); }}
          />
        </div>
        {(["appearance", "general", "providers", "models", "notifications", "sounds", "actions"] as const).map((item) => (
          <button
            key={item}
            className={cn(
              "settings-sidebar__item rounded-lg px-3 py-1.5 text-left text-[13px] font-medium text-muted-foreground transition-colors duration-150 hover:bg-accent/60 hover:text-foreground",
              section === item &&
                "settings-sidebar__item--active bg-brand/10 text-brand hover:bg-brand/10 hover:text-brand",
            )}
            type="button"
            onClick={() => onSelectSection(item)}
          >
            {sectionTitle(item)}
          </button>
        ))}
      </nav>

      <div className="settings-content min-w-0 flex-1" ref={settingsContentRef}>
        {isSearching ? (
          <>
            <h1 className="view-header__title mt-0 mb-6 text-2xl font-semibold tracking-tight text-foreground">Search results</h1>
            <div className="settings-grid grid gap-8">
              <div data-section="appearance">
                <h2 className="settings-section-heading mt-2 mb-4 border-b border-border pb-2 text-base font-semibold text-foreground">{sectionTitle("appearance")}</h2>
                <div className="settings-grid__section grid gap-7">
                  <SettingsAppearanceSection
                    themeMode={themeMode}
                    onSetThemeMode={onSetThemeMode}
                    composerDeviceMode={composerDeviceMode}
                    onSetComposerDeviceMode={onSetComposerDeviceMode}
                    streamReveal={streamReveal}
                    onSetStreamReveal={onSetStreamReveal}
                    streamRevealSpeed={streamRevealSpeed}
                    onSetStreamRevealSpeed={onSetStreamRevealSpeed}
                    threadTransition={threadTransition}
                    onSetThreadTransition={onSetThreadTransition}
                    onSetActiveView={onSetActiveView}
                  />
                </div>
              </div>
              <div data-section="general">
                <h2 className="settings-section-heading mt-2 mb-4 border-b border-border pb-2 text-base font-semibold text-foreground">{sectionTitle("general")}</h2>
                <div className="settings-grid__section grid gap-7">
                  <SettingsGeneralSection
                    runtime={runtime}
                    modelSettingsScopeMode={modelSettingsScopeMode}
                    integratedTerminalShell={integratedTerminalShell}
                    externalTerminalApp={externalTerminalApp}
                    retrySettings={retrySettings}
                    commitPushModel={commitPushModel}
                    onSetCommitPushModel={onSetCommitPushModel}
                    autoShip={autoShip}
                    onSetAutoShip={onSetAutoShip}
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
                    cavemanLevel={cavemanLevel}
                    activeView={activeView}
                    queueMode={queueMode}
                    onSetCavemanLevel={onSetCavemanLevel}
                    onSetActiveView={onSetActiveView}
                    onSetQueueMode={onSetQueueMode}
                    onOpenKanban={onOpenKanban}
                  />
                </div>
              </div>
              <div data-section="providers">
                <h2 className="settings-section-heading mt-2 mb-4 border-b border-border pb-2 text-base font-semibold text-foreground">{sectionTitle("providers")}</h2>
                <div className="settings-grid__section grid gap-7">
                  <SettingsProvidersSection
                    runtime={runtime}
                    onLoginProvider={onLoginProvider}
                    onLogoutProvider={onLogoutProvider}
                    onSetProviderApiKey={onSetProviderApiKey}
                    onRemoveProviderApiKey={onRemoveProviderApiKey}
                    onAddCustomProvider={onAddCustomProvider}
                    onRemoveCustomProvider={onRemoveCustomProvider}
                  />
                </div>
              </div>
              <div data-section="models">
                <h2 className="settings-section-heading mt-2 mb-4 border-b border-border pb-2 text-base font-semibold text-foreground">{sectionTitle("models")}</h2>
                <div className="settings-grid__section grid gap-7">
                  <SettingsModelsSection
                    runtime={runtime}
                    onSetDefaultModel={onSetDefaultModel}
                    onSetScopedModelPatterns={onSetScopedModelPatterns}
                    onSetThinkingLevel={onSetThinkingLevel}
                  />
                </div>
              </div>
              <div data-section="notifications">
                <h2 className="settings-section-heading mt-2 mb-4 border-b border-border pb-2 text-base font-semibold text-foreground">{sectionTitle("notifications")}</h2>
                <div className="settings-grid__section grid gap-7">
                  <SettingsNotificationsSection
                    notificationPreferences={notificationPreferences}
                    notificationPermissionStatus={notificationPermissionStatus}
                    notificationPermissionPending={notificationPermissionPending}
                    onSetNotificationPreferences={onSetNotificationPreferences}
                    onRequestNotificationPermission={onRequestNotificationPermission}
                    onOpenSystemNotificationSettings={onOpenSystemNotificationSettings}
                  />
                </div>
              </div>
              <div data-section="sounds">
                <h2 className="settings-section-heading mt-2 mb-4 border-b border-border pb-2 text-base font-semibold text-foreground">{sectionTitle("sounds")}</h2>
                <div className="settings-grid__section grid gap-7">
                  <SettingsSoundsSection
                    soundSettings={buttonSoundSettings}
                    onSetSoundSettings={onSetButtonSoundSettings}
                  />
                </div>
              </div>
              <div data-section="actions">
                <h2 className="settings-section-heading mt-2 mb-4 border-b border-border pb-2 text-base font-semibold text-foreground">{sectionTitle("actions")}</h2>
                <div className="settings-grid__section grid gap-7">
                  <SettingsActionsSection
                    api={window.piApp}
                    chassisActions={chassisActions ?? []}
                    refreshChassisActions={refreshChassisActions}
                    runtime={runtime}
                    chassisFolderPath={chassisFolderPath}
                  />
                </div>
              </div>
            </div>
            {noResults ? (
              <p className="settings-search-empty py-10 text-center text-sm text-muted-foreground">No matching settings found.</p>
            ) : null}
          </>
        ) : (
          <>
            <h1 className="view-header__title mt-0 mb-6 text-2xl font-semibold tracking-tight text-foreground">{sectionTitle(section)}</h1>
            <div className="settings-grid grid gap-7 animate-in fade-in slide-in-from-bottom-1 duration-200" key={section}>
              {section === "appearance" ? (
                <SettingsAppearanceSection
                  themeMode={themeMode}
                  onSetThemeMode={onSetThemeMode}
                  composerDeviceMode={composerDeviceMode}
                  onSetComposerDeviceMode={onSetComposerDeviceMode}
                  streamReveal={streamReveal}
                  onSetStreamReveal={onSetStreamReveal}
                  streamRevealSpeed={streamRevealSpeed}
                  onSetStreamRevealSpeed={onSetStreamRevealSpeed}
                  threadTransition={threadTransition}
                  onSetThreadTransition={onSetThreadTransition}
                  onSetActiveView={onSetActiveView}
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
                  autoShip={autoShip}
                  onSetAutoShip={onSetAutoShip}
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
                  cavemanLevel={cavemanLevel}
                  activeView={activeView}
                  queueMode={queueMode}
                  onSetCavemanLevel={onSetCavemanLevel}
                  onSetActiveView={onSetActiveView}
                  onSetQueueMode={onSetQueueMode}
                  onOpenKanban={onOpenKanban}
                />
              ) : null}
              {section === "providers" ? (
                <SettingsProvidersSection
                  runtime={runtime}
                  onLoginProvider={onLoginProvider}
                  onLogoutProvider={onLogoutProvider}
                  onSetProviderApiKey={onSetProviderApiKey}
                  onRemoveProviderApiKey={onRemoveProviderApiKey}
                  onAddCustomProvider={onAddCustomProvider}
                  onRemoveCustomProvider={onRemoveCustomProvider}
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
              {section === "actions" ? (
                <div data-testid="settings-actions-section">
                  <SettingsActionsSection
                    api={window.piApp}
                    chassisActions={chassisActions ?? []}
                    refreshChassisActions={refreshChassisActions}
                    runtime={runtime}
                    chassisFolderPath={chassisFolderPath}
                  />
                </div>
              ) : null}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

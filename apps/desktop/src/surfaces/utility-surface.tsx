import { Dispatch, SetStateAction, useMemo, type ReactNode } from "react";

import type {
  AppView,
  ContextSnapshot,
  DesktopAppState,
  ExtensionCommandCompatibilityRecord,
  WorkspaceRecord,
} from "../desktop-state";
import type { RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import type { SmartCompactSettings, PiDesktopApi } from "../ipc";
import type { SettingsSection } from "../settings-view";
import { useSettingsHandlers } from "../hooks/use-settings-handlers";
import { useSkillsExtensionsHandlers } from "../hooks/use-skills-extensions";
import type { SidebarNavEntry } from "../hooks/build-sidebar-nav-list";
import type { SidebarResize } from "../hooks/use-sidebar-width";
import type { WorkspaceMenuState } from "../hooks/use-workspace-menu";
import { useGlobalSearch } from "../hooks/use-global-search";
import { type ThreadGroup } from "../thread-groups";
import type { Automation } from "../desktop-state";

import { SettingsView } from "../settings-view";
import { SettingsSubagentsSection } from "../settings-subagents-section";
import { SkillsView } from "../skills-view";
import { ExtensionsView } from "../extensions-view";
import { AutomationsView } from "../automations-view";
import { ContextView } from "../context-view";
import { Sidebar } from "../sidebar";
import { SidebarToggleButton } from "../sidebar-toggle-button";
import { ShortcutsSheet } from "../shortcuts-sheet";
import { SearchPalette } from "../search-palette";
import { Agentation } from "agentation";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface UpdateSnapshotFn {
  (
    api: NonNullable<typeof window.piApp>,
    setSnapshot: Dispatch<SetStateAction<DesktopAppState | null>>,
    action: () => Promise<DesktopAppState>,
  ): Promise<DesktopAppState>;
}

// Props common to all utility-view surfaces.
// View-specific props are passed through the `content` render prop.
export interface UtilitySurfaceProps {
  readonly activeView: AppView;
  readonly snapshot: DesktopAppState;
  readonly api: PiDesktopApi;
  readonly setSnapshot: Dispatch<SetStateAction<DesktopAppState | null>>;
  readonly updateSnapshot: UpdateSnapshotFn;

  // Sidebar
  readonly sidebarResize: SidebarResize;
  readonly sidebarCollapsed: boolean;
  readonly selectedWorkspace: WorkspaceRecord | undefined;
  readonly selectedSession: import("../desktop-state").SessionRecord | undefined;
  readonly chats: readonly import("../desktop-state").ChatRecord[];
  readonly visibleWorkspaces: readonly WorkspaceRecord[];
  readonly threadGroups: readonly ThreadGroup[];
  readonly linkedWorktreeByWorkspaceId: Map<string, import("../desktop-state").WorktreeRecord>;
  readonly wsMenu: WorkspaceMenuState;
  readonly queueMode: boolean;
  readonly pendingSidebarSelection: SidebarNavEntry | null;
  readonly automations: readonly Automation[];

  // Sidebar callbacks
  readonly onNewThreadForWorkspace: (rootWorkspaceId: string) => void;
  readonly onSetActiveView: (view: AppView) => void;
  readonly onOpenSkills: (workspaceId?: string) => void;
  readonly onOpenExtensions: (workspaceId?: string) => void;
  readonly onOpenSettings: (workspaceId?: string) => void;
  readonly onOpenKanban: () => void;
  readonly onOpenAutomations: (workspaceId?: string) => void;
  readonly onOpenAgents: () => void;
  readonly testingCount: number;
  readonly onOpenTesting: () => void;
  readonly onSetQueueMode: (enabled: boolean) => void;
  readonly onArchiveSession: (target: { workspaceId: string; sessionId: string }) => void;
  readonly onArchiveAllNonRunningSessions: (workspaceId: string, olderThanMs?: number) => void;
  readonly onSelectSession: (target: { workspaceId: string; sessionId: string }) => void;
  readonly onUnarchiveSession: (target: { workspaceId: string; sessionId: string }) => void;
  readonly onSnoozeSession: (target: { workspaceId: string; sessionId: string }, until: string) => void;
  readonly onUnsnoozeSession: (target: { workspaceId: string; sessionId: string }) => void;
  readonly onMarkToTestSession: (target: { workspaceId: string; sessionId: string }) => void;
  readonly onUnmarkToTestSession: (target: { workspaceId: string; sessionId: string }) => void;
  readonly onCreateChat: () => void;
  readonly onSelectChat: (chatId: string) => void;
  readonly onArchiveChat: (chatId: string) => void;
  readonly onUnarchiveChat: (chatId: string) => void;
  readonly onRemoveChat: (chatId: string) => void;

  // Shell chrome
  readonly primarySidebarToggleVisible: boolean;
  readonly sidebarToggleShortcutLabel: string;
  readonly onTogglePrimarySidebar: () => void;
  readonly shortcutsSheetOpen: boolean;
  readonly onCloseShortcutsSheet: () => void;
  readonly globalSearch: ReturnType<typeof useGlobalSearch>;
  readonly onGlobalSearchSelect: (result: ReturnType<typeof useGlobalSearch>["results"][number]) => void;
  /** Restores focus to the composer after search closes. */
  readonly restoreComposerFocus?: () => void;

  // View-specific children
  readonly content: ReactNode;
}

// ── Component ──────────────────────────────────────────────────────────────────

export function UtilitySurface(props: UtilitySurfaceProps) {
  const {
    snapshot,
    api,
    sidebarResize,
    selectedWorkspace,
    selectedSession,
    chats,
    visibleWorkspaces,
    threadGroups,
    linkedWorktreeByWorkspaceId,
    wsMenu,
    queueMode,
    pendingSidebarSelection,
    automations,
    onNewThreadForWorkspace,
    onSetActiveView,
    onOpenSkills,
    onOpenExtensions,
    onOpenSettings,
    onOpenKanban: _onOpenKanban,
    onOpenAutomations,
    onOpenAgents,
    testingCount,
    onOpenTesting,
    onSetQueueMode: _onSetQueueMode,
    onArchiveSession,
    onArchiveAllNonRunningSessions,
    onSelectSession,
    onUnarchiveSession,
    onSnoozeSession,
    onUnsnoozeSession,
    onMarkToTestSession,
    onUnmarkToTestSession,
    onCreateChat,
    onSelectChat,
    onArchiveChat,
    onUnarchiveChat,
    onRemoveChat,
    primarySidebarToggleVisible,
    sidebarToggleShortcutLabel,
    onTogglePrimarySidebar,
    shortcutsSheetOpen,
    onCloseShortcutsSheet,
    globalSearch,
    onGlobalSearchSelect,
    restoreComposerFocus,
    content,
  } = props;

  const shellClass = `shell shell--skills${snapshot.sidebarCollapsed ? " shell--sidebar-collapsed" : ""}${sidebarResize.isResizing ? " shell--sidebar-resizing" : ""}`;
  const shellStyle = snapshot.sidebarCollapsed
    ? undefined
    : ({ ["--sidebar-width" as string]: `${sidebarResize.width}px` } as React.CSSProperties);

  return (
    <div className={shellClass} style={shellStyle}>
      {globalSearch.isOpen ? (
        <SearchPalette
          query={globalSearch.query}
          scope={globalSearch.scope}
          archiveFilter={globalSearch.archiveFilter}
          results={globalSearch.results}
          currentProjectIds={globalSearch.currentProjectIds}
          activeIndex={globalSearch.activeIndex}
          onQueryChange={globalSearch.setQuery}
          onScopeChange={globalSearch.setScope}
          onArchiveFilterChange={globalSearch.setArchiveFilter}
          onActiveIndexChange={globalSearch.setActiveIndex}
          onSelect={onGlobalSearchSelect}
          onClose={globalSearch.close}
          restoreFocus={restoreComposerFocus}
        />
      ) : null}
      {shortcutsSheetOpen ? (
        <ShortcutsSheet platform={api.platform} onClose={onCloseShortcutsSheet} />
      ) : null}
      {primarySidebarToggleVisible ? (
        <SidebarToggleButton
          collapsed={snapshot.sidebarCollapsed}
          shortcutLabel={sidebarToggleShortcutLabel}
          onToggle={onTogglePrimarySidebar}
        />
      ) : null}
      {(
        <Sidebar
          collapsed={snapshot.sidebarCollapsed}
          resize={sidebarResize}
          activeView={snapshot.activeView}
          selectedWorkspace={selectedWorkspace}
          selectedSession={selectedSession}
          chats={chats}
          visibleWorkspaces={visibleWorkspaces}
          threadGroups={threadGroups}
          linkedWorktreeByWorkspaceId={linkedWorktreeByWorkspaceId}
          wsMenu={wsMenu}
          api={api}
          setSnapshot={props.setSnapshot}
          updateSnapshot={props.updateSnapshot}
          onNewThreadForWorkspace={onNewThreadForWorkspace}
          onSetActiveView={onSetActiveView}
          onOpenSkills={onOpenSkills}
          onOpenExtensions={onOpenExtensions}
          onOpenSettings={onOpenSettings}
          queueMode={queueMode}
          onArchiveSession={onArchiveSession}
          onArchiveAllNonRunningSessions={onArchiveAllNonRunningSessions}
          onSelectSession={onSelectSession}
          onUnarchiveSession={onUnarchiveSession}
          onSnoozeSession={onSnoozeSession}
          onUnsnoozeSession={onUnsnoozeSession}
          onMarkToTestSession={onMarkToTestSession}
          onUnmarkToTestSession={onUnmarkToTestSession}
          onCreateChat={onCreateChat}
          onSelectChat={onSelectChat}
          onArchiveChat={onArchiveChat}
          onUnarchiveChat={onUnarchiveChat}
          onRemoveChat={onRemoveChat}
          pendingSidebarSelection={pendingSidebarSelection}
          automations={automations}
          onOpenAutomations={onOpenAutomations}
          onOpenAgents={onOpenAgents}
          testingCount={testingCount}
          onOpenTesting={onOpenTesting}
          onOpenSearch={globalSearch.open}
        />
      )}
      <main className="main main--skills">{content}</main>
      {import.meta.env.DEV && <Agentation />}
    </div>
  );
}

// ── Testing surface ────────────────────────────────────────────────────────────

export interface TestingSurfaceProps {
  readonly snapshot: DesktopAppState;
  readonly onSelectSession: (target: { workspaceId: string; sessionId: string }) => void;
  readonly onSetActiveView: (view: AppView) => void;
  readonly onUnmarkToTestSession: (target: { workspaceId: string; sessionId: string }) => void;
}

interface TestingItem {
  readonly workspaceId: string;
  readonly sessionId: string;
  readonly workspaceName: string;
  readonly title: string;
  readonly note: string | undefined;
  readonly createdAt: string;
}

// The park-for-testing prompt asks the session to reply with a one-row markdown
// table: | Feature | Test |. Pull out the two data cells so we can render them
// as labelled columns instead of dumping raw markdown.
function parseRunthrough(note: string | undefined): { feature: string; test: string } | undefined {
  if (!note) {
    return undefined;
  }
  // The model often emits the whole table on one line, so split on every pipe
  // rather than per-line, then drop empty cells, the header labels, and the
  // |---|---| separator dashes. What remains is the single data row.
  const cells = note
    .split("|")
    .map((cell) => cell.trim())
    .filter((cell) => {
      if (!cell) return false;
      if (/^:?-+:?$/.test(cell)) return false; // separator dashes
      if (/^(feature|test)$/i.test(cell)) return false; // header labels
      return true;
    });
  if (cells.length < 2) {
    return undefined;
  }
  return { feature: cells[0] ?? "", test: cells[1] ?? "" };
}

export function TestingSurface({ snapshot, onSelectSession, onSetActiveView, onUnmarkToTestSession }: TestingSurfaceProps) {
  const items = useMemo<TestingItem[]>(() => {
    const out: TestingItem[] = [];
    for (const workspace of snapshot.workspaces) {
      for (const session of workspace.sessions) {
        if (!session.toTestAt) {
          continue;
        }
        out.push({
          workspaceId: workspace.id,
          sessionId: session.id,
          workspaceName: workspace.name,
          title: session.title,
          note: session.toTestNote,
          createdAt: session.toTestAt,
        });
      }
    }
    out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return out;
  }, [snapshot.workspaces]);

  const openThread = (item: TestingItem) => {
    onSelectSession({ workspaceId: item.workspaceId, sessionId: item.sessionId });
    onSetActiveView("threads");
  };

  return (
    <div className="testing-surface">
      <header className="testing-surface__header">
        <h1 className="testing-surface__title">Testing</h1>
        <p className="testing-surface__subtitle">
          {items.length === 0
            ? "Nothing to test. Park a thread with the eye button to queue a runthrough here."
            : `${items.length} ${items.length === 1 ? "thread" : "threads"} waiting to be checked.`}
        </p>
      </header>
      {items.length > 0 ? (
        <ul className="testing-list">
          {items.map((item) => (
            <li key={`${item.workspaceId}:${item.sessionId}`} className="testing-item">
              <button
                type="button"
                className="testing-item__check"
                aria-label="Mark checked"
                title="Mark checked"
                onClick={(event) => {
                  event.stopPropagation();
                  onUnmarkToTestSession({ workspaceId: item.workspaceId, sessionId: item.sessionId });
                }}
              >
                <span className="testing-item__checkbox" aria-hidden="true" />
              </button>
              <button type="button" className="testing-item__body" onClick={() => openThread(item)}>
                <span className="testing-item__heading">
                  <span className="testing-item__name">{item.title || "Untitled thread"}</span>
                  <span className="testing-item__workspace">{item.workspaceName}</span>
                </span>
                {(() => {
                  const parsed = parseRunthrough(item.note);
                  if (parsed) {
                    return (
                      <span className="testing-item__columns">
                        <span className="testing-item__col">
                          <span className="testing-item__col-label">Feature</span>
                          <span className="testing-item__col-text">{parsed.feature}</span>
                        </span>
                        <span className="testing-item__col">
                          <span className="testing-item__col-label">How to test</span>
                          <span className="testing-item__col-text">{parsed.test}</span>
                        </span>
                      </span>
                    );
                  }
                  return (
                    <span className="testing-item__note">
                      {item.note ? item.note : <em className="testing-item__pending">Waiting for runthrough…</em>}
                    </span>
                  );
                })()}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

// ── Settings surface ───────────────────────────────────────────────────────────

export interface SettingsSurfaceProps {
  readonly snapshot: DesktopAppState;
  readonly rootWorkspaceOptions: readonly WorkspaceRecord[];
  readonly settingsWorkspace: WorkspaceRecord | undefined;
  readonly settingsSection: SettingsSection;
  readonly settingsRuntime: RuntimeSnapshot | undefined;
  readonly settingsModelRuntime: RuntimeSnapshot | undefined;
  readonly themeMode: "system" | "light" | "dark" | "dracula";
  readonly notificationPermissionStatus: import("../ipc").DesktopNotificationPermissionStatus;
  readonly notificationPermissionPending: boolean;
  readonly buttonSoundSettings: import("../button-click-sound").ButtonSoundSettings;
  readonly smartCompactSettings: SmartCompactSettings;
  readonly cavemanLevel: import("../ipc").CavemanLevel;
  readonly onSetCavemanLevel: (level: import("../ipc").CavemanLevel) => void;
  readonly rootWorkspace: WorkspaceRecord | undefined;
  readonly api: PiDesktopApi;
  readonly setSnapshot: Dispatch<SetStateAction<DesktopAppState | null>>;
  readonly updateSnapshot: UpdateSnapshotFn;
  readonly settingsHandlers: ReturnType<typeof useSettingsHandlers>;
  readonly handleRequestNotificationPermission: () => void;
  readonly handleOpenSystemNotificationSettings: () => void;
  readonly setSettingsWorkspaceId: (id: string) => void;
  readonly setSettingsSection: (section: SettingsSection) => void;
  readonly setActiveView: (view: AppView) => void;
  readonly setButtonSoundSettings: Dispatch<SetStateAction<import("../button-click-sound").ButtonSoundSettings>>;
  readonly setSmartCompactSettings: Dispatch<SetStateAction<SmartCompactSettings>>;
  readonly activeView: AppView;
  readonly queueMode: boolean;
  readonly onSetActiveView: (view: AppView) => void;
  readonly onSetQueueMode: (enabled: boolean) => void;
  readonly onOpenKanban: () => void;
  readonly chassisActions?: readonly import("../chassis").ChassisAction[];
  readonly refreshChassisActions?: () => void;
}

export function SettingsSurface(props: SettingsSurfaceProps) {
  const {
    snapshot,
    rootWorkspaceOptions,
    settingsWorkspace,
    settingsSection,
    settingsRuntime,
    settingsModelRuntime,
    themeMode,
    notificationPermissionStatus,
    notificationPermissionPending,
    buttonSoundSettings,
    smartCompactSettings,
    cavemanLevel,
    onSetCavemanLevel,
    rootWorkspace,
    api,
    setSnapshot,
    updateSnapshot,
    settingsHandlers,
    handleRequestNotificationPermission,
    handleOpenSystemNotificationSettings,
    setSettingsWorkspaceId,
    setSettingsSection,
    setActiveView,
    setButtonSoundSettings,
    setSmartCompactSettings,
    activeView,
    queueMode: settingsQueueMode,
    onSetActiveView,
    onSetQueueMode,
    onOpenKanban,
    chassisActions,
    refreshChassisActions,
  } = props;

  return (
    <>
      {settingsSection === "providers" || (settingsSection === "models" && snapshot.modelSettingsScopeMode === "per-repo") ? (
        <div className="surface-toolbar">
          <label className="surface-toolbar__field">
            <span>Workspace</span>
            <select
              value={settingsWorkspace?.id ?? ""}
              onChange={(event) => setSettingsWorkspaceId(event.target.value)}
            >
              {rootWorkspaceOptions.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}
      <SettingsView
        workspace={settingsWorkspace}
        runtime={settingsSection === "models" ? settingsModelRuntime : settingsRuntime}
        section={settingsSection}
        onSelectSection={setSettingsSection}
        onBack={() => setActiveView("threads")}
        notificationPreferences={snapshot.notificationPreferences}
        notificationPermissionStatus={notificationPermissionStatus}
        notificationPermissionPending={notificationPermissionPending}
        modelSettingsScopeMode={snapshot.modelSettingsScopeMode}
        integratedTerminalShell={snapshot.integratedTerminalShell}
        externalTerminalApp={snapshot.externalTerminalApp}
        themeMode={themeMode}
        composerDeviceMode={snapshot.composerDeviceMode}
        streamReveal={snapshot.streamReveal}
        streamRevealSpeed={snapshot.streamRevealSpeed}
        threadTransition={snapshot.threadTransition}
        buttonSoundSettings={buttonSoundSettings}
        retrySettings={snapshot.retrySettings}
        planModeIdeology={snapshot.planModeIdeology}
        onSetPlanModeIdeology={(ideology) => {
          void updateSnapshot(api, setSnapshot, () => api.setPlanModeIdeology(ideology));
        }}
        onSetRetrySettings={(settings) => {
          void updateSnapshot(api, setSnapshot, () => api.setRetrySettings(settings));
        }}
        onLoginProvider={settingsHandlers.handleLoginProvider}
        onLogoutProvider={settingsHandlers.handleLogoutProvider}
        onSetProviderApiKey={settingsHandlers.handleSetProviderApiKey}
        onRemoveProviderApiKey={settingsHandlers.handleRemoveProviderApiKey}
        onAddCustomProvider={settingsHandlers.handleAddCustomProvider}
        onRemoveCustomProvider={settingsHandlers.handleRemoveCustomProvider}
        onSetModelSettingsScopeMode={settingsHandlers.handleSetModelSettingsScopeMode}
        onSetDefaultModel={settingsHandlers.handleSetDefaultModel}
        onSetNotificationPreferences={settingsHandlers.handleSetNotificationPreferences}
        onSetIntegratedTerminalShell={settingsHandlers.handleSetIntegratedTerminalShell}
        onChooseExternalTerminalApp={settingsHandlers.handleChooseExternalTerminalApp}
        onClearExternalTerminalApp={settingsHandlers.handleClearExternalTerminalApp}
        onRequestNotificationPermission={handleRequestNotificationPermission}
        onOpenSystemNotificationSettings={handleOpenSystemNotificationSettings}
        onSetScopedModelPatterns={settingsHandlers.handleSetScopedModelPatterns}
        onSetThemeMode={settingsHandlers.handleSetThemeMode}
        onSetThinkingLevel={settingsHandlers.handleSetThinkingLevel}
        onToggleSkillCommands={settingsHandlers.handleToggleSkillCommands}
        onSetComposerDeviceMode={(enabled) => {
          void updateSnapshot(api, setSnapshot, () => api.setComposerDeviceMode(enabled));
        }}
        onSetStreamReveal={(mode) => {
          void updateSnapshot(api, setSnapshot, () => api.setStreamReveal(mode));
        }}
        onSetStreamRevealSpeed={(speed) => {
          void updateSnapshot(api, setSnapshot, () => api.setStreamRevealSpeed(speed));
        }}
        onSetThreadTransition={(settings) => {
          void updateSnapshot(api, setSnapshot, () => api.setThreadTransition(settings));
        }}
        onSetButtonSoundSettings={setButtonSoundSettings}
        commitPushModel={snapshot.commitPushModel}
        onSetCommitPushModel={(model) => {
          void updateSnapshot(api, setSnapshot, () => api.setCommitPushModel(rootWorkspace?.id ?? "", model));
        }}
        autoShip={snapshot.autoShip}
        onSetAutoShip={(value) => {
          void updateSnapshot(api, setSnapshot, () => api.setAutoShip(value));
        }}
        smartCompactSettings={smartCompactSettings}
        cavemanLevel={cavemanLevel}
        activeView={activeView}
        queueMode={settingsQueueMode}
        onSetCavemanLevel={onSetCavemanLevel}
        onSetActiveView={onSetActiveView}
        onSetQueueMode={onSetQueueMode}
        onOpenKanban={onOpenKanban}
        onSetSmartCompactSettings={(settings) => {
          const appApi = window.piApp;
          if (!appApi) return;
          appApi.setSmartCompactSettings(settings).then((next) => {
            setSmartCompactSettings(next);
          }).catch(() => {});
        }}
        chassisActions={chassisActions}
        refreshChassisActions={refreshChassisActions}
      />
    </>
  );
}

// ── Agents surface ─────────────────────────────────────────────────────────────

export interface AgentsSurfaceProps {
  readonly snapshot: DesktopAppState;
  readonly agentsWorkspace: WorkspaceRecord | undefined;
  readonly agentsRuntime: RuntimeSnapshot | undefined;
  readonly settingsHandlers: ReturnType<typeof useSettingsHandlers>;
}

export function AgentsSurface(props: AgentsSurfaceProps) {
  const { snapshot, agentsWorkspace, agentsRuntime, settingsHandlers } = props;

  return (
    <SettingsSubagentsSection
      workspace={agentsWorkspace}
      settings={snapshot.subagentSettings}
      agents={agentsWorkspace ? snapshot.subagentAgentsByWorkspace[agentsWorkspace.id] ?? [] : []}
      runtime={agentsRuntime}
      onSetSettings={settingsHandlers.handleSetSubagentSettings}
      onRefreshAgents={settingsHandlers.handleRefreshSubagentAgents}
      onSaveAgent={settingsHandlers.handleSaveSubagentAgent}
      onDeleteAgent={settingsHandlers.handleDeleteSubagentAgent}
    />
  );
}

// ── Skills surface ─────────────────────────────────────────────────────────────

export interface SkillsSurfaceProps {
  readonly skillsWorkspace: WorkspaceRecord | undefined;
  readonly rootWorkspaceOptions: readonly WorkspaceRecord[];
  readonly skillsRuntime: RuntimeSnapshot | undefined;
  readonly skillsQuery: string;
  readonly skillsShowDisabled: boolean;
  readonly skillsCollapsedGroups: ReadonlySet<string>;
  readonly skillsSelectedPath: string | undefined;
  readonly skillsExtensionsHandlers: ReturnType<typeof useSkillsExtensionsHandlers>;
  readonly handleTrySkill: (command: string) => void;
  readonly api: PiDesktopApi;
  readonly setSnapshot: Dispatch<SetStateAction<DesktopAppState | null>>;
  readonly updateSnapshot: UpdateSnapshotFn;
  readonly setSkillsWorkspaceId: (id: string) => void;
  readonly setSkillsQuery: (query: string) => void;
  readonly setSkillsShowDisabled: (show: boolean) => void;
  readonly setSkillsCollapsedGroups: Dispatch<SetStateAction<ReadonlySet<string>>>;
  readonly setSkillsSelectedPath: Dispatch<SetStateAction<string | undefined>>;
}

export function SkillsSurface(props: SkillsSurfaceProps) {
  const {
    skillsWorkspace,
    rootWorkspaceOptions,
    skillsRuntime,
    skillsQuery,
    skillsShowDisabled,
    skillsCollapsedGroups,
    skillsSelectedPath,
    skillsExtensionsHandlers,
    handleTrySkill,
    api,
    setSnapshot,
    updateSnapshot,
    setSkillsWorkspaceId,
    setSkillsQuery,
    setSkillsShowDisabled,
    setSkillsCollapsedGroups,
    setSkillsSelectedPath,
  } = props;

  const handleToggleSkillGroup = (key: string) => {
    setSkillsCollapsedGroups((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  return (
    <>
      {rootWorkspaceOptions.length > 1 ? (
        <div className="surface-toolbar">
          <label className="surface-toolbar__field">
            <span>Workspace</span>
            <select
              value={skillsWorkspace?.id ?? ""}
              onChange={(event) => setSkillsWorkspaceId(event.target.value)}
            >
              {rootWorkspaceOptions.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}
      <SkillsView
        workspace={skillsWorkspace}
        runtime={skillsRuntime}
        query={skillsQuery}
        onQueryChange={setSkillsQuery}
        showDisabled={skillsShowDisabled}
        onShowDisabledChange={setSkillsShowDisabled}
        collapsedGroups={skillsCollapsedGroups}
        onToggleGroup={handleToggleSkillGroup}
        selectedSkillPath={skillsSelectedPath}
        onSelectSkill={setSkillsSelectedPath}
        onOpenSkillFolder={skillsExtensionsHandlers.handleOpenSkillFolder}
        onRefresh={() => {
          if (!skillsWorkspace) return;
          void updateSnapshot(api, setSnapshot, () => api.refreshRuntime(skillsWorkspace.id));
        }}
        onToggleSkill={skillsExtensionsHandlers.handleToggleSkill}
        onTrySkill={(skill) =>
          handleTrySkill(
            skill.filePath
              ? `${skill.slashCommand} `
              : "Create a new skill for this workspace and explain which files you will add.",
          )
        }
      />
    </>
  );
}

// ── Extensions surface ─────────────────────────────────────────────────────────

export interface ExtensionsSurfaceProps {
  readonly extensionsWorkspace: WorkspaceRecord | undefined;
  readonly extensionsRuntime: RuntimeSnapshot | undefined;
  readonly extensionsCommandCompatibility: readonly ExtensionCommandCompatibilityRecord[] | undefined;
  readonly smartCompactSettings: SmartCompactSettings;
  readonly skillsExtensionsHandlers: ReturnType<typeof useSkillsExtensionsHandlers>;
  readonly api: PiDesktopApi;
  readonly setSnapshot: Dispatch<SetStateAction<DesktopAppState | null>>;
  readonly updateSnapshot: UpdateSnapshotFn;
}

export function ExtensionsSurface(props: ExtensionsSurfaceProps) {
  const {
    extensionsWorkspace,
    extensionsRuntime,
    extensionsCommandCompatibility,
    smartCompactSettings,
    skillsExtensionsHandlers,
    api,
    setSnapshot,
    updateSnapshot,
  } = props;

  return (
    <ExtensionsView
      workspace={extensionsWorkspace}
      runtime={extensionsRuntime}
      commandCompatibility={extensionsCommandCompatibility}
      onOpenExtensionFolder={skillsExtensionsHandlers.handleOpenExtensionFolder}
      onRefresh={() => {
        if (!extensionsWorkspace) return;
        void updateSnapshot(api, setSnapshot, () => api.refreshRuntime(extensionsWorkspace.id));
      }}
      onToggleExtension={skillsExtensionsHandlers.handleToggleExtension}
      onDeleteExtension={skillsExtensionsHandlers.handleDeleteExtension}
      onAnalyzeExtensionConfig={(extensionPath, model) => window.piApp!.analyzeExtensionConfig(extensionPath, model)}
      onGetExtensionConfig={(extensionPath) => window.piApp!.getExtensionConfig(extensionPath)}
      onSetExtensionConfig={(extensionPath, values) => window.piApp!.setExtensionConfig(extensionPath, values)}
      onInstallExtension={(source, local) => window.piApp!.installExtension(source, local)}
      onUninstallExtension={(source, local) => window.piApp!.uninstallExtension(source, local)}
      availableModels={extensionsRuntime?.models?.map((m: { providerId: string; modelId: string }) => `${m.providerId}:${m.modelId}`) ?? []}
      defaultAnalysisModel={typeof smartCompactSettings?.summaryModel === "string" ? smartCompactSettings.summaryModel : "deepseek:deepseek-chat"}
    />
  );
}

// ── Automations surface ────────────────────────────────────────────────────────

export interface AutomationsSurfaceProps {
  readonly snapshot: DesktopAppState;
  readonly selectedWorkspace: WorkspaceRecord | undefined;
  readonly rootWorkspaceOptions: readonly WorkspaceRecord[];
  readonly api: PiDesktopApi;
  readonly setSnapshot: Dispatch<SetStateAction<DesktopAppState | null>>;
  readonly updateSnapshot: UpdateSnapshotFn;
  readonly onFireNow: (automationId: string, automationName: string, workspaceId: string, prompt: string) => void;
}

export function AutomationsSurface(props: AutomationsSurfaceProps) {
  const { snapshot, selectedWorkspace, rootWorkspaceOptions, api, setSnapshot, updateSnapshot, onFireNow } = props;

  const automationsWorkspaceId = snapshot.automationFilterWorkspaceId ?? selectedWorkspace?.rootWorkspaceId ?? selectedWorkspace?.id;
  const automationsRuntime = automationsWorkspaceId ? snapshot?.runtimeByWorkspace[automationsWorkspaceId] : undefined;

  return (
    <AutomationsView
      automations={snapshot.automations ?? []}
      workspaces={rootWorkspaceOptions}
      filterWorkspaceId={snapshot.automationFilterWorkspaceId}
      defaultWorkspaceId={selectedWorkspace?.rootWorkspaceId ?? selectedWorkspace?.id}
      runtime={automationsRuntime}
      onCreateAutomation={(input) => {
        void updateSnapshot(api, setSnapshot, () => api.automationCreate(input));
      }}
      onUpdateAutomation={(id, patch) => {
        void updateSnapshot(api, setSnapshot, () => api.automationUpdate(id, patch));
      }}
      onDeleteAutomation={(id) => {
        void updateSnapshot(api, setSnapshot, () => api.automationDelete(id));
      }}
      onFireNow={(id) => {
        const automation = (snapshot.automations ?? []).find((a) => a.id === id);
        if (automation) {
          onFireNow(id, automation.name, automation.workspaceId, automation.prompt);
        }
      }}
      onClearFilter={() => {
        void updateSnapshot(api, setSnapshot, async () => {
          const state = await api.getState();
          return { ...state, automationFilterWorkspaceId: undefined };
        });
      }}
      onSelectSession={(workspaceId, sessionId) => {
        void updateSnapshot(api, setSnapshot, () => api.selectSession({ workspaceId, sessionId }));
      }}
    />
  );
}

// ── Context surface ────────────────────────────────────────────────────────────

export interface ContextSurfaceProps {
  readonly contextWorkspace: WorkspaceRecord | undefined;
  readonly contextRuntime: RuntimeSnapshot | undefined;
  readonly contextSnapshot: ContextSnapshot | null;
  readonly contextLoading: boolean;
  readonly loadContextSnapshot: () => void;
  readonly api: PiDesktopApi;
}

export function ContextSurface(props: ContextSurfaceProps) {
  const { contextWorkspace, contextRuntime, contextSnapshot, contextLoading, loadContextSnapshot, api } = props;

  return (
    <ContextView
      workspace={contextWorkspace}
      runtime={contextRuntime}
      snapshot={contextSnapshot}
      loading={contextLoading}
      onRefresh={loadContextSnapshot}
      api={api}
    />
  );
}

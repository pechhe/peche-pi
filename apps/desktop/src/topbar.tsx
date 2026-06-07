import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import type { AppView, SessionRecord, WorkspaceRecord, WorktreeRecord } from "./desktop-state";
import { AdvisorIcon, ContextIcon, DiffIcon, ExternalTerminalIcon, FolderIcon, SettingsIcon, TerminalIcon } from "./icons";
import { playButtonClick } from "./button-click-sound";
import { getDesktopShortcutLabel, type GraphifyProjectMapStatus, type GraphifyHealthCheckResult, type GraphifyHookStatus, type GraphifyWatchStatus, type PiDesktopApi } from "./ipc";
import type { WorkspaceMenuState } from "./hooks/use-workspace-menu";
import { CommitPushButton } from "./commit-push-button";
import type { RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";

interface TopbarProps {
  readonly activeView: AppView;
  readonly rootWorkspace: WorkspaceRecord | undefined;
  readonly selectedWorkspace: WorkspaceRecord | undefined;
  readonly selectedSession: SessionRecord | undefined;
  readonly selectedSessionTitle: string | undefined;
  readonly selectedWorktree: WorktreeRecord | undefined;
  readonly activeWorktrees: readonly WorktreeRecord[];
  readonly workspaces: readonly WorkspaceRecord[];
  readonly wsMenu: WorkspaceMenuState;
  readonly api: PiDesktopApi;
  readonly terminalAvailable: boolean;
  readonly terminalVisible: boolean;
  readonly onToggleTerminal: () => void;
  readonly externalTerminalAvailable: boolean;
  readonly onOpenExternalTerminal: () => void;
  readonly showDiffPanel: boolean;
  readonly onToggleDiffPanel: () => void;
  readonly showAdvisorPanel?: boolean;
  readonly onToggleAdvisorPanel?: () => void;
  readonly selectedRuntime?: RuntimeSnapshot;
  readonly commitPushModel?: string;
  readonly transcriptVerbose: boolean;
  readonly onSetTranscriptVerbose: (enabled: boolean) => void;
}

export function Topbar(props: TopbarProps) {
  const {
    activeView,
    rootWorkspace,
    selectedWorkspace,
    selectedSession,
    selectedSessionTitle,
    selectedWorktree,
    activeWorktrees,
    workspaces,
    wsMenu,
    api,

    terminalAvailable,
    terminalVisible,
    onToggleTerminal,
    externalTerminalAvailable,
    onOpenExternalTerminal,
    showDiffPanel,
    onToggleDiffPanel,
    showAdvisorPanel,
    onToggleAdvisorPanel,
    selectedRuntime,
    commitPushModel,
    transcriptVerbose,
    onSetTranscriptVerbose,
  } = props;
  const terminalShortcut = getDesktopShortcutLabel(api.platform, "J");
  const diffShortcut = getDesktopShortcutLabel(api.platform, "D");
  const commitShortcut = api.platform === "darwin" ? "⌘⇧K" : "Ctrl+Shift+K";
  const [viewSettingsOpen, setViewSettingsOpen] = useState(false);
  const [projectMapOpen, setProjectMapOpen] = useState(false);
  const [projectMapStatus, setProjectMapStatus] = useState<GraphifyProjectMapStatus | null>(null);
  const [projectMapLoading, setProjectMapLoading] = useState(false);
  const [projectMapRunning, setProjectMapRunning] = useState<"build" | "update" | null>(null);
  const [projectMapMessage, setProjectMapMessage] = useState("");
  const [healthCheck, setHealthCheck] = useState<GraphifyHealthCheckResult | null>(null);
  const [hookStatus, setHookStatus] = useState<GraphifyHookStatus | null>(null);
  const [watchStatus, setWatchStatus] = useState<GraphifyWatchStatus | null>(null);
  const viewSettingsRef = useRef<HTMLDivElement | null>(null);
  const projectMapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!viewSettingsOpen && !projectMapOpen) {
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
      if (viewSettingsRef.current?.contains(event.target as Node) || projectMapRef.current?.contains(event.target as Node)) {
        return;
      }
      setViewSettingsOpen(false);
      setProjectMapOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [viewSettingsOpen, projectMapOpen]);

  const loadProjectMapStatus = async () => {
    if (!rootWorkspace) return;
    setProjectMapLoading(true);
    setProjectMapMessage("");
    try {
      const [status, health, hooks, watch] = await Promise.all([
        api.getGraphifyProjectMapStatus(rootWorkspace.id),
        api.getGraphifyHealthCheck(rootWorkspace.id),
        api.getGraphifyHookStatus(rootWorkspace.id),
        api.getGraphifyWatchStatus(rootWorkspace.id),
      ]);
      setProjectMapStatus(status);
      setHealthCheck(health);
      setHookStatus(hooks);
      setWatchStatus(watch);
    } catch (error) {
      setProjectMapMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setProjectMapLoading(false);
    }
  };

  const toggleProjectMap = () => {
    setProjectMapOpen((current) => {
      const next = !current;
      if (next) void loadProjectMapStatus();
      return next;
    });
  };

  const runProjectMapAction = async (action: "build" | "update") => {
    if (!rootWorkspace) return;
    setProjectMapRunning(action);
    setProjectMapMessage("");
    try {
      const result = action === "build"
        ? await api.buildGraphifyProjectMap(rootWorkspace.id)
        : await api.updateGraphifyProjectMap(rootWorkspace.id);
      setProjectMapStatus(result.status ?? null);
      setProjectMapMessage(result.message);
    } catch (error) {
      setProjectMapMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setProjectMapRunning(null);
    }
  };

  const openGraphHtml = () => {
    if (projectMapStatus?.htmlPath) {
      void api.openExternal(`file://${projectMapStatus.htmlPath}`);
    }
  };

  const seedGraphPrompt = (prompt: string) => {
    void navigator.clipboard.writeText(prompt);
    setProjectMapMessage("Copied graph-aware prompt to clipboard.");
  };

  const toggleHook = async (enable: boolean) => {
    if (!rootWorkspace) return;
    const result = await api.setGraphifyHook(rootWorkspace.id, enable);
    setProjectMapMessage(result.message);
    if (result.success) {
      const hooks = await api.getGraphifyHookStatus(rootWorkspace.id);
      setHookStatus(hooks);
    }
  };

  const toggleWatch = async (enable: boolean) => {
    if (!rootWorkspace) return;
    const result = await api.setGraphifyWatch(rootWorkspace.id, enable);
    setProjectMapMessage(result.message);
    if (result.success) {
      const watch = await api.getGraphifyWatchStatus(rootWorkspace.id);
      setWatchStatus(watch);
    }
  };

  const handleDoubleClick = (event: ReactMouseEvent<HTMLElement>) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    if (target.closest(".topbar__actions")) {
      return;
    }

    void api.toggleWindowMaximize();
  };

  return (
    <header className="topbar" data-testid="topbar" onDoubleClick={handleDoubleClick}>
      <div className="topbar__title">
        <span className="topbar__workspace">
          {rootWorkspace ? rootWorkspace.name : "Open a folder to begin"}
        </span>
        {selectedWorkspace && activeView === "threads" && selectedWorkspace.kind === "worktree" ? (
          <>
            <span className="topbar__separator">/</span>
            <div className="environment-picker" ref={wsMenu.environmentMenuRef}>
              <button
                aria-expanded={wsMenu.environmentMenuOpen}
                aria-haspopup="menu"
                className="environment-picker__button"
                type="button"
                onClick={() => wsMenu.setEnvironmentMenuOpen((current) => !current)}
              >
                {selectedWorktree?.name ?? selectedWorkspace.name}
              </button>
              {wsMenu.environmentMenuOpen && rootWorkspace ? (
                <div className="workspace-menu environment-picker__menu">
                  <button
                    className="workspace-menu__item"
                    type="button"
                    onClick={() => wsMenu.selectWorkspace(rootWorkspace.id)}
                  >
                    Local
                  </button>
                  {activeWorktrees.map((worktree) => {
                    const linkedWorkspace = workspaces.find(
                      (workspace) => workspace.id === worktree.linkedWorkspaceId,
                    );
                    const worktreeSelectable = Boolean(linkedWorkspace) && worktree.status === "ready";
                    return (
                      <button
                        className="workspace-menu__item"
                        key={worktree.id}
                        type="button"
                        disabled={!worktreeSelectable}
                        onClick={() => {
                          if (worktreeSelectable && linkedWorkspace) {
                            wsMenu.selectWorkspace(linkedWorkspace.id);
                          }
                        }}
                      >
                        {worktree.name}
                        {!worktreeSelectable ? ` (${worktree.status !== "ready" ? worktree.status : "unavailable"})` : ""}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          </>
        ) : null}
        {selectedWorkspace && activeView === "threads" && selectedSession ? (
          <>
            <span className="topbar__separator">/</span>
            <span className="topbar__session">{selectedSessionTitle ?? selectedSession.title}</span>
          </>
        ) : activeView === "new-thread" && rootWorkspace ? (
          <>
            <span className="topbar__separator">/</span>
            <span className="topbar__session">New project</span>
          </>
        ) : null}
      </div>

      <div className="topbar__actions">
        <CommitPushButton
          workspaceId={rootWorkspace?.id ?? ""}
          runtime={selectedRuntime}
          commitPushModel={commitPushModel}
          api={api}
          sessionStatus={selectedSession?.status}
          shortcutLabel={commitShortcut}
        />
        <div className="project-map-popover" ref={projectMapRef}>
          <div className="shortcut-tooltip-wrap topbar__tooltip-wrap">
            <button
              aria-label="Project map"
              className={`icon-button topbar__icon ${projectMapOpen ? "icon-button--active" : ""} ${projectMapStatus?.stale || (healthCheck && !healthCheck.healthy) ? "topbar__icon--warning" : ""} ${watchStatus?.running ? "topbar__icon--watching" : ""}`}
              type="button"
              disabled={!rootWorkspace}
              onClick={() => { playButtonClick(); toggleProjectMap(); }}
            >
              <ContextIcon />
              {watchStatus?.running ? <span className="topbar__watch-dot" title="File watcher running" /> : null}
            </button>
            <span className="shortcut-tooltip topbar__tooltip" role="tooltip">
              <span>Project map</span>
            </span>
          </div>
          {projectMapOpen ? (
            <div className="project-map-popover__menu" role="menu">
              <div className="project-map-popover__header">
                <strong>Project map</strong>
                <span className={`project-map-popover__status ${projectMapStatus?.stale ? "project-map-popover__status--stale" : projectMapStatus?.available ? "project-map-popover__status--fresh" : ""}`}>
                  {projectMapLoading ? "Loading" : projectMapStatus?.available ? projectMapStatus.stale ? "Stale" : "Fresh" : "Missing"}
                </span>
              </div>
              <div className="project-map-popover__stats">
                <span>{projectMapStatus?.nodeCount ?? "—"}<small>nodes</small></span>
                <span>{projectMapStatus?.edgeCount ?? "—"}<small>edges</small></span>
                <span>{projectMapStatus?.communityCount ?? "—"}<small>communities</small></span>
              </div>
              {projectMapStatus?.builtCommit ? (
                <p className="project-map-popover__note">Built {projectMapStatus.builtCommit.slice(0, 8)}{projectMapStatus.currentCommit ? ` · Current ${projectMapStatus.currentCommit.slice(0, 8)}` : ""}</p>
              ) : null}
              {projectMapStatus?.stale ? <p className="project-map-popover__note project-map-popover__note--warning">Map is behind current commit. Update before using as source of truth.</p> : null}
              {healthCheck && !healthCheck.healthy ? (
                <div className="project-map-popover__health">
                  <span className="project-map-popover__health-title">Issues detected</span>
                  {healthCheck.issues.map((issue) => (
                    <p key={issue.code} className={`project-map-popover__issue project-map-popover__issue--${issue.severity}`}>
                      {issue.message}
                      {issue.fixHint ? <small>{issue.fixHint}</small> : null}
                    </p>
                  ))}
                  <button
                    type="button"
                    className="project-map-popover__debug-btn"
                    onClick={() => {
                      playButtonClick();
                      if (healthCheck.debugPrompt) {
                        void navigator.clipboard.writeText(healthCheck.debugPrompt);
                        setProjectMapMessage("Debug prompt copied. Paste into a new thread to diagnose.");
                      }
                    }}
                  >
                    Copy debug prompt
                  </button>
                </div>
              ) : null}
              <div className="project-map-popover__actions">
                <button type="button" onClick={() => { playButtonClick(); void loadProjectMapStatus(); }} disabled={projectMapLoading || Boolean(projectMapRunning)}>Refresh status</button>
                <button type="button" onClick={() => { playButtonClick(); void runProjectMapAction(projectMapStatus?.available ? "update" : "build"); }} disabled={Boolean(projectMapRunning)}>{projectMapRunning ? "Running…" : projectMapStatus?.available ? "Update map" : "Build map"}</button>
                <button type="button" onClick={() => { playButtonClick(); void runProjectMapAction("build"); }} disabled={Boolean(projectMapRunning)}>Rebuild</button>
                <button type="button" onClick={() => { playButtonClick(); openGraphHtml(); }} disabled={!projectMapStatus?.htmlPath}>Open visual graph</button>
                <button type="button" onClick={() => { playButtonClick(); seedGraphPrompt("Use Graphify to summarize this project's architecture, main communities, and likely ownership boundaries."); }}>Copy architecture prompt</button>
              </div>
              {projectMapStatus?.available ? (
                <div className="project-map-popover__auto">
                  <label className="project-map-popover__auto-item">
                    <span>
                      <strong>Auto-refresh hook</strong>
                      <small>Rebuild graph on git commit.</small>
                    </span>
                    <input
                      type="checkbox"
                      checked={hookStatus?.postCommit ?? false}
                      onChange={(e) => { playButtonClick(); void toggleHook(e.currentTarget.checked); }}
                    />
                  </label>
                  <label className="project-map-popover__auto-item">
                    <span>
                      <strong>File watcher</strong>
                      <small>{watchStatus?.running ? `Running (PID ${watchStatus.pid})` : "Auto-rebuild on code changes."}</small>
                    </span>
                    <input
                      type="checkbox"
                      checked={watchStatus?.running ?? false}
                      onChange={(e) => { playButtonClick(); void toggleWatch(e.currentTarget.checked); }}
                    />
                  </label>
                </div>
              ) : null}
              {projectMapStatus?.communities.length ? (
                <div className="project-map-popover__communities">
                  <span>Top communities</span>
                  {projectMapStatus.communities.slice(0, 5).map((community) => <button key={community.name} type="button" onClick={() => seedGraphPrompt(`Use Graphify to explain the ${community.name} community in this workspace.`)}>{community.name}</button>)}
                </div>
              ) : null}
              {projectMapMessage ? <pre className="project-map-popover__message">{projectMapMessage}</pre> : null}
            </div>
          ) : null}
        </div>
        <div className="view-settings" ref={viewSettingsRef}>
          <button
            aria-label="View settings"
            aria-expanded={viewSettingsOpen}
            aria-haspopup="menu"
            className={`icon-button topbar__icon ${viewSettingsOpen ? "icon-button--active" : ""}`}
            type="button"
            onClick={() => { playButtonClick(); setViewSettingsOpen((current) => !current); }}
          >
            <SettingsIcon />
          </button>
          {viewSettingsOpen ? (
            <div className="view-settings__menu" role="menu">
              <label className="view-settings__item">
                <span>
                  <strong>Verbose transcript</strong>
                  <small>Show blackhole + cymbal chatter.</small>
                </span>
                <input
                  aria-label="Verbose transcript"
                  type="checkbox"
                  checked={transcriptVerbose}
                  onChange={(event) => onSetTranscriptVerbose(event.currentTarget.checked)}
                />
              </label>
            </div>
          ) : null}
        </div>
        <div className="shortcut-tooltip-wrap topbar__tooltip-wrap">
          <button
            aria-label="Toggle terminal"
            className={`icon-button topbar__icon ${terminalVisible ? "icon-button--active" : ""}`}
            type="button"
            disabled={!terminalAvailable}
            onClick={() => { playButtonClick(); onToggleTerminal(); }}
          >
            <TerminalIcon />
          </button>
          <span className="shortcut-tooltip topbar__tooltip" role="tooltip">
            <span>Toggle terminal</span>
            <kbd>{terminalShortcut}</kbd>
          </span>
        </div>
        <div className="shortcut-tooltip-wrap topbar__tooltip-wrap">
          <button
            aria-label="Open in external terminal"
            className="icon-button topbar__icon"
            type="button"
            disabled={!externalTerminalAvailable}
            onClick={() => { playButtonClick(); onOpenExternalTerminal(); }}
          >
            <ExternalTerminalIcon />
          </button>
          <span className="shortcut-tooltip topbar__tooltip" role="tooltip">
            <span>Open in external terminal</span>
          </span>
        </div>
        <div className="shortcut-tooltip-wrap topbar__tooltip-wrap">
          <button
            aria-label="Toggle changes"
            className={`icon-button topbar__icon ${showDiffPanel ? "icon-button--active" : ""}`}
            type="button"
            onClick={() => { playButtonClick(); onToggleDiffPanel(); }}
          >
            <DiffIcon />
          </button>
          <span className="shortcut-tooltip topbar__tooltip" role="tooltip">
            <span>Toggle changes</span>
            <kbd>{diffShortcut}</kbd>
          </span>
        </div>
        {onToggleAdvisorPanel ? (
          <div className="shortcut-tooltip-wrap topbar__tooltip-wrap">
            <button
              aria-label="Toggle advisor"
              className={`icon-button topbar__icon ${showAdvisorPanel ? "icon-button--active" : ""}`}
              type="button"
              onClick={() => { playButtonClick(); onToggleAdvisorPanel(); }}
            >
              <AdvisorIcon />
            </button>
            <span className="shortcut-tooltip topbar__tooltip" role="tooltip">
              <span>Toggle advisor</span>
              <kbd>{api.platform === "darwin" ? "⌘⇧A" : "Ctrl+Shift+A"}</kbd>
            </span>
          </div>
        ) : null}
        {rootWorkspace ? (
          <div className="shortcut-tooltip-wrap topbar__tooltip-wrap">
            <button
              aria-label="Open project in Finder"
              className="icon-button topbar__icon"
              type="button"
              onClick={() => { playButtonClick(); void api.openWorkspaceInFinder(rootWorkspace.id); }}
            >
              <FolderIcon />
            </button>
            <span className="shortcut-tooltip topbar__tooltip" role="tooltip">
              <span>Open in Finder</span>
            </span>
          </div>
        ) : null}
      </div>
    </header>
  );
}

import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import type { AppView, SessionRecord, WorkspaceRecord, WorktreeRecord } from "./desktop-state";
import { AdvisorIcon, DiffIcon, ExternalTerminalIcon, FolderIcon, SettingsIcon, TerminalIcon } from "./icons";
import { playButtonClick } from "./button-click-sound";
import { getDesktopShortcutLabel, type PiDesktopApi } from "./ipc";
import { ProjectMapPopover } from "./project-map-popover";
import type { WorkspaceMenuState } from "./hooks/use-workspace-menu";
import { CommitPushButton } from "./commit-push-button";
import { UpdatePill } from "./update-pill";
import type { RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import { showToast } from "./toast";
import type { UndoEditsResult } from "./ipc";

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
  readonly onOpenGraph?: () => void;
  readonly onUndoAllEdits?: () => Promise<UndoEditsResult>;
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
    onUndoAllEdits,
  } = props;
  const [undoAllState, setUndoAllState] = useState<"idle" | "undoing" | "done" | "error">("idle");
  const terminalShortcut = getDesktopShortcutLabel(api.platform, "J");
  const diffShortcut = getDesktopShortcutLabel(api.platform, "D");
  const commitShortcut = api.platform === "darwin" ? "⌘⇧K" : "Ctrl+Shift+K";
  const [viewSettingsOpen, setViewSettingsOpen] = useState(false);
  const viewSettingsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!viewSettingsOpen) {
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
      if (viewSettingsRef.current?.contains(event.target as Node)) {
        return;
      }
      setViewSettingsOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [viewSettingsOpen]);

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
            <span
              className="topbar__session topbar__session--clickable"
              title="Click to copy session ID"
              onClick={() => {
                void navigator.clipboard.writeText(selectedSession.id);
                showToast({ variant: "success", message: "Session ID copied", autoDismissMs: 2000 });
              }}
            >{selectedSessionTitle ?? selectedSession.title}</span>
          </>
        ) : activeView === "new-thread" && rootWorkspace ? (
          <>
            <span className="topbar__separator">/</span>
            <span className="topbar__session">New project</span>
          </>
        ) : null}
      </div>

      <div className="topbar__actions">
        <UpdatePill api={api} />
        <CommitPushButton
          workspaceId={rootWorkspace?.id ?? ""}
          runtime={selectedRuntime}
          commitPushModel={commitPushModel}
          api={api}
          sessionStatus={selectedSession?.status}
          shortcutLabel={commitShortcut}
        />
        {onUndoAllEdits && activeView === "threads" && selectedSession && selectedSession.status !== "running" ? (
          <div className="shortcut-tooltip-wrap topbar__tooltip-wrap">
            <button
              aria-label="Revert all changes in this thread"
              className="topbar__revert-all"
              data-testid="topbar-revert-all"
              type="button"
              disabled={undoAllState === "undoing"}
              onClick={() => {
                playButtonClick();
                setUndoAllState("undoing");
                void onUndoAllEdits().then(
                  (result) => {
                    if (result.reverted.length === 0) {
                      setUndoAllState("error");
                      showToast({ variant: "success", message: "Nothing to revert", autoDismissMs: 2000 });
                    } else {
                      setUndoAllState("done");
                      showToast({ variant: "success", message: `Reverted ${result.reverted.length} file${result.reverted.length === 1 ? "" : "s"}`, autoDismissMs: 3000 });
                    }
                  },
                  () => setUndoAllState("error"),
                );
              }}
            >
              {undoAllState === "undoing" ? "Reverting…" : "Revert All"}
            </button>
            <span className="shortcut-tooltip topbar__tooltip" role="tooltip">
              <span>Revert all thread changes</span>
            </span>
          </div>
        ) : null}
        <ProjectMapPopover rootWorkspace={rootWorkspace} api={api} onOpenGraph={props.onOpenGraph} />
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

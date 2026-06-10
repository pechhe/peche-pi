import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import type { AppView, SessionRecord, WorkspaceRecord } from "./desktop-state";
import { AdvisorIcon, ContextIcon, DiffIcon, EnvironmentIcon, ExternalTerminalIcon, FolderIcon, SettingsIcon, TerminalIcon } from "./icons";
import { playButtonClick } from "./button-click-sound";
import { getDesktopShortcutLabel, type PiDesktopApi } from "./ipc";
import { ProjectMapPopover } from "./project-map-popover";


import { UpdatePill } from "./update-pill";

import { showToast } from "./toast";

interface TopbarProps {
  readonly activeView: AppView;
  readonly rootWorkspace: WorkspaceRecord | undefined;
  readonly selectedWorkspace: WorkspaceRecord | undefined;
  readonly selectedSession: SessionRecord | undefined;
  readonly selectedSessionTitle: string | undefined;
  readonly api: PiDesktopApi;
  readonly terminalAvailable: boolean;
  readonly terminalVisible: boolean;
  readonly onToggleTerminal: () => void;
  readonly externalTerminalAvailable: boolean;
  readonly onOpenExternalTerminal: () => void;
  readonly showDiffPanel: boolean;
  readonly onToggleDiffPanel: () => void;
  readonly showContextPanel?: boolean;
  readonly onToggleContextPanel?: () => void;
  readonly showAdvisorPanel?: boolean;
  readonly onToggleAdvisorPanel?: () => void;
  readonly transcriptVerbose: boolean;
  readonly onSetTranscriptVerbose: (enabled: boolean) => void;
  readonly onOpenGraph?: () => void;
  readonly environmentPanelOpen: boolean;
  readonly onToggleEnvironmentPanel: () => void;
}

export function Topbar(props: TopbarProps) {
  const {
    activeView,
    rootWorkspace,
    selectedWorkspace,
    selectedSession,
    selectedSessionTitle,
    api,

    terminalAvailable,
    terminalVisible,
    onToggleTerminal,
    externalTerminalAvailable,
    onOpenExternalTerminal,
    showDiffPanel,
    onToggleDiffPanel,
    showContextPanel,
    onToggleContextPanel,
    showAdvisorPanel,
    onToggleAdvisorPanel,
    transcriptVerbose,
    onSetTranscriptVerbose,
    environmentPanelOpen,
    onToggleEnvironmentPanel,
  } = props;
  const terminalShortcut = getDesktopShortcutLabel(api.platform, "J");
  const diffShortcut = getDesktopShortcutLabel(api.platform, "D");
  const contextShortcut = getDesktopShortcutLabel(api.platform, "⇧5");
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

        {selectedWorkspace && activeView === "threads" && selectedSession ? (
          <>
            <span className="topbar__separator">/</span>
            <span
              className="topbar__session topbar__session--clickable"
              title="Click to copy session path"
              onClick={() => {
                const text = selectedSession.sessionFilePath ?? selectedSession.id;
                void navigator.clipboard.writeText(text);
                showToast({ variant: "success", message: selectedSession.sessionFilePath ? "Session path copied" : "Session ID copied", autoDismissMs: 2000 });
              }}
            >{selectedSessionTitle ?? selectedSession.title}</span>
          </>
        ) : activeView === "new-thread" && rootWorkspace ? (
          <>
            <span className="topbar__separator">/</span>
            <span className="topbar__session">New project</span>
          </>
        ) : null}

        {onToggleEnvironmentPanel ? (
          <button
            aria-label="Toggle environment panel"
            className={`icon-button topbar__icon topbar__env-toggle ${environmentPanelOpen ? "icon-button--active" : ""}`}
            type="button"
            onClick={() => { playButtonClick(); onToggleEnvironmentPanel(); }}
          >
            <EnvironmentIcon />
          </button>
        ) : null}
      </div>

      <div className="topbar__actions">
        <UpdatePill api={api} />
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
        {onToggleContextPanel ? (
          <div className="shortcut-tooltip-wrap topbar__tooltip-wrap">
            <button
              aria-label="Toggle context"
              className={`icon-button topbar__icon ${showContextPanel ? "icon-button--active" : ""}`}
              type="button"
              onClick={() => { playButtonClick(); onToggleContextPanel(); }}
            >
              <ContextIcon />
            </button>
            <span className="shortcut-tooltip topbar__tooltip" role="tooltip">
              <span>Toggle context</span>
              <kbd>{contextShortcut}</kbd>
            </span>
          </div>
        ) : null}
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

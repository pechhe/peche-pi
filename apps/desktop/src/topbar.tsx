import { useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { FolderOpen, SquareArrowOutUpRight, Terminal } from "lucide-react";
import type { AppView, SessionRecord, WorkspaceRecord } from "./desktop-state";
import { AdvisorIcon, ContextIcon, DiffIcon, EnvironmentIcon, SettingsIcon } from "./icons";
import { playButtonClick } from "./button-click-sound";
import { getDesktopShortcutLabel, type PiDesktopApi } from "./ipc";
import { ProjectMapPopover } from "./project-map-popover";
import { UpdatePill } from "./update-pill";
import { showToast } from "./toast";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

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

function TopbarIconButton({
  label,
  shortcut,
  active = false,
  disabled = false,
  onClick,
  children,
}: {
  readonly label: string;
  readonly shortcut?: string;
  readonly active?: boolean;
  readonly disabled?: boolean;
  readonly onClick: () => void;
  readonly children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label={label}
          variant="ghost"
          size="icon"
          disabled={disabled}
          className={cn(
            "size-7 rounded-md text-muted-foreground transition-all duration-150 hover:text-foreground active:scale-95",
            active && "bg-accent text-foreground",
          )}
          onClick={() => {
            playButtonClick();
            onClick();
          }}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent
        aria-label={label}
        className="topbar__tooltip flex items-center gap-1.5"
        sideOffset={6}
      >
        <span>{label}</span>
        {shortcut ? (
          <kbd className="rounded border border-border bg-muted px-1 font-sans text-[10px] text-muted-foreground">
            {shortcut}
          </kbd>
        ) : null}
      </TooltipContent>
    </Tooltip>
  );
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
    <TooltipProvider delayDuration={350} skipDelayDuration={200}>
      <header
        className="topbar flex items-center justify-between gap-3 border-b border-border/60 bg-background px-[18px] pb-2.5 pt-3"
        data-testid="topbar"
        onDoubleClick={handleDoubleClick}
      >
        <div className="topbar__title flex min-w-0 items-center gap-1.5 text-[13px]">
          <span className="topbar__workspace shrink-0 font-semibold text-card-foreground">
            {rootWorkspace ? rootWorkspace.name : "Open a folder to begin"}
          </span>

          {selectedWorkspace && activeView === "threads" && selectedSession ? (
            <>
              <span className="topbar__separator text-muted-foreground/60">/</span>
              <span
                className="topbar__session topbar__session--clickable cursor-pointer truncate text-muted-foreground transition-colors duration-150 hover:text-foreground"
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
              <span className="topbar__separator text-muted-foreground/60">/</span>
              <span className="topbar__session truncate text-muted-foreground">New project</span>
            </>
          ) : null}

          {onToggleEnvironmentPanel ? (
            <Button
              aria-label="Toggle environment panel"
              variant="ghost"
              size="icon"
              className={cn(
                "topbar__env-toggle ml-1 size-7 rounded-md text-muted-foreground transition-all duration-150 hover:text-foreground active:scale-95",
                environmentPanelOpen && "bg-accent text-foreground",
              )}
              onClick={() => {
                playButtonClick();
                onToggleEnvironmentPanel();
              }}
            >
              <EnvironmentIcon />
            </Button>
          ) : null}
        </div>

        <div className="topbar__actions flex items-center gap-1">
          <UpdatePill api={api} />
          <ProjectMapPopover rootWorkspace={rootWorkspace} api={api} onOpenGraph={props.onOpenGraph} />
          <DropdownMenu open={viewSettingsOpen} onOpenChange={setViewSettingsOpen}>
            <DropdownMenuTrigger asChild>
              <Button
                aria-label="View settings"
                variant="ghost"
                size="icon"
                className={cn(
                  "size-7 rounded-md text-muted-foreground transition-all duration-150 hover:text-foreground active:scale-95",
                  viewSettingsOpen && "bg-accent text-foreground",
                )}
                onClick={() => playButtonClick()}
              >
                <SettingsIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" sideOffset={6} className="w-64">
              <label className="flex cursor-pointer items-start justify-between gap-3 rounded-sm px-2 py-1.5 transition-colors hover:bg-accent">
                <span className="flex flex-col gap-0.5">
                  <strong className="text-[13px] font-semibold text-popover-foreground">Verbose transcript</strong>
                  <small className="text-xs text-muted-foreground">Show blackhole + cymbal chatter.</small>
                </span>
                <Switch
                  aria-label="Verbose transcript"
                  checked={transcriptVerbose}
                  onCheckedChange={(checked) => onSetTranscriptVerbose(checked)}
                  className="mt-0.5"
                />
              </label>
            </DropdownMenuContent>
          </DropdownMenu>
          <TopbarIconButton
            label="Toggle terminal"
            shortcut={terminalShortcut}
            active={terminalVisible}
            disabled={!terminalAvailable}
            onClick={onToggleTerminal}
          >
            <Terminal className="size-4" />
          </TopbarIconButton>
          <TopbarIconButton
            label="Open in external terminal"
            disabled={!externalTerminalAvailable}
            onClick={onOpenExternalTerminal}
          >
            <SquareArrowOutUpRight className="size-4" />
          </TopbarIconButton>
          <TopbarIconButton
            label="Toggle changes"
            shortcut={diffShortcut}
            active={showDiffPanel}
            onClick={onToggleDiffPanel}
          >
            <DiffIcon />
          </TopbarIconButton>
          {onToggleContextPanel ? (
            <TopbarIconButton
              label="Toggle context"
              shortcut={contextShortcut}
              active={showContextPanel}
              onClick={onToggleContextPanel}
            >
              <ContextIcon />
            </TopbarIconButton>
          ) : null}
          {onToggleAdvisorPanel ? (
            <TopbarIconButton
              label="Toggle advisor"
              shortcut={api.platform === "darwin" ? "⌘⇧A" : "Ctrl+Shift+A"}
              active={showAdvisorPanel}
              onClick={onToggleAdvisorPanel}
            >
              <AdvisorIcon />
            </TopbarIconButton>
          ) : null}
          {rootWorkspace ? (
            <TopbarIconButton
              label="Open in Finder"
              onClick={() => void api.openWorkspaceInFinder(rootWorkspace.id)}
            >
              <FolderOpen className="size-4" />
            </TopbarIconButton>
          ) : null}
        </div>
      </header>
    </TooltipProvider>
  );
}

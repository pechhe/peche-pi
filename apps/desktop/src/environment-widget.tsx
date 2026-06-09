import { useEffect, useRef, useState } from "react";
import type { WorkspaceRecord, WorktreeRecord } from "./desktop-state";
import type { WorkspaceMenuState } from "./hooks/use-workspace-menu";
import type { PiDesktopApi } from "./ipc";
import { playButtonClick } from "./button-click-sound";
import { DiffIcon } from "./icons";
import { CommitPushButton } from "./commit-push-button";
import type { RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";

interface EnvironmentWidgetProps {
  readonly selectedWorkspace: WorkspaceRecord | undefined;
  readonly selectedWorktree: WorktreeRecord | undefined;
  readonly rootWorkspace: WorkspaceRecord | undefined;
  readonly activeWorktrees: readonly WorktreeRecord[];
  readonly wsMenu: WorkspaceMenuState;
  readonly showDiffPanel: boolean;
  readonly onToggleDiffPanel: () => void;
  readonly onFeatureDone?: () => void;
  readonly featureDoneState?: "idle" | "working" | "done" | "error";
  readonly commitPushModel?: string;
  readonly selectedRuntime?: RuntimeSnapshot;
  readonly api: PiDesktopApi;
  readonly sessionStatus?: string;
}

export function EnvironmentWidget(props: EnvironmentWidgetProps) {
  const {
    selectedWorkspace,
    selectedWorktree,
    rootWorkspace,
    activeWorktrees,
    wsMenu,
    showDiffPanel,
    onToggleDiffPanel,
    onFeatureDone,
    featureDoneState,
    commitPushModel,
    selectedRuntime,
    api,
    sessionStatus,
  } = props;

  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (containerRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  if (!selectedWorkspace) return null;

  const isWorktree = selectedWorkspace.kind === "worktree";
  const location = isWorktree ? "worktree" : "local";
  const branchName = isWorktree ? selectedWorktree?.branchName : selectedWorkspace.branchName;
  const isDetached = isWorktree && !branchName;
  const baseBranch = rootWorkspace?.branchName;
  const displayBranch = branchName ?? baseBranch ?? "main";

  const locationLabel = isWorktree ? "⊞ Worktree" : "💻 Local";
  const branchLabel = isDetached
    ? `${displayBranch} (detached)`
    : displayBranch;

  const commitShortcut = api.platform === "darwin" ? "⌘⇧K" : "Ctrl+Shift+K";

  return (
    <div className="environment-widget" data-testid="environment-widget" ref={containerRef}>
      <button
        className="environment-widget__readout"
        data-testid="environment-widget-readout"
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => { playButtonClick(); setOpen((prev) => !prev); }}
      >
        <span className="environment-widget__location">{locationLabel}</span>
        <span className="environment-widget__dot">·</span>
        <span className="environment-widget__branch" data-testid="environment-widget-branch">
          ⎇ {branchLabel}
        </span>
        <button
          className="environment-widget__changes-btn"
          data-testid="environment-widget-changes"
          type="button"
          aria-label="Toggle changes"
          onClick={(event) => {
            event.stopPropagation();
            playButtonClick();
            onToggleDiffPanel();
          }}
        >
          <DiffIcon />
        </button>
      </button>

      {open ? (
        <div className="workspace-menu environment-widget__popover" role="menu" data-testid="environment-widget-popover">
          <button
            className="workspace-menu__item"
            data-testid="env-row-changes"
            type="button"
            role="menuitem"
            onClick={() => {
              playButtonClick();
              if (!showDiffPanel) onToggleDiffPanel();
              setOpen(false);
            }}
          >
            Changes
          </button>

          <div className="environment-widget__location-row" data-testid="env-row-location">
            <span className="environment-widget__row-label">Location</span>
            <div className="environment-widget__location-picker">
              <button
                className={`environment-widget__loc-btn${location === "local" ? " environment-widget__loc-btn--active" : ""}`}
                type="button"
                disabled={!rootWorkspace}
                onClick={() => {
                  if (rootWorkspace) {
                    playButtonClick();
                    wsMenu.selectWorkspace(rootWorkspace.id);
                    setOpen(false);
                  }
                }}
              >
                Local
              </button>
              <button
                className={`environment-widget__loc-btn${location === "worktree" ? " environment-widget__loc-btn--active" : ""}`}
                type="button"
                disabled={activeWorktrees.length === 0}
                onClick={() => {
                  if (activeWorktrees.length > 0) {
                    playButtonClick();
                    // Select the first available worktree workspace
                    const firstWorktree = activeWorktrees[0];
                    if (firstWorktree?.linkedWorkspaceId) {
                      wsMenu.selectWorkspace(firstWorktree.linkedWorkspaceId);
                    }
                    setOpen(false);
                  }
                }}
              >
                Worktree
              </button>
            </div>
          </div>

          <div className="environment-widget__branch-row" data-testid="env-row-branch">
            <span className="environment-widget__row-label">Branch</span>
            <span className="environment-widget__row-value">
              {isDetached ? (
                <>
                  <span className="environment-widget__detached-badge">no branch yet</span>
                  <span className="environment-widget__base-branch">base: {displayBranch}</span>
                </>
              ) : (
                displayBranch
              )}
            </span>
          </div>

          <div className="environment-widget__commit-row" data-testid="env-row-commit-push">
            <CommitPushButton
              workspaceId={rootWorkspace?.id ?? ""}
              runtime={selectedRuntime}
              commitPushModel={commitPushModel}
              api={api}
              sessionStatus={sessionStatus}
              shortcutLabel={commitShortcut}
              branchHint={selectedWorktree?.name}
            />
          </div>

          {onFeatureDone ? (
            <button
              className="workspace-menu__item environment-widget__ship-row"
              data-testid="env-row-ship"
              type="button"
              role="menuitem"
              disabled={featureDoneState === "working"}
              onClick={() => {
                playButtonClick();
                onFeatureDone();
                setOpen(false);
              }}
            >
              {featureDoneState === "working" ? "Shipping…" : featureDoneState === "done" ? "Shipped ✓" : "⚙ Ship feature"}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

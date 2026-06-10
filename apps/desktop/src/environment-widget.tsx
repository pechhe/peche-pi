import { useEffect, useRef, useState } from "react";
import type { WorkspaceRecord, WorktreeRecord } from "./desktop-state";
import type { WorkspaceMenuState } from "./hooks/use-workspace-menu";
import type { BranchInfo, PiDesktopApi } from "./ipc";
import { playButtonClick } from "./button-click-sound";
import { DiffIcon, SettingsIcon, MonitorIcon, WorktreeIcon, ChevronDownIcon } from "./icons";
import { CommitPushButton } from "./commit-push-button";
import { showToast } from "./toast";
import type { RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";

interface EnvironmentPanelProps {
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
  readonly autoShipEffective?: boolean;
  readonly autoShipGlobal?: boolean;
  readonly autoShipOverride?: boolean;
  readonly onSetAutoShipOverride?: (value: boolean | undefined) => void;
  readonly selectedRuntime?: RuntimeSnapshot;
  readonly api: PiDesktopApi;
  readonly sessionStatus?: string;
}

export function EnvironmentPanel(props: EnvironmentPanelProps) {
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
    autoShipEffective,
    autoShipGlobal,
    autoShipOverride,
    onSetAutoShipOverride,
    selectedRuntime,
    api,
    sessionStatus,
  } = props;

  const [branchPickerOpen, setBranchPickerOpen] = useState(false);
  const [branchList, setBranchList] = useState<readonly BranchInfo[]>([]);
  const [branchLoading, setBranchLoading] = useState(false);
  const [checkoutInProgress, setCheckoutInProgress] = useState(false);
  const [branchCreateOpen, setBranchCreateOpen] = useState(false);
  const [branchCreateName, setBranchCreateName] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef<HTMLDivElement | null>(null);
  const [locationPickerOpen, setLocationPickerOpen] = useState(false);
  const [branchSearch, setBranchSearch] = useState("");

  // Diff stats
  const [diffInsertions, setDiffInsertions] = useState(0);
  const [diffDeletions, setDiffDeletions] = useState(0);

  useEffect(() => {
    if (!selectedWorkspace) return;
    let cancelled = false;
    api.getWorkspaceDiffStat(selectedWorkspace.id).then((stat) => {
      if (cancelled) return;
      setDiffInsertions(stat.insertions);
      setDiffDeletions(stat.deletions);
    }).catch(() => { /* ignore */ });
    return () => { cancelled = true; };
  }, [selectedWorkspace, api]);

  // Close settings popover on outside click
  useEffect(() => {
    if (!settingsOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (settingsRef.current?.contains(event.target as Node)) return;
      setSettingsOpen(false);
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setSettingsOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [settingsOpen]);

  // Close branch/location pickers on outside click
  useEffect(() => {
    if (!branchPickerOpen && !locationPickerOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (document.querySelector("[data-testid='env-branch-list']")?.contains(target)) return;
      if (document.querySelector("[data-testid='env-location-list']")?.contains(target)) return;
      setBranchPickerOpen(false);
      setLocationPickerOpen(false);
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setBranchPickerOpen(false);
        setLocationPickerOpen(false);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [branchPickerOpen, locationPickerOpen]);

  if (!selectedWorkspace) return null;

  const isWorktree = selectedWorkspace.kind === "worktree";
  const location = isWorktree ? "worktree" : "local";
  const branchName = isWorktree ? selectedWorktree?.branchName : selectedWorkspace.branchName;
  const isDetached = isWorktree && !branchName;
  const baseBranch = rootWorkspace?.branchName;
  const displayBranch = branchName ?? baseBranch ?? "main";

  const commitShortcut = api.platform === "darwin" ? "⌘⇧K" : "Ctrl+Shift+K";

  return (
    <div className="environment-panel" data-testid="environment-panel">
      {/* Header */}
      <div className="environment-panel__header">
        <span className="environment-panel__title">Environment</span>
        <div className="environment-panel__gear-wrap" ref={settingsRef}>
          <button
            className="environment-panel__gear"
            data-testid="env-settings-gear"
            type="button"
            aria-label="Environment settings"
            aria-expanded={settingsOpen}
            onClick={() => { playButtonClick(); setSettingsOpen((prev) => !prev); }}
          >
            <SettingsIcon />
          </button>
          {settingsOpen ? (
            <div className="environment-panel__settings-popover" role="menu">
              {onSetAutoShipOverride ? (
                <div className="environment-panel__settings-section" data-testid="env-row-autoship-override">
                  <span className="environment-panel__settings-label">Auto-ship</span>
                  <div className="environment-widget__location-picker">
                    <button
                      className={`environment-widget__loc-btn${autoShipOverride === undefined ? " environment-widget__loc-btn--active" : ""}`}
                      type="button"
                      onClick={() => {
                        playButtonClick();
                        onSetAutoShipOverride(undefined);
                      }}
                    >
                      Default{autoShipGlobal ? " (on)" : " (off)"}
                    </button>
                    <button
                      className={`environment-widget__loc-btn${autoShipOverride === true ? " environment-widget__loc-btn--active" : ""}`}
                      type="button"
                      onClick={() => {
                        playButtonClick();
                        onSetAutoShipOverride(true);
                      }}
                    >
                      On
                    </button>
                    <button
                      className={`environment-widget__loc-btn${autoShipOverride === false ? " environment-widget__loc-btn--active" : ""}`}
                      type="button"
                      onClick={() => {
                        playButtonClick();
                        onSetAutoShipOverride(false);
                      }}
                    >
                      Off
                    </button>
                  </div>
                </div>
              ) : null}
              {isWorktree && selectedWorktree && rootWorkspace ? (
                <button
                  className="environment-panel__settings-danger"
                  data-testid="env-remove-worktree"
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    playButtonClick();
                    wsMenu.removeWorktree(rootWorkspace.id, selectedWorktree);
                    setSettingsOpen(false);
                  }}
                >
                  Remove worktree
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {/* Changes row */}
      <button
        className="environment-panel__row"
        data-testid="env-row-changes"
        type="button"
        onClick={() => {
          playButtonClick();
          if (!showDiffPanel) onToggleDiffPanel();
        }}
      >
        <span className="environment-panel__row-left">
          <DiffIcon />
          <span>Changes</span>
        </span>
        <span className="environment-panel__diff-stats">
          <span className="environment-panel__diff-insertions">+{diffInsertions}</span>
          <span className="environment-panel__diff-deletions">-{diffDeletions}</span>
        </span>
      </button>

      {/* Location row + menu */}
      <div className="environment-panel__menu-anchor">
      <button
        className="environment-panel__row environment-panel__row--location"
        data-testid="env-row-location"
        type="button"
        onClick={() => {
          playButtonClick();
          setBranchPickerOpen(false);
          setLocationPickerOpen((prev) => !prev);
        }}
      >
        <span className="environment-panel__row-left">
          {isWorktree ? <WorktreeIcon /> : <MonitorIcon />}
          <span>{isWorktree ? "Worktree" : "Local"}</span>
        </span>
        <ChevronDownIcon />
      </button>

      {locationPickerOpen && rootWorkspace ? (
        <div className="environment-panel__menu" data-testid="env-location-list">
          <button
            className={`environment-panel__branch-option${!isWorktree ? " environment-panel__branch-option--current" : ""}`}
            data-testid={`env-location-option-${rootWorkspace.id}`}
            type="button"
            onClick={() => {
              playButtonClick();
              wsMenu.selectWorkspace(rootWorkspace.id);
              setLocationPickerOpen(false);
            }}
          >
            {!isWorktree ? "✓ " : ""}Local
          </button>
          {activeWorktrees.map((wt) => {
            const isCurrent = selectedWorktree?.id === wt.id;
            const label = wt.branchName ?? `detached • ${wt.id.slice(0, 7)}`;
            return (
              <button
                key={wt.id}
                className={`environment-panel__branch-option${isCurrent ? " environment-panel__branch-option--current" : ""}`}
                data-testid={`env-location-option-${wt.linkedWorkspaceId}`}
                type="button"
                onClick={() => {
                  playButtonClick();
                  if (wt.linkedWorkspaceId) {
                    wsMenu.selectWorkspace(wt.linkedWorkspaceId);
                  }
                  setLocationPickerOpen(false);
                }}
              >
                {isCurrent ? "✓ " : ""}{label}
              </button>
            );
          })}
        </div>
      ) : null}
      </div>

      {/* Branch row + menu */}
      <div className="environment-panel__menu-anchor">
      {isWorktree ? (
        <div className="environment-panel__row environment-panel__row--branch" data-testid="env-row-branch">
          <span className="environment-panel__row-left">
            <span className="environment-panel__branch-icon">⎇</span>
            {isDetached ? (
              <>
                <span className="environment-widget__detached-badge">no branch yet</span>
                <span className="environment-widget__base-branch">base: {displayBranch}</span>
              </>
            ) : (
              <span>{displayBranch}</span>
            )}
          </span>
        </div>
      ) : (
        <button
          className="environment-panel__row environment-panel__row--branch"
          data-testid="env-row-branch"
          type="button"
          onClick={async () => {
            playButtonClick();
            if (branchPickerOpen) {
              setBranchPickerOpen(false);
              return;
            }
            if (!rootWorkspace) return;
            setLocationPickerOpen(false);
            setBranchLoading(true);
            setBranchPickerOpen(true);
            setBranchSearch("");
            try {
              const result = await api.listBranches(rootWorkspace.id);
              setBranchList(result.branches.filter((b) => !b.isRemote && !b.name.startsWith("origin/") && !b.name.includes("HEAD")));
            } catch {
              setBranchList([]);
            } finally {
              setBranchLoading(false);
            }
          }}
        >
          <span className="environment-panel__row-left">
            <span className="environment-panel__branch-icon">⎇</span>
            <span>{displayBranch}</span>
          </span>
          <ChevronDownIcon />
        </button>
      )}

      {branchPickerOpen ? (
        <div className="environment-panel__menu" data-testid="env-branch-list">
          <input
            className="environment-panel__menu-search"
            data-testid="env-branch-search"
            type="text"
            placeholder="Search branches"
            value={branchSearch}
            onChange={(e) => setBranchSearch(e.target.value)}
          />
          <div className="environment-panel__menu-label">Branches</div>
          {branchLoading ? (
            <span className="environment-panel__branch-loading">Loading branches…</span>
          ) : (
            branchList.filter((b) => b.name.toLowerCase().includes(branchSearch.toLowerCase())).map((branch) => (
              <button
                key={branch.name}
                className={`environment-panel__branch-option${branch.isCurrent ? " environment-panel__branch-option--current" : ""}`}
                data-testid={`env-branch-option-${branch.name}`}
                type="button"
                disabled={branch.isCurrent || checkoutInProgress}
                onClick={async () => {
                  if (!rootWorkspace || branch.isCurrent) return;
                  playButtonClick();
                  setCheckoutInProgress(true);
                  try {
                    const result = await api.checkoutBranch(rootWorkspace.id, branch.name);
                    if (result.success) {
                      setBranchPickerOpen(false);
                    } else {
                      showToast({ variant: "error", message: result.message });
                    }
                  } catch (err) {
                    showToast({ variant: "error", message: `Checkout failed: ${err instanceof Error ? err.message : String(err)}` });
                  } finally {
                    setCheckoutInProgress(false);
                  }
                }}
              >
                {branch.isCurrent ? "✓ " : ""}{branch.name}
              </button>
            ))
          )}
          {!branchLoading && !isWorktree && (
            branchCreateOpen ? (
              <div className="environment-panel__branch-create-row">
                <input
                  className="environment-panel__branch-option"
                  data-testid="env-branch-create-input"
                  type="text"
                  placeholder="new-branch-name"
                  autoFocus
                  value={branchCreateName}
                  onChange={(e) => setBranchCreateName(e.target.value)}
                  onKeyDown={async (e) => {
                    if (e.key !== "Enter") return;
                    const name = branchCreateName.trim();
                    if (!name || !rootWorkspace) return;
                    setCheckoutInProgress(true);
                    playButtonClick();
                    try {
                      const result = await api.createBranch(rootWorkspace.id, name);
                      if (result.success) {
                        setBranchPickerOpen(false);
                      } else {
                        showToast({ variant: "error", message: result.message });
                      }
                    } catch (err) {
                      showToast({ variant: "error", message: `Create failed: ${err instanceof Error ? err.message : String(err)}` });
                    } finally {
                      setCheckoutInProgress(false);
                      setBranchCreateOpen(false);
                      setBranchCreateName("");
                    }
                  }}
                />
                <button
                  className="environment-panel__branch-option"
                  data-testid="env-branch-create-confirm"
                  type="button"
                  disabled={checkoutInProgress}
                  onClick={async () => {
                    const name = branchCreateName.trim();
                    if (!name || !rootWorkspace) return;
                    setCheckoutInProgress(true);
                    playButtonClick();
                    try {
                      const result = await api.createBranch(rootWorkspace.id, name);
                      if (result.success) {
                        setBranchPickerOpen(false);
                      } else {
                        showToast({ variant: "error", message: result.message });
                      }
                    } catch (err) {
                      showToast({ variant: "error", message: `Create failed: ${err instanceof Error ? err.message : String(err)}` });
                    } finally {
                      setCheckoutInProgress(false);
                      setBranchCreateOpen(false);
                      setBranchCreateName("");
                    }
                  }}
                >
                  Create
                </button>
              </div>
            ) : (
              <button
                className="environment-panel__branch-option"
                data-testid="env-branch-create-toggle"
                type="button"
                onClick={() => {
                  playButtonClick();
                  setBranchCreateOpen(true);
                }}
              >
                ➕ Create and checkout new branch…
              </button>
            )
          )}
        </div>
      ) : null}
      </div>

      {/* Commit or push row */}
      <div className="environment-panel__row environment-panel__row--commit" data-testid="env-row-commit-push">
        {autoShipEffective && onFeatureDone ? (
          <button
            className="environment-panel__ship-btn"
            data-testid="env-row-ship-button"
            type="button"
            disabled={featureDoneState === "working"}
            onClick={() => {
              playButtonClick();
              onFeatureDone();
            }}
          >
            {featureDoneState === "working" ? "Shipping…" : featureDoneState === "done" ? "Shipped ✓" : "⚙ Ship"}
          </button>
        ) : (
          <CommitPushButton
            workspaceId={rootWorkspace?.id ?? ""}
            runtime={selectedRuntime}
            commitPushModel={commitPushModel}
            api={api}
            sessionStatus={sessionStatus}
            shortcutLabel={commitShortcut}
            branchHint={selectedWorktree?.name}
          />
        )}
      </div>


    </div>
  );
}

import { useCallback, useEffect, useState } from "react";
import type { CommitPushMode, WorkspaceRecord, WorktreeRecord } from "./desktop-state";
import type { WorkspaceMenuState } from "./hooks/use-workspace-menu";
import type { BranchInfo, PiDesktopApi } from "./ipc";
import { playButtonClick } from "./button-click-sound";
import { DiffIcon, MonitorIcon, WorktreeIcon, ChevronDownIcon } from "./icons";
import { CommitPushButton } from "./commit-push-button";
import { HandoffDialog } from "./handoff-dialog";
import { showToast } from "./toast";
import type { RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";

interface EnvironmentPanelProps {
  readonly selectedWorkspace: WorkspaceRecord | undefined;
  readonly selectedWorktree: WorktreeRecord | undefined;
  readonly rootWorkspace: WorkspaceRecord | undefined;
  readonly wsMenu: WorkspaceMenuState;
  readonly onToggleDiffPanel: () => void;
  readonly onFeatureDone?: () => void;
  readonly featureDoneState?: "idle" | "working" | "done" | "error";
  readonly commitPushModel?: string;
  readonly commitPushMode?: CommitPushMode;
  readonly selectedRuntime?: RuntimeSnapshot;
  readonly onSetCommitPushMode?: (mode: CommitPushMode) => void;
  readonly api: PiDesktopApi;
  readonly sessionStatus?: string;
}

export function EnvironmentPanel(props: EnvironmentPanelProps) {
  const {
    selectedWorkspace,
    selectedWorktree,
    rootWorkspace,
    wsMenu,
    onToggleDiffPanel,
    onFeatureDone,
    featureDoneState,
    commitPushModel,
    commitPushMode,
    selectedRuntime,
    api,
    sessionStatus,
    onSetCommitPushMode,
  } = props;

  const [branchPickerOpen, setBranchPickerOpen] = useState(false);
  const [branchList, setBranchList] = useState<readonly BranchInfo[]>([]);
  const [branchLoading, setBranchLoading] = useState(false);
  const [checkoutInProgress, setCheckoutInProgress] = useState(false);
  const [branchCreateOpen, setBranchCreateOpen] = useState(false);
  const [branchCreateName, setBranchCreateName] = useState("");
  const [handoffOpen, setHandoffOpen] = useState(false);
  const [branchSearch, setBranchSearch] = useState("");

  // Diff stats
  const [diffInsertions, setDiffInsertions] = useState(0);
  const [diffDeletions, setDiffDeletions] = useState(0);

  const refreshDiffStat = useCallback(() => {
    if (!selectedWorkspace) return;
    api.getWorkspaceDiffStat(selectedWorkspace.id).then((stat) => {
      setDiffInsertions(stat.insertions);
      setDiffDeletions(stat.deletions);
    }).catch(() => { /* ignore */ });
  }, [selectedWorkspace, api]);

  useEffect(() => {
    refreshDiffStat();
  }, [refreshDiffStat]);

  // Close branch picker on outside click
  useEffect(() => {
    if (!branchPickerOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (document.querySelector("[data-testid='env-branch-list']")?.contains(target)) return;
      setBranchPickerOpen(false);
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setBranchPickerOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [branchPickerOpen]);

  if (!selectedWorkspace) return null;

  const isWorktree = selectedWorkspace.kind === "worktree";
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
      </div>

      {/* Changes row */}
      <button
        className="environment-panel__row"
        data-testid="env-row-changes"
        type="button"
        onClick={() => {
          playButtonClick();
          onToggleDiffPanel();
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

      {/* Location row + handoff button */}
      <div className="environment-panel__row environment-panel__row--location" data-testid="env-row-location">
        <span className="environment-panel__row-left">
          {isWorktree ? <WorktreeIcon /> : <MonitorIcon />}
          <span>{isWorktree ? "Worktree" : "Local"}</span>
        </span>
        <button
          className="environment-panel__handoff-btn"
          data-testid="env-handoff-button"
          type="button"
          onClick={() => {
            playButtonClick();
            setBranchPickerOpen(false);
            setHandoffOpen(true);
          }}
        >
          Hand off
        </button>
      </div>

      {handoffOpen && rootWorkspace ? (
        <HandoffDialog
          mode={isWorktree ? "local" : "worktree"}
          branchName={branchName ?? displayBranch}
          localWorkspace={rootWorkspace}
          api={api}
          onClose={() => setHandoffOpen(false)}
          onSuccess={() => {
            setHandoffOpen(false);
            wsMenu.selectWorkspace(rootWorkspace.id);
          }}
        />
      ) : null}

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
                {!branchCreateOpen && (
                  <button
                    className="environment-panel__branch-create-icon"
                    data-testid="env-worktree-create-branch"
                    type="button"
                    title="Create new branch"
                    onClick={() => { playButtonClick(); setBranchCreateOpen(true); }}
                  >
                    ＋
                  </button>
                )}
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

      {/* Inline branch creation for detached worktrees */}
      {isWorktree && isDetached && branchCreateOpen ? (
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
              if (!name) return;
              setCheckoutInProgress(true);
              playButtonClick();
              try {
                const result = await api.createBranch(selectedWorkspace.id, name);
                if (result.success) {
                  setBranchCreateOpen(false);
                  setBranchCreateName("");
                } else {
                  showToast({ variant: "error", message: result.message });
                }
              } catch (err) {
                showToast({ variant: "error", message: `Create failed: ${err instanceof Error ? err.message : String(err)}` });
              } finally {
                setCheckoutInProgress(false);
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
              if (!name) return;
              setCheckoutInProgress(true);
              playButtonClick();
              try {
                const result = await api.createBranch(selectedWorkspace.id, name);
                if (result.success) {
                  setBranchCreateOpen(false);
                  setBranchCreateName("");
                } else {
                  showToast({ variant: "error", message: result.message });
                }
              } catch (err) {
                showToast({ variant: "error", message: `Create failed: ${err instanceof Error ? err.message : String(err)}` });
              } finally {
                setCheckoutInProgress(false);
              }
            }}
          >
            Create
          </button>
          <button
            className="environment-panel__branch-option environment-panel__branch-option--cancel"
            data-testid="env-branch-create-cancel"
            type="button"
            onClick={() => { setBranchCreateOpen(false); setBranchCreateName(""); }}
          >
            Cancel
          </button>
        </div>
      ) : null}

      {/* Commit/push + Autoship row */}
      <div className="environment-panel__row environment-panel__row--commit" data-testid="env-row-commit-push">
        <CommitPushButton
          workspaceId={selectedWorkspace.id}
          runtime={selectedRuntime}
          commitPushModel={commitPushModel}
          commitPushMode={commitPushMode}
          api={api}
          sessionStatus={sessionStatus}
          shortcutLabel={commitShortcut}
          branchHint={selectedWorktree?.branchName}
          onSetCommitPushMode={onSetCommitPushMode}
          onAutoShip={onFeatureDone}
          autoShipState={featureDoneState}
          onCommitSuccess={refreshDiffStat}
        />
        {onFeatureDone && commitPushMode === "auto-ship" ? (
          <button
            className="environment-panel__ship-btn"
            data-testid="env-row-ship-button"
            type="button"
            disabled={featureDoneState === "working"}
            onClick={() => {
              playButtonClick();
              const confirmed = window.confirm(
                "Autoship will commit and push all changes, then create or update a pull request. Continue?"
              );
              if (confirmed) onFeatureDone();
            }}
          >
            {featureDoneState === "working" ? "Autoshipping…" : featureDoneState === "done" ? "Autoshipped ✓" : "⚙ Autoship"}
          </button>
        ) : null}
      </div>


    </div>
  );
}

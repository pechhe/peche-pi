import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import type { RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import { CommitPushPrDialog } from "./commit-push-pr-dialog";
import type { PiDesktopApi, WorkspacePrInfo } from "./ipc";
import { showToast } from "./toast";
import { playButtonClick } from "./button-click-sound";
import type { CommitPushMode } from "./desktop-state";

function GitCommitIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 20 20" width="20" height="20">
      <circle cx="10" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M10 7.5V3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M10 12.5v4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M7.5 3.5h5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

interface CommitPushButtonProps {
  readonly workspaceId: string;
  readonly runtime: RuntimeSnapshot | undefined;
  readonly commitPushModel: string | undefined;
  readonly commitPushMode?: CommitPushMode;
  readonly api: PiDesktopApi;
  readonly disabled?: boolean;
  readonly sessionStatus?: string;
  readonly shortcutLabel: string;
  readonly branchHint?: string;
  readonly onSetCommitPushMode?: (mode: CommitPushMode) => void;
}

interface GitInfo {
  readonly isGitRepo: boolean;
  readonly changedCount: number;
}

type ButtonMode = "commit-push" | "create-pr" | "view-pr" | "merged-pr";

const SHORTCUT_EVENT = "pi:commit-and-push";

export function CommitPushButton({
  workspaceId,
  runtime: _runtime,
  commitPushModel,
  commitPushMode,
  api,
  disabled,
  sessionStatus,
  shortcutLabel,
  branchHint,
  onSetCommitPushMode,
}: CommitPushButtonProps) {
  const [showSettings, setShowSettings] = useState(false);
  const workflowMode = commitPushMode ?? "semi-auto";
  const settingsRef = useRef<HTMLDivElement | null>(null);

  // Close settings popover when clicking outside
  useEffect(() => {
    if (!showSettings) return;
    const handler = (e: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setShowSettings(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showSettings]);
  const [busy, setBusy] = useState(false);
  const [gitInfo, setGitInfo] = useState<GitInfo>({ isGitRepo: false, changedCount: 0 });
  const [prInfo, setPrInfo] = useState<WorkspacePrInfo | undefined>(undefined);
  const [prDialogOpen, setPrDialogOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const refreshGitInfo = useCallback(() => {
    if (!workspaceId) {
      setGitInfo({ isGitRepo: false, changedCount: 0 });
      return;
    }
    void api.getWorkspaceGitInfo(workspaceId).then((info) => {
      setGitInfo(info);
    });
  }, [api, workspaceId]);

  const refreshPrInfo = useCallback(() => {
    if (!workspaceId) {
      setPrInfo(undefined);
      return;
    }
    void api
      .getWorkspacePrInfo(workspaceId)
      .then((info) => {
        setPrInfo(info);
      })
      .catch(() => {
        // Non-fatal: PR state is derived, so falling back to undefined keeps
        // the button in its commit-push-only behavior.
        setPrInfo(undefined);
      });
  }, [api, workspaceId]);

  // Initial fetch + on workspace change
  useEffect(() => {
    refreshGitInfo();
    refreshPrInfo();
  }, [refreshGitInfo, refreshPrInfo]);

  // Refresh when a session finishes (running -> not running)
  const prevStatusRef = useRef(sessionStatus);
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = sessionStatus;
    if (prev === "running" && sessionStatus !== "running") {
      refreshGitInfo();
      refreshPrInfo();
    }
  }, [sessionStatus, refreshGitInfo, refreshPrInfo]);



  const handleCommitPush = useCallback(async () => {
    if (busy || !workspaceId) return;
    if (!gitInfo.isGitRepo) return;
    setBusy(true);
    // eslint-disable-next-line no-console
    console.info("[commit-push] invoke", { workspaceId, model: commitPushModel });
    try {
      const result = await api.commitPushExecute(workspaceId, branchHint);
      if (result.success) {
        // eslint-disable-next-line no-console
        console.info("[commit-push] success", result);
        showToast({ variant: "success", message: result.message });
      } else {
        // eslint-disable-next-line no-console
        console.error("[commit-push] failed", result);
        showToast({ variant: "error", message: result.message });
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[commit-push] threw", err);
      showToast({
        variant: "error",
        message: err instanceof Error ? err.message : "Commit & push failed",
      });
    } finally {
      setBusy(false);
      refreshGitInfo();
      refreshPrInfo();
    }
  }, [api, branchHint, busy, commitPushModel, gitInfo.isGitRepo, refreshGitInfo, refreshPrInfo, workspaceId]);

  // Trigger via global shortcut event (dispatched by App.tsx Cmd+Shift+K handler)
  useEffect(() => {
    const handler = () => {
      void handleCommitPush();
    };
    window.addEventListener(SHORTCUT_EVENT, handler);
    return () => window.removeEventListener(SHORTCUT_EVENT, handler);
  }, [handleCommitPush]);

  const handleCreatePrOneClick = useCallback(async () => {
    if (!prInfo) return;
    setBusy(true);
    try {
      const result = await api.prCreate(workspaceId, {
        base: prInfo.defaultBranch || "main",
      });
      if (result.success) {
        showToast({
          variant: "success",
          message: result.url ? `Pull request created: ${result.url}` : "Pull request created.",
        });
        refreshPrInfo();
      } else {
        showToast({ variant: "error", message: result.message });
      }
    } catch (err) {
      showToast({
        variant: "error",
        message: err instanceof Error ? err.message : "Failed to create PR.",
      });
    } finally {
      setBusy(false);
    }
  }, [api, prInfo, refreshPrInfo, workspaceId]);

  if (!workspaceId) return null;
  // Hide entirely when the workspace isn't a git repo.
  if (!gitInfo.isGitRepo) return null;

  const hasChanges = gitInfo.changedCount > 0;
  const ghAvailable = prInfo?.ghAvailable ?? false;
  const prState = prInfo?.prState ?? "none";
  // merged: the branch's PR is already in main and the tree is clean — there's
  // nothing to PR, so show a passive link to the merged PR rather than
  // re-offering "Create PR". `closed` (PR closed unmerged) still routes to
  // create-pr since opening a fresh PR is the expected next step there.
  const mode: ButtonMode = hasChanges || !ghAvailable
    ? "commit-push"
    : prState === "open"
      ? "view-pr"
      : prState === "merged"
        ? "merged-pr"
        : "create-pr";
  const isPill = mode !== "commit-push" || hasChanges;

  const modeClass: Record<ButtonMode, string> = {
    "commit-push": hasChanges ? "commit-push commit-push--dirty" : "commit-push",
    "view-pr": "commit-push commit-push--view-pr",
    "merged-pr": "commit-push commit-push--view-pr",
    "create-pr": "commit-push commit-push--create-pr",
  };
  const containerClass = modeClass[mode];

  const modeAction: Record<ButtonMode, () => void> = {
    "commit-push": () => { void handleCommitPush(); },
    "create-pr": () => {
      if (workflowMode === "manual") {
        setPrDialogOpen(true);
      } else {
        void handleCreatePrOneClick();
      }
    },
    "view-pr": () => { if (prInfo?.prUrl) void api.openExternal(prInfo.prUrl); },
    "merged-pr": () => { if (prInfo?.prUrl) void api.openExternal(prInfo.prUrl); },
  };
  const handlePrimaryClick = () => {
    if (busy || disabled) return;
    modeAction[mode]();
  };

  const modeLabel: Record<ButtonMode, string> = {
    "commit-push": hasChanges
      ? `Commit & Push (${gitInfo.changedCount} changed)`
      : "Commit & Push",
    "view-pr": prInfo?.prNumber ? `View PR #${prInfo.prNumber}` : "View PR",
    "merged-pr": prInfo?.prNumber ? `View PR #${prInfo.prNumber} (merged)` : "View merged PR",
    "create-pr": "Create PR",
  };
  const primaryLabel = modeLabel[mode];

  const modeTooltip: Record<ButtonMode, string> = {
    "commit-push": "Commit & Push",
    "view-pr": prInfo?.prNumber ? `View PR #${prInfo.prNumber}` : "View PR",
    "merged-pr": prInfo?.prNumber ? `Merged — view PR #${prInfo.prNumber}` : "Merged — view PR",
    "create-pr": "Create pull request",
  };
  const tooltipText = modeTooltip[mode];

  return (
    <div className={containerClass} ref={containerRef}>
      <div className="shortcut-tooltip-wrap topbar__tooltip-wrap">
        <button
          aria-label={primaryLabel}
          className={`commit-push__button${busy ? " commit-push__button--busy" : ""}${isPill ? " commit-push__button--pill" : " icon-button topbar__icon"}`}
          type="button"
          disabled={disabled || busy}
          onClick={() => { playButtonClick(); handlePrimaryClick(); }}
        >
          {busy ? (
            <span className="commit-push__spinner" />
          ) : (
            <GitCommitIcon />
          )}
          {isPill && !busy ? (
            <span className="commit-push__pill-label">
              {mode === "commit-push" && hasChanges ? (
                <>
                  <span className="commit-push__pill-count">{gitInfo.changedCount}</span>
                  <span className="commit-push__pill-text">Commit &amp; Push</span>
                </>
              ) : (
                <span className="commit-push__pill-text">{primaryLabel}</span>
              )}
            </span>
          ) : null}
        </button>
        <span className="shortcut-tooltip topbar__tooltip" role="tooltip">
          <span>{tooltipText}</span>
          {mode === "commit-push" ? <kbd>{shortcutLabel}</kbd> : null}
        </span>
      </div>
      {onSetCommitPushMode ? (
        <div className="commit-push__settings" ref={settingsRef}>
          <button
            aria-label="Commit & Push settings"
            className="icon-button commit-push__settings-btn"
            type="button"
            onClick={() => setShowSettings(!showSettings)}
          >
            <svg aria-hidden="true" fill="none" viewBox="0 0 20 20" width="16" height="16">
              <path d="M10 13a3 3 0 100-6 3 3 0 000 6z" stroke="currentColor" strokeWidth="1.4" />
              <path d="M16.32 12.9a1.3 1.3 0 00.26 1.43l.05.05a1.58 1.58 0 01-1.12 2.7 1.58 1.58 0 01-1.12-.46l-.05-.05a1.3 1.3 0 00-1.43-.26 1.3 1.3 0 00-.79 1.19v.14a1.58 1.58 0 01-3.16 0v-.07a1.3 1.3 0 00-.85-1.19 1.3 1.3 0 00-1.43.26l-.05.05a1.58 1.58 0 11-2.24-2.24l.05-.05a1.3 1.3 0 00.26-1.43 1.3 1.3 0 00-1.19-.79h-.14a1.58 1.58 0 010-3.16h.07a1.3 1.3 0 001.19-.85 1.3 1.3 0 00-.26-1.43l-.05-.05a1.58 1.58 0 112.24-2.24l.05.05a1.3 1.3 0 001.43.26h.06a1.3 1.3 0 00.79-1.19v-.14a1.58 1.58 0 013.16 0v.07a1.3 1.3 0 00.79 1.19 1.3 1.3 0 001.43-.26l.05-.05a1.58 1.58 0 112.24 2.24l-.05.05a1.3 1.3 0 00-.26 1.43v.06a1.3 1.3 0 001.19.79h.14a1.58 1.58 0 010 3.16h-.07a1.3 1.3 0 00-1.19.79z" stroke="currentColor" strokeWidth="1.4" />
            </svg>
          </button>
          {showSettings ? (
            <div className="commit-push__settings-popover">
              <div className="commit-push__settings-title">Workflow</div>
              <div className="commit-push__settings-options">
                {([
                  { value: "manual" as const, label: "Manual", desc: "Full control over commit, push, and PR" },
                  { value: "semi-auto" as const, label: "Semi-automatic", desc: "One-click commit+push and PR creation" },
                  { value: "auto-ship" as const, label: "Auto-ship", desc: "One button does everything (coming soon)", disabled: true },
                ]).map((opt) => (
                  <label
                    key={opt.value}
                    className={`commit-push__settings-option${opt.disabled ? " commit-push__settings-option--disabled" : ""}`}
                  >
                    <input
                      type="radio"
                      name="commit-push-mode"
                      checked={commitPushMode === opt.value}
                      disabled={opt.disabled}
                      onChange={() => onSetCommitPushMode(opt.value)}
                    />
                    <div>
                      <div className="commit-push__settings-option-label">{opt.label}</div>
                      <div className="commit-push__settings-option-desc">{opt.desc}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
      {prDialogOpen && prInfo ? (
        <CommitPushPrDialog
          api={api}
          defaultBase={prInfo.defaultBranch || "main"}
          headBranch={prInfo.headBranch}
          workspaceId={workspaceId}
          onClose={() => setPrDialogOpen(false)}
          onSuccess={(url) => {
            showToast({
              variant: "success",
              message: url ? `Pull request created: ${url}` : "Pull request created.",
            });
            refreshPrInfo();
          }}
        />
      ) : null}

    </div>
  );
}

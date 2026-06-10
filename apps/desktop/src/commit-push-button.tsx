import { useCallback, useEffect, useRef, useState } from "react";
import type { RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import { CommitPushPrDialog } from "./commit-push-pr-dialog";
import type { PiDesktopApi, WorkspacePrInfo } from "./ipc";
import { showToast } from "./toast";
import { playButtonClick } from "./button-click-sound";

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
  readonly api: PiDesktopApi;
  readonly disabled?: boolean;
  readonly sessionStatus?: string;
  readonly shortcutLabel: string;
  readonly branchHint?: string;
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
  api,
  disabled,
  sessionStatus,
  shortcutLabel,
  branchHint,
}: CommitPushButtonProps) {
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
    "create-pr": () => { setPrDialogOpen(true); },
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

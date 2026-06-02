import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import { buildModelOptions, type ComposerModelOption } from "./composer-commands";
import type { PiDesktopApi } from "./ipc";
import { SettingsIcon } from "./icons";

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
}

interface GitInfo {
  readonly isGitRepo: boolean;
  readonly changedCount: number;
}

const SHORTCUT_EVENT = "pi:commit-and-push";

export function CommitPushButton({
  workspaceId,
  runtime,
  commitPushModel,
  api,
  disabled,
  sessionStatus,
  shortcutLabel,
}: CommitPushButtonProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);
  const [gitInfo, setGitInfo] = useState<GitInfo>({ isGitRepo: false, changedCount: 0 });
  const containerRef = useRef<HTMLDivElement | null>(null);

  const modelOptions = useMemo(() => buildModelOptions(runtime), [runtime]);

  const selectedLabel = useMemo(() => {
    if (!commitPushModel) return "Pick model";
    const colonIndex = commitPushModel.indexOf(":");
    if (colonIndex === -1) return commitPushModel;
    const providerId = commitPushModel.slice(0, colonIndex);
    const modelId = commitPushModel.slice(colonIndex + 1);
    const match = modelOptions.find(
      (m) => m.providerId === providerId && m.modelId === modelId,
    );
    return match ? `${match.providerId}:${match.modelId}` : commitPushModel;
  }, [commitPushModel, modelOptions]);

  const refreshGitInfo = useCallback(() => {
    if (!workspaceId) {
      setGitInfo({ isGitRepo: false, changedCount: 0 });
      return;
    }
    void api.getWorkspaceGitInfo(workspaceId).then((info) => {
      setGitInfo(info);
    });
  }, [api, workspaceId]);

  // Initial fetch + on workspace change
  useEffect(() => {
    refreshGitInfo();
  }, [refreshGitInfo]);

  // Refresh when a session finishes (running -> not running)
  const prevStatusRef = useRef(sessionStatus);
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = sessionStatus;
    if (prev === "running" && sessionStatus !== "running") {
      refreshGitInfo();
    }
  }, [sessionStatus, refreshGitInfo]);

  // Close dropdown on click outside
  useEffect(() => {
    if (!open) return undefined;
    const handle = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return undefined;
    const handle = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handle);
    return () => document.removeEventListener("keydown", handle);
  }, [open]);

  // Clear result after timeout
  useEffect(() => {
    if (!lastResult) return undefined;
    const t = setTimeout(() => setLastResult(null), 5000);
    return () => clearTimeout(t);
  }, [lastResult]);

  const handleCommitPush = useCallback(async () => {
    if (busy || !workspaceId) return;
    if (!gitInfo.isGitRepo) return;
    setBusy(true);
    setLastResult(null);
    // eslint-disable-next-line no-console
    console.info("[commit-push] invoke", { workspaceId, model: commitPushModel });
    try {
      const result = await api.commitPushExecute(workspaceId);
      setLastResult(result.message);
      if (result.success) {
        // eslint-disable-next-line no-console
        console.info("[commit-push] success", result);
      } else {
        // eslint-disable-next-line no-console
        console.error("[commit-push] failed", result);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[commit-push] threw", err);
      setLastResult(err instanceof Error ? err.message : "Commit & push failed");
    } finally {
      setBusy(false);
      refreshGitInfo();
    }
  }, [api, busy, commitPushModel, gitInfo.isGitRepo, refreshGitInfo, workspaceId]);

  // Trigger via global shortcut event (dispatched by App.tsx Cmd+Shift+K handler)
  useEffect(() => {
    const handler = () => {
      void handleCommitPush();
    };
    window.addEventListener(SHORTCUT_EVENT, handler);
    return () => window.removeEventListener(SHORTCUT_EVENT, handler);
  }, [handleCommitPush]);

  const handleSelectModel = async (option: ComposerModelOption) => {
    const modelString = `${option.providerId}:${option.modelId}`;
    await api.setCommitPushModel(workspaceId, modelString);
    setOpen(false);
  };

  if (!workspaceId) return null;
  // Hide entirely when the workspace isn't a git repo.
  if (!gitInfo.isGitRepo) return null;

  const hasChanges = gitInfo.changedCount > 0;

  return (
    <div
      className={`commit-push${hasChanges ? " commit-push--dirty" : ""}`}
      ref={containerRef}
    >
      <div className="shortcut-tooltip-wrap topbar__tooltip-wrap">
        <button
          aria-label={hasChanges ? `Commit & Push (${gitInfo.changedCount} changed)` : "Commit & Push"}
          className={`commit-push__button${busy ? " commit-push__button--busy" : ""}${hasChanges ? " commit-push__button--pill" : " icon-button topbar__icon"}`}
          type="button"
          disabled={disabled || busy}
          onClick={handleCommitPush}
        >
          {busy ? (
            <span className="commit-push__spinner" />
          ) : (
            <GitCommitIcon />
          )}
          {hasChanges && !busy ? (
            <span className="commit-push__pill-label">
              <span className="commit-push__pill-count">{gitInfo.changedCount}</span>
              <span className="commit-push__pill-text">Commit &amp; Push</span>
            </span>
          ) : null}
        </button>
        {lastResult ? (
          <span className="shortcut-tooltip topbar__tooltip commit-push__result-tooltip" role="tooltip">
            <span>{lastResult}</span>
          </span>
        ) : (
          <span className="shortcut-tooltip topbar__tooltip" role="tooltip">
            <span>Commit &amp; Push</span>
            <kbd>{shortcutLabel}</kbd>
          </span>
        )}
      </div>
      <div className="shortcut-tooltip-wrap topbar__tooltip-wrap">
        <button
          className="icon-button topbar__icon commit-push__gear"
          type="button"
          disabled={disabled || busy}
          onClick={() => setOpen((v) => !v)}
        >
          <SettingsIcon />
        </button>
        <span className="shortcut-tooltip topbar__tooltip" role="tooltip">
          <span>Commit model: {selectedLabel}</span>
        </span>
      </div>
      {open ? (
        <div className="model-selector__dropdown commit-push__dropdown">
          <div className="model-selector__group-title">
            Commit message model
          </div>
          {modelOptions.length === 0 ? (
            <div className="model-selector__empty">
              No models available. Connect a provider in Settings.
            </div>
          ) : (
            modelOptions.map((option) => {
              const modelString = `${option.providerId}:${option.modelId}`;
              const isActive = commitPushModel === modelString;
              return (
                <button
                  className={`model-selector__item${isActive ? " model-selector__item--active" : ""}`}
                  key={modelString}
                  type="button"
                  onClick={() => handleSelectModel(option)}
                >
                  <span className="model-selector__item-label">{option.label}</span>
                  {isActive ? (
                    <span className="model-selector__item-meta">active</span>
                  ) : null}
                </button>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}

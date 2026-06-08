import { useRef, useState } from "react";
import type {
  GraphifyProjectMapStatus,
  GraphifyHealthCheckResult,
  GraphifyHookStatus,
  PiDesktopApi,
} from "./ipc";
import { ContextIcon, RefreshIcon, GraphIcon } from "./icons";
import { playButtonClick } from "./button-click-sound";

interface ProjectMapPopoverProps {
  readonly rootWorkspace: { readonly id: string } | undefined;
  readonly api: PiDesktopApi;
  readonly onOpenGraph?: () => void;
}

export function ProjectMapPopover({ rootWorkspace, api, onOpenGraph }: ProjectMapPopoverProps) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<GraphifyProjectMapStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState("");
  const [healthCheck, setHealthCheck] = useState<GraphifyHealthCheckResult | null>(null);
  const [hookStatus, setHookStatus] = useState<GraphifyHookStatus | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);

  const loadStatus = async () => {
    if (!rootWorkspace) return;
    setLoading(true);
    setMessage("");
    try {
      const [s, health, hooks] = await Promise.all([
        api.getGraphifyProjectMapStatus(rootWorkspace.id),
        api.getGraphifyHealthCheck(rootWorkspace.id),
        api.getGraphifyHookStatus(rootWorkspace.id),
      ]);
      setStatus(s);
      setHealthCheck(health);
      setHookStatus(hooks);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  const toggle = () => {
    setOpen((current) => {
      const next = !current;
      if (next) void loadStatus();
      return next;
    });
  };

  const refresh = async () => {
    if (!rootWorkspace) return;
    setRunning(true);
    setMessage("");
    try {
      const result = status?.available
        ? await api.updateGraphifyProjectMap(rootWorkspace.id)
        : await api.buildGraphifyProjectMap(rootWorkspace.id);
      setStatus(result.status ?? null);
      setMessage(result.message);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setRunning(false);
    }
  };

  const openGraphView = () => {
    if (status?.available) {
      onOpenGraph?.();
    }
  };

  const copyDebugPrompt = () => {
    if (healthCheck?.debugPrompt) {
      void navigator.clipboard.writeText(healthCheck.debugPrompt);
      setMessage("Debug prompt copied.");
    }
  };

  const toggleHook = async (enable: boolean) => {
    if (!rootWorkspace) return;
    const result = await api.setGraphifyHook(rootWorkspace.id, enable);
    setMessage(result.message);
    if (result.success) {
      setHookStatus(await api.getGraphifyHookStatus(rootWorkspace.id));
    }
  };

  const statusLabel = loading
    ? "Loading"
    : status?.available
      ? status.stale ? "Stale" : "Fresh"
      : "Missing";
  const statusClass = status?.stale
    ? "project-map-popover__status--stale"
    : status?.available ? "project-map-popover__status--fresh" : "";

  return (
    <div className="project-map-popover" ref={ref}>
      <div className="shortcut-tooltip-wrap topbar__tooltip-wrap">
        <button
          aria-label="Project map"
          className={`icon-button topbar__icon ${open ? "icon-button--active" : ""} ${status?.stale || (healthCheck && !healthCheck.healthy) ? "topbar__icon--warning" : ""}`}
          type="button"
          disabled={!rootWorkspace}
          onClick={() => { playButtonClick(); toggle(); }}
        >
          <ContextIcon />
        </button>
        <span className="shortcut-tooltip topbar__tooltip" role="tooltip">
          <span>Project map</span>
        </span>
      </div>
      {open ? (
        <div className="project-map-popover__menu" role="menu">
          <div className="project-map-popover__header">
            <div className="project-map-popover__header-left">
              <strong>Project map</strong>
              {status?.htmlPath ? (
                <button
                  type="button"
                  className="project-map-popover__graph-btn"
                  onClick={() => { playButtonClick(); openGraphView(); }}
                  title="Open visual graph"
                >
                  <GraphIcon />
                </button>
              ) : null}
            </div>
            <div className="project-map-popover__header-right">
              <span className={`project-map-popover__status ${statusClass}`}>{statusLabel}</span>
              <button
                type="button"
                className="project-map-popover__refresh"
                disabled={loading || running}
                onClick={() => { playButtonClick(); void refresh(); }}
                title={status?.available ? "Update graph" : "Build graph"}
              >
                <RefreshIcon className={running ? "spin" : ""} />
              </button>
            </div>
          </div>

          <div className="project-map-popover__stats">
            <span>{status?.nodeCount ?? "—"}<small>nodes</small></span>
            <span>{status?.edgeCount ?? "—"}<small>edges</small></span>
            <span>{status?.communityCount ?? "—"}<small>communities</small></span>
          </div>

          {status?.builtCommit ? (
            <p className="project-map-popover__note">
              Built {status.builtCommit.slice(0, 8)}
              {status.currentCommit ? ` · Current ${status.currentCommit.slice(0, 8)}` : ""}
            </p>
          ) : null}

          {healthCheck && !healthCheck.healthy ? (
            <div className="project-map-popover__health">
              {healthCheck.issues.map((issue) => (
                <p key={issue.code} className={`project-map-popover__issue project-map-popover__issue--${issue.severity}`}>
                  {issue.message}
                  {issue.fixHint ? <small>{issue.fixHint}</small> : null}
                </p>
              ))}
              <button type="button" className="project-map-popover__debug-btn" onClick={() => { playButtonClick(); copyDebugPrompt(); }}>
                Copy debug prompt
              </button>
            </div>
          ) : null}

          <div className="project-map-popover__auto">
            <label className="project-map-popover__auto-item">
              <span>
                <strong>Auto-refresh</strong>
                <small>Rebuild on commit.</small>
              </span>
              <input
                type="checkbox"
                checked={hookStatus?.postCommit ?? false}
                onChange={(e) => { playButtonClick(); void toggleHook(e.currentTarget.checked); }}
              />
            </label>
          </div>

          {message ? <pre className="project-map-popover__message">{message}</pre> : null}
        </div>
      ) : null}
    </div>
  );
}

import { useRef, useState } from "react";
import type {
  GraphifyProjectMapStatus,
  GraphifyHealthCheckResult,
  GraphifyHookStatus,
  GraphifyWatchStatus,
  PiDesktopApi,
} from "./ipc";
import { ContextIcon } from "./icons";
import { playButtonClick } from "./button-click-sound";

interface ProjectMapPopoverProps {
  readonly rootWorkspace: { readonly id: string } | undefined;
  readonly api: PiDesktopApi;
}

export function ProjectMapPopover({ rootWorkspace, api }: ProjectMapPopoverProps) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<GraphifyProjectMapStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState<"build" | "update" | null>(null);
  const [message, setMessage] = useState("");
  const [healthCheck, setHealthCheck] = useState<GraphifyHealthCheckResult | null>(null);
  const [hookStatus, setHookStatus] = useState<GraphifyHookStatus | null>(null);
  const [watchStatus, setWatchStatus] = useState<GraphifyWatchStatus | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);

  const loadStatus = async () => {
    if (!rootWorkspace) return;
    setLoading(true);
    setMessage("");
    try {
      const [s, health, hooks, watch] = await Promise.all([
        api.getGraphifyProjectMapStatus(rootWorkspace.id),
        api.getGraphifyHealthCheck(rootWorkspace.id),
        api.getGraphifyHookStatus(rootWorkspace.id),
        api.getGraphifyWatchStatus(rootWorkspace.id),
      ]);
      setStatus(s);
      setHealthCheck(health);
      setHookStatus(hooks);
      setWatchStatus(watch);
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

  const runAction = async (action: "build" | "update") => {
    if (!rootWorkspace) return;
    setRunning(action);
    setMessage("");
    try {
      const result = action === "build"
        ? await api.buildGraphifyProjectMap(rootWorkspace.id)
        : await api.updateGraphifyProjectMap(rootWorkspace.id);
      setStatus(result.status ?? null);
      setMessage(result.message);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setRunning(null);
    }
  };

  const openGraphHtml = () => {
    if (status?.htmlPath) {
      void api.openExternal(`file://${status.htmlPath}`);
    }
  };

  const seedPrompt = (prompt: string) => {
    void navigator.clipboard.writeText(prompt);
    setMessage("Copied graph-aware prompt to clipboard.");
  };

  const toggleHook = async (enable: boolean) => {
    if (!rootWorkspace) return;
    const result = await api.setGraphifyHook(rootWorkspace.id, enable);
    setMessage(result.message);
    if (result.success) {
      setHookStatus(await api.getGraphifyHookStatus(rootWorkspace.id));
    }
  };

  const toggleWatch = async (enable: boolean) => {
    if (!rootWorkspace) return;
    const result = await api.setGraphifyWatch(rootWorkspace.id, enable);
    setMessage(result.message);
    if (result.success) {
      setWatchStatus(await api.getGraphifyWatchStatus(rootWorkspace.id));
    }
  };

  return (
    <div className="project-map-popover" ref={ref}>
      <div className="shortcut-tooltip-wrap topbar__tooltip-wrap">
        <button
          aria-label="Project map"
          className={`icon-button topbar__icon ${open ? "icon-button--active" : ""} ${status?.stale || (healthCheck && !healthCheck.healthy) ? "topbar__icon--warning" : ""} ${watchStatus?.running ? "topbar__icon--watching" : ""}`}
          type="button"
          disabled={!rootWorkspace}
          onClick={() => { playButtonClick(); toggle(); }}
        >
          <ContextIcon />
          {watchStatus?.running ? <span className="topbar__watch-dot" title="File watcher running" /> : null}
        </button>
        <span className="shortcut-tooltip topbar__tooltip" role="tooltip">
          <span>Project map</span>
        </span>
      </div>
      {open ? (
        <div className="project-map-popover__menu" role="menu">
          <div className="project-map-popover__header">
            <strong>Project map</strong>
            <span className={`project-map-popover__status ${status?.stale ? "project-map-popover__status--stale" : status?.available ? "project-map-popover__status--fresh" : ""}`}>
              {loading ? "Loading" : status?.available ? status.stale ? "Stale" : "Fresh" : "Missing"}
            </span>
          </div>
          <div className="project-map-popover__stats">
            <span>{status?.nodeCount ?? "—"}<small>nodes</small></span>
            <span>{status?.edgeCount ?? "—"}<small>edges</small></span>
            <span>{status?.communityCount ?? "—"}<small>communities</small></span>
          </div>
          {status?.builtCommit ? (
            <p className="project-map-popover__note">Built {status.builtCommit.slice(0, 8)}{status.currentCommit ? ` · Current ${status.currentCommit.slice(0, 8)}` : ""}</p>
          ) : null}
          {status?.stale ? <p className="project-map-popover__note project-map-popover__note--warning">Map is behind current commit. Update before using as source of truth.</p> : null}
          {healthCheck && !healthCheck.healthy ? (
            <div className="project-map-popover__health">
              <span className="project-map-popover__health-title">Issues detected</span>
              {healthCheck.issues.map((issue) => (
                <p key={issue.code} className={`project-map-popover__issue project-map-popover__issue--${issue.severity}`}>
                  {issue.message}
                  {issue.fixHint ? <small>{issue.fixHint}</small> : null}
                </p>
              ))}
              <button
                type="button"
                className="project-map-popover__debug-btn"
                onClick={() => {
                  playButtonClick();
                  if (healthCheck.debugPrompt) {
                    void navigator.clipboard.writeText(healthCheck.debugPrompt);
                    setMessage("Debug prompt copied. Paste into a new thread to diagnose.");
                  }
                }}
              >
                Copy debug prompt
              </button>
            </div>
          ) : null}
          <div className="project-map-popover__actions">
            <button type="button" onClick={() => { playButtonClick(); void loadStatus(); }} disabled={loading || Boolean(running)}>Refresh status</button>
            <button type="button" onClick={() => { playButtonClick(); void runAction(status?.available ? "update" : "build"); }} disabled={Boolean(running)}>{running ? "Running…" : status?.available ? "Update map" : "Build map"}</button>
            <button type="button" onClick={() => { playButtonClick(); void runAction("build"); }} disabled={Boolean(running)}>Rebuild</button>
            <button type="button" onClick={() => { playButtonClick(); openGraphHtml(); }} disabled={!status?.htmlPath}>Open visual graph</button>
            <button type="button" onClick={() => { playButtonClick(); seedPrompt("Use Graphify to summarize this project's architecture, main communities, and likely ownership boundaries."); }}>Copy architecture prompt</button>
          </div>
          {status?.available ? (
            <div className="project-map-popover__auto">
              <label className="project-map-popover__auto-item">
                <span>
                  <strong>Auto-refresh hook</strong>
                  <small>Rebuild graph on git commit.</small>
                </span>
                <input
                  type="checkbox"
                  checked={hookStatus?.postCommit ?? false}
                  onChange={(e) => { playButtonClick(); void toggleHook(e.currentTarget.checked); }}
                />
              </label>
              <label className="project-map-popover__auto-item">
                <span>
                  <strong>File watcher</strong>
                  <small>{watchStatus?.running ? `Running (PID ${watchStatus.pid})` : "Auto-rebuild on code changes."}</small>
                </span>
                <input
                  type="checkbox"
                  checked={watchStatus?.running ?? false}
                  onChange={(e) => { playButtonClick(); void toggleWatch(e.currentTarget.checked); }}
                />
              </label>
            </div>
          ) : null}
          {status?.communities.length ? (
            <div className="project-map-popover__communities">
              <span>Top communities</span>
              {status.communities.slice(0, 5).map((community) => <button key={community.name} type="button" onClick={() => seedPrompt(`Use Graphify to explain the ${community.name} community in this workspace.`)}>{community.name}</button>)}
            </div>
          ) : null}
          {message ? <pre className="project-map-popover__message">{message}</pre> : null}
        </div>
      ) : null}
    </div>
  );
}

import { useCallback, useEffect, useRef, useState } from "react";
import type { PiDesktopApi, SessionLockSnapshot } from "./ipc";

interface SessionLockBannerProps {
  readonly api: PiDesktopApi;
  readonly workspaceId: string;
  readonly sessionId: string;
  /** Called after a successful take-over so the host can refresh the transcript. */
  readonly onTakeOver: () => void;
}

const POLL_INTERVAL_MS = 5_000;

function ownerLabel(snapshot: Extract<SessionLockSnapshot, { status: "foreign" }>): string {
  const source = snapshot.owner.kind === "cli" ? "the pi CLI" : "another pi window";
  return `${source} (pid ${snapshot.owner.pid})`;
}

/**
 * Shows an observe-only banner when another pi runtime drives this session's
 * file. A live holder cannot be preempted; a stale/dead one can be taken over.
 * Renders nothing when the session is free (this window already drives it).
 */
export function SessionLockBanner(props: SessionLockBannerProps) {
  const { api, workspaceId, sessionId, onTakeOver } = props;
  const [snapshot, setSnapshot] = useState<SessionLockSnapshot | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeRef = useRef(true);

  const refresh = useCallback(() => {
    if (!workspaceId || !sessionId) {
      return;
    }
    void api
      .inspectSessionLock({ workspaceId, sessionId })
      .then((result) => {
        if (activeRef.current) {
          setSnapshot(result);
        }
      })
      .catch(() => {
        if (activeRef.current) {
          setSnapshot(null);
        }
      });
  }, [api, workspaceId, sessionId]);

  useEffect(() => {
    activeRef.current = true;
    setError(null);
    refresh();
    const timer = setInterval(refresh, POLL_INTERVAL_MS);
    return () => {
      activeRef.current = false;
      clearInterval(timer);
    };
  }, [refresh]);

  const handleTakeOver = useCallback(() => {
    setClaiming(true);
    setError(null);
    void api
      .claimSession({ workspaceId, sessionId })
      .then((result) => {
        if (!activeRef.current) {
          return;
        }
        if (result.claimed) {
          setSnapshot({ status: "free" });
          onTakeOver();
        } else {
          setError(
            result.owner
              ? `Still driven by ${result.owner.kind} (pid ${result.owner.pid}). Quit it first.`
              : "Could not take over the session.",
          );
          refresh();
        }
      })
      .catch((cause: unknown) => {
        if (activeRef.current) {
          setError(cause instanceof Error ? cause.message : "Could not take over the session.");
        }
      })
      .finally(() => {
        if (activeRef.current) {
          setClaiming(false);
        }
      });
  }, [api, workspaceId, sessionId, onTakeOver, refresh]);

  if (!snapshot || snapshot.status !== "foreign") {
    return null;
  }

  const canTakeOver = !snapshot.alive;

  return (
    <div className="session-lock-banner" role="status" data-testid="session-lock-banner">
      <span className="session-lock-banner__text">
        {snapshot.alive
          ? `This thread is being driven by ${ownerLabel(snapshot)}. Quit it to take over.`
          : `${ownerLabel(snapshot)} left this thread inactive. You can take it over.`}
      </span>
      {error ? <span className="session-lock-banner__error">{error}</span> : null}
      {canTakeOver ? (
        <button
          type="button"
          className="session-lock-banner__action"
          data-testid="session-lock-take-over"
          onClick={handleTakeOver}
          disabled={claiming}
        >
          {claiming ? "Taking over…" : "Take over"}
        </button>
      ) : null}
    </div>
  );
}

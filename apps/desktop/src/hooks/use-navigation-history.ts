import { useCallback, useEffect, useRef } from "react";
import type { AppView, DesktopAppState } from "../desktop-state";

/**
 * A single navigation location — what `Cmd+[` / `Cmd+]` cycle through.
 *
 * Only fields that represent "where you are" in the app shell. Composer drafts,
 * scroll position, modal overlays (diff panel, terminal, thread search) are
 * intentionally excluded.
 */
export interface NavigationEntry {
  readonly activeView: AppView;
  readonly selectedWorkspaceId: string;
  readonly selectedSessionId: string;
}

export interface NavigateTarget {
  readonly activeView: AppView;
  readonly workspaceId: string;
  readonly sessionId: string;
}

function entryFromSnapshot(snapshot: DesktopAppState): NavigationEntry {
  return {
    activeView: snapshot.activeView,
    selectedWorkspaceId: snapshot.selectedWorkspaceId,
    selectedSessionId: snapshot.selectedSessionId,
  };
}

function entriesEqual(a: NavigationEntry, b: NavigationEntry): boolean {
  return (
    a.activeView === b.activeView &&
    a.selectedWorkspaceId === b.selectedWorkspaceId &&
    a.selectedSessionId === b.selectedSessionId
  );
}

export interface NavigationHistory {
  /** Go back one entry. Returns the entry to navigate to, or null if at start. */
  readonly goBack: () => NavigationEntry | null;
  /** Go forward one entry. Returns the entry to navigate to, or null if at end. */
  readonly goForward: () => NavigationEntry | null;
}

/**
 * Tracks browser-style back/forward history of the snapshot's navigation
 * fields. Pushes a new entry whenever the snapshot's location changes outside
 * of a back/forward action.
 */
export function useNavigationHistory(snapshot: DesktopAppState | null): NavigationHistory {
  const stackRef = useRef<NavigationEntry[]>([]);
  const cursorRef = useRef<number>(-1);
  // When set, the next snapshot change is the result of a back/forward — don't
  // push it.
  const suppressNextPushRef = useRef<NavigationEntry | null>(null);

  useEffect(() => {
    if (!snapshot) {
      return;
    }
    const next = entryFromSnapshot(snapshot);

    // Empty history: seed with the first observed location.
    if (cursorRef.current === -1) {
      stackRef.current = [next];
      cursorRef.current = 0;
      return;
    }

    const current = stackRef.current[cursorRef.current];
    if (current && entriesEqual(current, next)) {
      // No change in navigation identity (snapshot can update for other
      // reasons like composer draft, runtime updates, etc).
      return;
    }

    // If this change is the result of a back/forward navigation we just
    // dispatched, swallow it instead of pushing.
    if (suppressNextPushRef.current && entriesEqual(suppressNextPushRef.current, next)) {
      suppressNextPushRef.current = null;
      return;
    }

    // Browser-style: navigating after going back truncates the forward stack.
    const truncated = stackRef.current.slice(0, cursorRef.current + 1);
    truncated.push(next);
    stackRef.current = truncated;
    cursorRef.current = truncated.length - 1;
  }, [snapshot]);

  const goBack = useCallback((): NavigationEntry | null => {
    if (cursorRef.current <= 0) {
      return null;
    }
    cursorRef.current -= 1;
    const target = stackRef.current[cursorRef.current];
    if (!target) {
      return null;
    }
    suppressNextPushRef.current = target;
    return target;
  }, []);

  const goForward = useCallback((): NavigationEntry | null => {
    if (cursorRef.current >= stackRef.current.length - 1) {
      return null;
    }
    cursorRef.current += 1;
    const target = stackRef.current[cursorRef.current];
    if (!target) {
      return null;
    }
    suppressNextPushRef.current = target;
    return target;
  }, []);

  return { goBack, goForward };
}

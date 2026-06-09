/**
 * SubagentSessionPanel — right-rail read-only viewer for a subagent's session.
 *
 * Renders a subagent's persisted `.jsonl` session in the same
 * `ConversationTimeline` used for live threads, so the user can watch what a
 * spawned agent is doing. Read-only: no composer, no steering. Polls the
 * session file while open so it tracks a still-running subagent.
 *
 * Follows the AdvisorPanel right-rail pattern (aside, grid-column: 2).
 */

import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { PiDesktopApi } from "./ipc";
import type { TranscriptMessage } from "./timeline-types";
import type { ConversationTimeline } from "./conversation-timeline";
import { useThreadSearch } from "./hooks/use-thread-search";
import { subagentEntriesToTranscript } from "./subagent-session-converter";
import { CloseIcon } from "./icons";

/** Callback that opens the subagent session panel for a given session file. */
type OpenSubagentSession = (sessionFile: string, name: string) => void;

const SubagentSessionOpenContext = createContext<OpenSubagentSession | null>(null);

export function SubagentSessionOpenProvider({
  value,
  children,
}: {
  readonly value: OpenSubagentSession;
  readonly children: React.ReactNode;
}) {
  return (
    <SubagentSessionOpenContext.Provider value={value}>{children}</SubagentSessionOpenContext.Provider>
  );
}

/** Hook for subagent cards to open the read-only session panel. */
export function useOpenSubagentSession(): OpenSubagentSession | null {
  return useContext(SubagentSessionOpenContext);
}

interface SubagentSessionPanelProps {
  readonly sessionFile: string;
  readonly name: string;
  readonly api: PiDesktopApi;
  readonly onClose: () => void;
  readonly ConversationTimelineComponent: typeof ConversationTimeline;
}

export function SubagentSessionPanel({ sessionFile, name, api, onClose, ConversationTimelineComponent }: SubagentSessionPanelProps) {
  const [transcript, setTranscript] = useState<readonly TranscriptMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const paneRef = useRef<HTMLDivElement | null>(null);
  const threadSearch = useThreadSearch(paneRef);

  useEffect(() => {
    if (!sessionFile) return;
    let active = true;
    setLoading(true);
    const poll = async () => {
      try {
        const entries = await api.getSubagentSessionEntries(sessionFile);
        if (!active) return;
        setTranscript(subagentEntriesToTranscript(entries));
      } catch {
        // ignore — file may not exist yet for a freshly-launched subagent
      } finally {
        if (active) setLoading(false);
      }
    };
    void poll();
    const interval = setInterval(poll, 2000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [sessionFile, api]);

  return (
    <aside className="subagent-session-panel">
      <div className="subagent-session-panel__header">
        <h2 className="subagent-session-panel__title" title={sessionFile}>
          {name || "Subagent"}
        </h2>
        <span className="subagent-session-panel__badge">read-only</span>
        <button className="icon-button" type="button" onClick={onClose} aria-label="Close subagent session">
          <CloseIcon />
        </button>
      </div>
      <div className="subagent-session-panel__body">
        <ConversationTimelineComponent
          transcript={transcript}
          isTranscriptLoading={loading && transcript.length === 0}
          timelinePaneRef={paneRef}
          onTimelineScroll={() => {}}
          threadSearch={threadSearch}
          showJumpToLatest={false}
          onJumpToLatest={() => {}}
          onContentHeightChange={() => {}}
          isRunning={false}
        />
      </div>
    </aside>
  );
}

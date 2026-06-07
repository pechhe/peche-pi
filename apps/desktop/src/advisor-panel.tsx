/**
 * AdvisorPanel — right-rail panel for the advisor side panel.
 *
 * Renders a mini conversation timeline + simple composer for the advisor
 * session. Follows the DiffPanel right-rail pattern (aside element,
 * grid-column: 2, grid-row: 2 / -1).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { PiDesktopApi } from "./ipc";
import type { HandoffScope } from "./ipc";
import type { TranscriptMessage } from "./desktop-state";
import type { AdvisorPanelStatus } from "./advisor-handoff-controller";
import { CloseIcon } from "./icons";

interface AdvisorPanelProps {
  readonly visible: boolean;
  readonly advisorSessionId: string;
  readonly sourceSessionId: string;
  readonly sourceWorkspaceId: string;
  readonly status: AdvisorPanelStatus;
  readonly scope: HandoffScope;
  readonly tokenEstimate: number;
  readonly errorMessage?: string;
  readonly api: PiDesktopApi;
  readonly onClose: () => void;
  readonly onHandBack: (text: string) => void;
  readonly onPromoteToThread: () => void;
  readonly onScopeChange: (scope: HandoffScope) => void;
  readonly onReloadPayload: () => void;
}

const SCOPE_LABELS: Record<HandoffScope, string> = {
  compressed: "Compressed",
  full: "Full",
  plan: "Plan",
  selection: "Selection",
};

export function AdvisorPanel({
  visible,
  advisorSessionId,
  sourceSessionId: _sourceSessionId,
  sourceWorkspaceId,
  status,
  scope,
  tokenEstimate,
  errorMessage,
  api,
  onClose,
  onHandBack,
  onPromoteToThread,
  onScopeChange,
  onReloadPayload,
}: AdvisorPanelProps) {
  const [transcript, setTranscript] = useState<readonly TranscriptMessage[]>([]);
  const [inputText, setInputText] = useState("");
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const [isRunning, _setIsRunning] = useState(false);

  // Subscribe to the advisor session's transcript
  useEffect(() => {
    if (!visible || !advisorSessionId || !sourceWorkspaceId) return;

    let active = true;
    const poll = async () => {
      try {
        const tx = await api.getSessionTranscript(sourceWorkspaceId, advisorSessionId);
        if (active) setTranscript(tx);
      } catch {
        // ignore
      }
    };
    void poll();
    const interval = setInterval(poll, 2000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [visible, advisorSessionId, sourceWorkspaceId, api]);

  // Auto-scroll on new transcript
  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [transcript]);

  const handleSend = useCallback(async () => {
    if (!inputText.trim() || !advisorSessionId || !sourceWorkspaceId) return;
    setInputText("");
    try {
      // Select the advisor session, send message to it
      await api.selectSession({ workspaceId: sourceWorkspaceId, sessionId: advisorSessionId });
      await api.submitComposer(inputText.trim());
    } catch {
      // ignore
    }
  }, [inputText, advisorSessionId, sourceWorkspaceId, api]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void handleSend();
      }
    },
    [handleSend],
  );

  const handleHandBackLastMessage = useCallback(() => {
    // Find the last assistant message in the transcript
    for (let i = transcript.length - 1; i >= 0; i--) {
      const msg = transcript[i];
      if (!msg) continue;
      if ("kind" in msg && msg.kind === "message" && "role" in msg && (msg as { role: string }).role === "assistant") {
        const text = "text" in msg ? (msg as { text: string }).text : "";
        if (text) {
          onHandBack(text);
          return;
        }
      }
    }
  }, [transcript, onHandBack]);

  if (!visible) return null;

  const isLoading = status === "loading";
  const isError = status === "error";

  return (
    <aside className="advisor-panel">
      {/* Header */}
      <div className="advisor-panel__header">
        <h2 className="advisor-panel__title">Advisor</h2>
        <div className="advisor-panel__scope-group">
          {(["compressed", "full", "plan"] as const).map((s) => (
            <button
              key={s}
              className={`advisor-panel__scope-btn ${scope === s ? "advisor-panel__scope-btn--active" : ""}`}
              onClick={() => onScopeChange(s)}
              disabled={isLoading}
              title={`Send ${SCOPE_LABELS[s].toLowerCase()} context`}
            >
              {SCOPE_LABELS[s]}
            </button>
          ))}
        </div>
        {tokenEstimate > 0 && (
          <span className="advisor-panel__tokens" title="Estimated tokens">
            ~{tokenEstimate.toLocaleString()} tok
          </span>
        )}
        <button
          className="icon-button"
          type="button"
          onClick={onClose}
          aria-label="Close advisor"
        >
          <CloseIcon />
        </button>
      </div>

      {/* Transcript area */}
      <div className="advisor-panel__transcript" ref={transcriptRef}>
        {isLoading && (
          <div className="advisor-panel__loading">
            <div className="advisor-panel__spinner" />
            <span>Preparing advisor context…</span>
          </div>
        )}
        {isError && (
          <div className="advisor-panel__error">
            <p>{errorMessage || "Failed to start advisor"}</p>
            <button className="advisor-panel__retry-btn" onClick={onReloadPayload}>
              Retry
            </button>
          </div>
        )}
        {!isLoading && !isError && transcript.length === 0 && (
          <div className="advisor-panel__empty">
            <p>Advisor is ready. Your conversation context has been shared.</p>
          </div>
        )}
        {transcript.map((msg) => {
          if (!msg || !("kind" in msg) || msg.kind !== "message") return null;
          const m = msg as { id: string; role?: string; text?: string };
          if (!m.text) return null;
          return (
            <div
              key={m.id}
              className={`advisor-panel__message advisor-panel__message--${m.role ?? "unknown"}`}
            >
              <div className="advisor-panel__message-role">
                {m.role === "user" ? "You" : "Advisor"}
              </div>
              <div className="advisor-panel__message-text">{m.text}</div>
            </div>
          );
        })}
        {isRunning && (
          <div className="advisor-panel__message advisor-panel__message--assistant">
            <div className="advisor-panel__message-role">Advisor</div>
            <div className="advisor-panel__message-text advisor-panel__thinking">
              Thinking…
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="advisor-panel__actions">
        <button
          className="advisor-panel__action-btn"
          onClick={handleHandBackLastMessage}
          disabled={transcript.length === 0 || isLoading}
          title="Send the advisor's last answer to your main composer as a draft"
        >
          ↩ Hand back
        </button>
        <button
          className="advisor-panel__action-btn"
          onClick={onPromoteToThread}
          disabled={!advisorSessionId || isLoading}
          title="Open this advisor session as its own thread"
        >
          ↗ Open as thread
        </button>
      </div>

      {/* Composer */}
      <div className="advisor-panel__composer">
        <textarea
          className="advisor-panel__input"
          placeholder="Ask the advisor a follow-up…"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={2}
          disabled={isLoading || isError}
        />
        <button
          className="advisor-panel__send-btn"
          onClick={() => void handleSend()}
          disabled={!inputText.trim() || isLoading || isError}
        >
          Send
        </button>
      </div>
    </aside>
  );
}

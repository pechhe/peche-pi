import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import type { SessionExtensionTerminalCustomRecord } from "./desktop-state";

const COLS = 80;

interface TerminalCustomOverlayProps {
  readonly request: SessionExtensionTerminalCustomRecord;
  /** Forward a raw terminal keystroke sequence to the live extension component. */
  readonly onInput: (requestId: string, data: string) => void;
}

/**
 * Renders a terminal-only extension `custom` component (bridged from the
 * supervisor) into an xterm surface. The supervisor drives render() and streams
 * its output lines here; xterm parses the ANSI and emits keystrokes via onData,
 * which we forward back as `terminalInput`. Cancellation (esc) is handled by the
 * extension component itself — it receives the keystroke and calls done().
 */
export function TerminalCustomOverlay({ request, onInput }: TerminalCustomOverlayProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  // Keep the latest requestId/onInput for the (stable, create-once) handler so
  // the xterm instance is never torn down by App re-renders during streaming.
  const requestIdRef = useRef(request.requestId);
  requestIdRef.current = request.requestId;
  const onInputRef = useRef(onInput);
  onInputRef.current = onInput;

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }
    const term = new Terminal({
      cols: COLS,
      rows: 1,
      convertEol: true,
      cursorBlink: false,
      disableStdin: false,
      fontSize: 13,
      theme: { background: "#1e1e1e" },
    });
    term.open(containerRef.current);
    term.focus();
    const sub = term.onData((data) => onInputRef.current(requestIdRef.current, data));
    terminalRef.current = term;
    return () => {
      sub.dispose();
      term.dispose();
      terminalRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- create xterm once; latest onInput/requestId read via refs
  }, []);

  // Repaint the full frame whenever the supervisor streams new lines. While
  // busy (between screens) we keep the last frame so it can sit dimmed under
  // the spinner instead of clearing to black.
  useEffect(() => {
    const term = terminalRef.current;
    if (!term || request.busy) {
      return;
    }
    term.resize(COLS, Math.max(request.lines.length, 1));
    term.reset();
    term.write(request.lines.join("\r\n"));
  }, [request.lines, request.busy]);

  return (
    <div className="extension-dialog-backdrop">
      <div className="terminal-custom-overlay" role="dialog" aria-label={request.title ?? "Extension UI"}>
        <div
          ref={containerRef}
          className={`terminal-custom-overlay__viewport${request.busy ? " terminal-custom-overlay__viewport--busy" : ""}`}
        />
        {request.busy ? (
          <div className="terminal-custom-overlay__spinner" role="status" aria-live="polite">
            <span className="terminal-custom-overlay__spinner-dot" />
            <span>Working…</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

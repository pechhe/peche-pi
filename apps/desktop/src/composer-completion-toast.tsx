import { useEffect, useState } from "react";

export type CompletionToastVariant = "completion" | "failure";

export interface ThreadCompletePayload {
  readonly variant: CompletionToastVariant;
  readonly title: string;
  readonly workspaceId: string;
  readonly sessionId: string;
}

/**
 * In-app "thread finished" notification protocol. The detector (App.tsx) fires
 * `pi:thread-complete` with a ThreadCompletePayload; the singleton
 * `<ComposerCompletionToastHost />` (mounted inside the composer footer) slides
 * a toast up out of the top of the composer, plays a chime, and on click fires
 * `pi:open-session` so App.tsx can navigate to the finished thread.
 */
export const THREAD_COMPLETE_EVENT = "pi:thread-complete";
export const OPEN_SESSION_EVENT = "pi:open-session";

export interface OpenSessionDetail {
  readonly workspaceId: string;
  readonly sessionId: string;
}

export function notifyThreadComplete(payload: ThreadCompletePayload): void {
  window.dispatchEvent(new CustomEvent<ThreadCompletePayload>(THREAD_COMPLETE_EVENT, { detail: payload }));
}

const AUTO_DISMISS_MS = 6000;

interface ActiveCompletionToast extends ThreadCompletePayload {
  readonly id: number;
}

export function ComposerCompletionToastHost() {
  const [toast, setToast] = useState<ActiveCompletionToast | null>(null);

  useEffect(() => {
    let nextId = 0;
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<ThreadCompletePayload>).detail;
      if (!detail) return;
      nextId += 1;
      setToast({ ...detail, id: nextId });
      playCompletionChime(detail.variant);
    };
    window.addEventListener(THREAD_COMPLETE_EVENT, handler);
    return () => window.removeEventListener(THREAD_COMPLETE_EVENT, handler);
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const handle = window.setTimeout(() => {
      setToast((current) => (current && current.id === toast.id ? null : current));
    }, AUTO_DISMISS_MS);
    return () => window.clearTimeout(handle);
  }, [toast]);

  if (!toast) return null;

  const openThread = () => {
    window.dispatchEvent(
      new CustomEvent<OpenSessionDetail>(OPEN_SESSION_EVENT, {
        detail: { workspaceId: toast.workspaceId, sessionId: toast.sessionId },
      }),
    );
    setToast(null);
  };

  return (
    <div className={`composer-completion-toast composer-completion-toast--${toast.variant}`} role="status">
      <button className="composer-completion-toast__open" type="button" onClick={openThread}>
        <span className="composer-completion-toast__icon" aria-hidden="true">
          {toast.variant === "failure" ? (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="8" fill="var(--error-ink)" />
              <path d="M5.5 5.5L10.5 10.5M10.5 5.5L5.5 10.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="8" fill="var(--accent)" />
              <path d="M4.5 8.5L6.5 10.5L11.5 5.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </span>
        <span className="composer-completion-toast__body">
          <span className="composer-completion-toast__label">
            {toast.variant === "failure" ? "Thread failed" : "Thread finished"}
          </span>
          <span className="composer-completion-toast__title">{toast.title}</span>
        </span>
      </button>
      <button
        aria-label="Dismiss"
        className="composer-completion-toast__close"
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setToast(null);
        }}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M3 3L9 9M9 3L3 9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

/* ── Completion chime (WebAudio, no asset) ─────────────────── */

let sharedAudioContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  const Ctor =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!sharedAudioContext) {
    sharedAudioContext = new Ctor();
  }
  return sharedAudioContext;
}

function playCompletionChime(variant: CompletionToastVariant): void {
  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state === "suspended") {
    void ctx.resume();
  }
  // Completion: a soft rising two-note chime. Failure: a single lower tone.
  const notes = variant === "failure" ? [311.13] : [659.25, 987.77];
  const now = ctx.currentTime;
  notes.forEach((frequency, index) => {
    const start = now + index * 0.12;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.12, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.45);
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start(start);
    oscillator.stop(start + 0.5);
  });
}

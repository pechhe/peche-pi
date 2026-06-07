import { showToast } from "./toast";

export type CompletionToastVariant = "completion" | "failure";

export interface ThreadCompletePayload {
  readonly variant: CompletionToastVariant;
  readonly title: string;
  readonly workspaceId: string;
  readonly sessionId: string;
}

export const OPEN_SESSION_EVENT = "pi:open-session";

export interface OpenSessionDetail {
  readonly workspaceId: string;
  readonly sessionId: string;
}

/**
 * In-app "thread finished" notification. Fires a unified toast with
 * click-to-navigate and plays a subtle chime.
 */
export function notifyThreadComplete(payload: ThreadCompletePayload): void {
  showToast({
    variant: payload.variant === "failure" ? "error" : "success",
    message: payload.variant === "failure" ? "Thread failed" : "Thread finished",
    secondary: payload.title,
    autoDismissMs: 6000,
    onClick: () => {
      window.dispatchEvent(
        new CustomEvent<OpenSessionDetail>(OPEN_SESSION_EVENT, {
          detail: { workspaceId: payload.workspaceId, sessionId: payload.sessionId },
        }),
      );
    },
  });
  playCompletionChime(payload.variant);
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

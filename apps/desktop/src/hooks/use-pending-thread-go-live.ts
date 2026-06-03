import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { SelectedTranscriptRecord, TranscriptMessage, ComposerAttachment } from "../desktop-state";
import type { CavemanLevel } from "../ipc";
import type { ComposerMode } from "../composer-mode";
import { markUserMessagesAnimated } from "../timeline-item";

// ---------------------------------------------------------------------------
// Pending-thread go-live: captures the user's prompt + attachments at submit,
// renders an optimistic single-bubble transcript and a "Preparing your
// thread…" label, then slides the real composer into place once the session
// transcript arrives, cleaning up the placeholder.  A 6 s safety net prevents
// an indefinite stuck placeholder.
// ---------------------------------------------------------------------------

export const PENDING_USER_MESSAGE_ID = "__pending_user_message__";

const COMPOSER_SLIDE_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";
const COMPOSER_SLIDE_MS = 280;

function runComposerSlide(fromRect: DOMRect): void {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return;
  }
  const el = document.querySelector("footer.composer") as HTMLElement | null;
  if (!el) {
    return;
  }
  const toRect = el.getBoundingClientRect();
  const dx = fromRect.left + fromRect.width / 2 - (toRect.left + toRect.width / 2);
  const dy = fromRect.top - toRect.top;
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1) {
    return;
  }
  el.style.transition = "none";
  el.style.transform = `translate(${dx}px, ${dy}px)`;
  void el.offsetHeight;
  requestAnimationFrame(() => {
    el.style.transition = `transform ${COMPOSER_SLIDE_MS}ms ${COMPOSER_SLIDE_EASING}`;
    el.style.transform = "translate(0px, 0px)";
    const cleanup = (event: TransitionEvent) => {
      if (event.propertyName !== "transform") {
        return;
      }
      el.style.transition = "";
      el.style.transform = "";
      el.removeEventListener("transitionend", cleanup);
    };
    el.addEventListener("transitionend", cleanup);
  });
}

export interface PendingThreadStart {
  readonly rootWorkspaceId: string;
  readonly title: string;
  readonly sessionId?: string;
  readonly workspaceId?: string;
  readonly createdAt: string;
  readonly prompt: string;
  readonly attachments: readonly ComposerAttachment[];
  readonly provider: string | undefined;
  readonly modelId: string | undefined;
  readonly thinkingLevel: string | undefined;
  readonly cavemanLevel: CavemanLevel;
  readonly composerMode: ComposerMode;
}

export interface PendingThreadGoLiveResult {
  pendingThreadStart: PendingThreadStart | null;
  setPendingThreadStart: Dispatch<SetStateAction<PendingThreadStart | null>>;
  pendingOptimisticTranscript: readonly TranscriptMessage[] | null;
  threadViewTranscript: readonly TranscriptMessage[];
  threadViewIsRunning: boolean;
  composerFlipFromRef: React.RefObject<DOMRect | null>;
}

export function usePendingThreadGoLive(
  selectedTranscript: SelectedTranscriptRecord | null,
  selectedSession: { readonly status: string } | undefined,
  visibleTranscript: readonly TranscriptMessage[],
  composerRef: RefObject<HTMLTextAreaElement | null>,
): PendingThreadGoLiveResult {
  const [pendingThreadStart, setPendingThreadStart] = useState<PendingThreadStart | null>(null);
  const composerFlipFromRef = useRef<DOMRect | null>(null);

  // Optimistic transcript: a single user bubble while the thread is being
  // created, so going live is a label swap, not a full remount.
  const pendingOptimisticTranscript = useMemo<readonly TranscriptMessage[] | null>(() => {
    if (!pendingThreadStart) {
      return null;
    }
    const attachments = pendingThreadStart.attachments.map((attachment) =>
      attachment.kind === "image"
        ? { kind: "image" as const, mimeType: attachment.mimeType, data: attachment.data, name: attachment.name }
        : {
            kind: "file" as const,
            name: attachment.name,
            mimeType: attachment.mimeType,
            fsPath: attachment.fsPath,
            ...(attachment.sizeBytes != null ? { sizeBytes: attachment.sizeBytes } : {}),
          },
    );
    return [
      {
        kind: "message" as const,
        role: "user" as const,
        id: PENDING_USER_MESSAGE_ID,
        createdAt: pendingThreadStart.createdAt,
        text: pendingThreadStart.prompt,
        ...(attachments.length > 0 ? { attachments } : {}),
      },
    ];
  }, [pendingThreadStart]);

  const threadViewTranscript =
    pendingThreadStart && pendingOptimisticTranscript ? pendingOptimisticTranscript : visibleTranscript;
  const threadViewIsRunning = pendingThreadStart ? true : selectedSession?.status === "running";

  // Hold the placeholder until the transcript arrives with the user message.
  const pendingSessionId = pendingThreadStart?.sessionId;
  const pendingWorkspaceId = pendingThreadStart?.workspaceId;
  useEffect(() => {
    if (!pendingSessionId || !pendingWorkspaceId || !selectedTranscript) {
      return;
    }
    if (
      selectedTranscript.workspaceId !== pendingWorkspaceId ||
      selectedTranscript.sessionId !== pendingSessionId
    ) {
      return;
    }
    const userMessageIds = selectedTranscript.transcript
      .filter((item) => item.kind === "message" && item.role === "user")
      .map((item) => item.id);
    if (userMessageIds.length === 0) {
      return;
    }
    markUserMessagesAnimated(userMessageIds);
    setPendingThreadStart(null);
    window.requestAnimationFrame(() => {
      composerRef.current?.focus();
    });
  }, [pendingSessionId, pendingWorkspaceId, selectedTranscript, composerRef]);

  // Safety net: if transcript never arrives, clear placeholder after 6 s.
  useEffect(() => {
    if (!pendingSessionId) {
      return undefined;
    }
    const timer = window.setTimeout(() => setPendingThreadStart(null), 6000);
    return () => window.clearTimeout(timer);
  }, [pendingSessionId]);

  // Slide composer from new-thread position to footer.
  const pendingThreadActive = Boolean(pendingThreadStart);
  useLayoutEffect(() => {
    if (!pendingThreadActive) {
      return;
    }
    const fromRect = composerFlipFromRef.current;
    composerFlipFromRef.current = null;
    if (fromRect) {
      runComposerSlide(fromRect);
    }
  }, [pendingThreadActive]);

  return {
    pendingThreadStart,
    setPendingThreadStart,
    pendingOptimisticTranscript,
    threadViewTranscript,
    threadViewIsRunning,
    composerFlipFromRef,
  };
}

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { Dispatch, SetStateAction } from "react";
import type {
  SelectedTranscriptRecord,
  TranscriptMessage,
  ComposerAttachment,
  ThreadTransitionMotion,
  ThreadTransitionSettings,
} from "../desktop-state";
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

const PENDING_USER_MESSAGE_ID = "__pending_user_message__";

// Option 1 — "Curve": easeOutExpo launches at full speed, then lands slowly.
// Longer than the old 280ms so the slow tail is actually visible.
const COMPOSER_CURVE_EASING = "cubic-bezier(0.16, 1, 0.3, 1)";
const COMPOSER_CURVE_MS = 440;

// "Dock": a shaped linear() easing — far more extreme than any cubic-bezier can
// be (a bezier tail can't get flatter than P2=(0,1)). A brief ramp, then an
// explosive launch that covers ~90% of the distance in the first ~28% of the
// time, then a long slow crawl that eases into the dock over the remaining tail.
const COMPOSER_DOCK_EASING =
  "linear(0, 0.06 3%, 0.55 9%, 0.85 16%, 0.95 24%, 0.98 38%, 0.992 55%, 0.998 78%, 1)";
const COMPOSER_DOCK_MS = 1100;

// Option 3 — hero (logo + title) lift-and-fade as the composer departs.
const HERO_EXIT_MS = 260;

// Option 4 — keep the bubble-handoff body class alive a touch past the bubble
// entrance (≈520ms) so a fast go-live doesn't cut the animation short.
const HANDOFF_BODY_CLASS = "pi-thread-handoff";
const HANDOFF_BODY_CLASS_MS = 760;

const DEFAULT_THREAD_TRANSITION: ThreadTransitionSettings = {
  motion: "curve",
  heroExit: false,
  bubbleHandoff: false,
};

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export interface HeroFlipCapture {
  readonly rect: DOMRect;
  readonly node: HTMLElement;
}

/** Snapshot the centered hero so it can be animated out after it unmounts. */
export function captureHeroFlip(): HeroFlipCapture | null {
  const hero = document.querySelector(".new-thread__hero") as HTMLElement | null;
  if (!hero) {
    return null;
  }
  return { rect: hero.getBoundingClientRect(), node: hero.cloneNode(true) as HTMLElement };
}

function runComposerSlide(fromRect: DOMRect, motion: ThreadTransitionMotion): void {
  if (motion === "off" || prefersReducedMotion()) {
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
  // Hide the footer until the slide animation's first frame so there's no
  // flash of the footer at the hero position (even a single-frame mismatch
  // between the departing hero and the arriving footer is visible).
  el.style.opacity = "0";
  if (motion === "spring") {
    runSpringSlide(el, dx, dy);
  } else if (motion === "dock") {
    runCurveSlide(el, dx, dy, COMPOSER_DOCK_EASING, COMPOSER_DOCK_MS);
  } else {
    runCurveSlide(el, dx, dy, COMPOSER_CURVE_EASING, COMPOSER_CURVE_MS);
  }
}

function runCurveSlide(el: HTMLElement, dx: number, dy: number, easing: string, durationMs: number): void {
  el.style.transition = "none";
  el.style.transform = `translate(${dx}px, ${dy}px)`;
  el.style.opacity = "1";
  void el.offsetHeight;
  requestAnimationFrame(() => {
    el.style.transition = `transform ${durationMs}ms ${easing}`;
    el.style.transform = "translate(0px, 0px)";
    const cleanup = (event: TransitionEvent) => {
      if (event.propertyName !== "transform") {
        return;
      }
      el.style.transition = "";
      el.style.transform = "";
      el.style.opacity = "";
      el.removeEventListener("transitionend", cleanup);
    };
    el.addEventListener("transitionend", cleanup);
  });
}

// Option 5 — "Spring": numerically sample an underdamped spring into WAAPI
// keyframes so it settles with a subtle, physical overshoot. Sampling keeps it
// independent of CSS `linear()` easing support.
function runSpringSlide(el: HTMLElement, dx: number, dy: number): void {
  const { keyframes, duration } = buildSpringKeyframes(dx, dy);
  // Apply the start offset synchronously so there's no one-frame flash at the
  // docked position before the animation commits its first keyframe.
  el.style.transform = `translate(${dx}px, ${dy}px)`;
  const animation = el.animate(keyframes, { duration, easing: "linear" });
  const finish = () => {
    el.style.transform = "";
    el.style.opacity = "";
  };
  animation.onfinish = finish;
  animation.oncancel = finish;
}

function buildSpringKeyframes(dx: number, dy: number): { keyframes: Keyframe[]; duration: number } {
  // Underdamped (damping ratio ≈ 0.52) so it visibly overshoots and settles
  // back — a generic high-damping value just reads as a smooth, uniform glide.
  const stiffness = 240;
  const damping = 16;
  const mass = 1;
  const stepMs = 1000 / 120;
  const stepS = stepMs / 1000;
  let displacement = 1; // 1 = full start offset, 0 = docked.
  let velocity = 0;
  const samples: number[] = [displacement];
  let elapsed = 0;
  const maxMs = 1400;
  while (elapsed < maxMs) {
    const accel = (-stiffness * displacement - damping * velocity) / mass;
    velocity += accel * stepS;
    displacement += velocity * stepS;
    elapsed += stepMs;
    samples.push(displacement);
    if (Math.abs(displacement) < 0.0015 && Math.abs(velocity) < 0.0015) {
      break;
    }
  }
  samples.push(0);
  const keyframes = samples.map((sample) => ({
    transform: `translate(${dx * sample}px, ${dy * sample}px)`,
    opacity: 1,
  }));
  return { keyframes, duration: Math.max(elapsed, stepMs) };
}

function runHeroExit(capture: HeroFlipCapture): void {
  if (prefersReducedMotion()) {
    return;
  }
  const { rect, node } = capture;
  const overlay = document.createElement("div");
  overlay.setAttribute("aria-hidden", "true");
  overlay.style.position = "fixed";
  overlay.style.left = `${rect.left}px`;
  overlay.style.top = `${rect.top}px`;
  overlay.style.width = `${rect.width}px`;
  overlay.style.height = `${rect.height}px`;
  overlay.style.margin = "0";
  overlay.style.pointerEvents = "none";
  overlay.style.zIndex = "40";
  node.style.margin = "0";
  overlay.appendChild(node);
  document.body.appendChild(overlay);
  const animation = overlay.animate(
    [
      { transform: "translateY(0)", opacity: 1 },
      { transform: "translateY(-16px)", opacity: 0 },
    ],
    { duration: HERO_EXIT_MS, easing: "cubic-bezier(0.4, 0, 1, 1)", fill: "forwards" },
  );
  const cleanup = () => overlay.remove();
  animation.onfinish = cleanup;
  animation.oncancel = cleanup;
}

export interface PendingThreadStart {
  readonly rootWorkspaceId: string;
  readonly title: string;
  readonly sessionId?: string;
  readonly workspaceId?: string;
  /**
   * The selected session id at submit time. Used by the sidebar to detect the
   * moment the real session materialises in the snapshot (a live-update can
   * deliver it before `sessionId` is set) so the optimistic placeholder row is
   * swapped out cleanly instead of briefly coexisting with the real row.
   */
  readonly priorSelectedSessionId?: string;
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
  heroFlipFromRef: React.RefObject<HeroFlipCapture | null>;
}

export function usePendingThreadGoLive(
  selectedTranscript: SelectedTranscriptRecord | null,
  selectedSession: { readonly status: string } | undefined,
  visibleTranscript: readonly TranscriptMessage[],
  composerRef: RefObject<HTMLTextAreaElement | null>,
  threadTransition?: ThreadTransitionSettings,
): PendingThreadGoLiveResult {
  const [pendingThreadStart, setPendingThreadStart] = useState<PendingThreadStart | null>(null);
  const composerFlipFromRef = useRef<DOMRect | null>(null);
  const heroFlipFromRef = useRef<HeroFlipCapture | null>(null);
  const settings = threadTransition ?? DEFAULT_THREAD_TRANSITION;
  const { motion, heroExit, bubbleHandoff } = settings;

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

  // Choreograph the go-live: slide the composer from the new-thread position to
  // the footer, optionally animate the hero out, and arm the bubble handoff.
  const pendingThreadActive = Boolean(pendingThreadStart);
  useLayoutEffect(() => {
    if (!pendingThreadActive) {
      return undefined;
    }
    const fromRect = composerFlipFromRef.current;
    composerFlipFromRef.current = null;
    const heroCapture = heroFlipFromRef.current;
    heroFlipFromRef.current = null;

    if (fromRect) {
      runComposerSlide(fromRect, motion);
    }
    if (motion === "off") {
      return undefined;
    }
    if (heroExit && heroCapture) {
      runHeroExit(heroCapture);
    }
    if (bubbleHandoff && !prefersReducedMotion()) {
      document.body.classList.add(HANDOFF_BODY_CLASS);
      const timer = window.setTimeout(() => {
        document.body.classList.remove(HANDOFF_BODY_CLASS);
      }, HANDOFF_BODY_CLASS_MS);
      return () => {
        window.clearTimeout(timer);
        document.body.classList.remove(HANDOFF_BODY_CLASS);
      };
    }
    return undefined;
  }, [pendingThreadActive, motion, heroExit, bubbleHandoff]);

  return {
    pendingThreadStart,
    setPendingThreadStart,
    pendingOptimisticTranscript,
    threadViewTranscript,
    threadViewIsRunning,
    composerFlipFromRef,
    heroFlipFromRef,
  };
}

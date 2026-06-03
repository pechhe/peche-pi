import { useEffect, useRef, useState } from "react";

interface LoadingBarProps {
  loading: boolean;
}

type Phase = "idle" | "accelerating" | "creeping" | "finishing" | "done";

const FAST_DURATION = 800; // ms: rapid acceleration to ~75%
const CREEP_INCREMENT = 0.3; // % per tick when creeping
const CREEP_INTERVAL = 200; // ms between creep ticks
const FINISH_DURATION = 280; // ms: snap from current → 100%
const FADE_DURATION = 220; // ms: fade out after reaching the end
const HIDE_DELAY = 400; // ms: hide element after finishing

export default function LoadingBar({ loading }: LoadingBarProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [fading, setFading] = useState(false);
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const creepTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const finishTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Phase 1: rapid acceleration
  useEffect(() => {
    if (!loading) return;

    setProgress(0);
    setPhase("accelerating");

    const start = performance.now();
    let raf: number;

    const tick = (now: number) => {
      const elapsed = now - start;
      // Ease-out curve: fast start, slowing down. Goes from 0 to ~75% over FAST_DURATION.
      const t = Math.min(elapsed / FAST_DURATION, 1);
      // Use a steep power curve: t^0.25 shoots up fast then tapers hard
      const eased = Math.pow(t, 0.25);
      const pct = eased * 75;
      setProgress(pct);

      if (t < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        setPhase("creeping");
      }
    };

    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
    };
  }, [loading]);

  // Phase 2: slow creep from 75% → 95%
  useEffect(() => {
    if (phase !== "creeping") return;

    creepTimerRef.current = setInterval(() => {
      setProgress((prev) => {
        const next = prev + CREEP_INCREMENT;
        return next >= 95 ? 95 : next;
      });
    }, CREEP_INTERVAL);

    return () => {
      if (creepTimerRef.current) {
        clearInterval(creepTimerRef.current);
        creepTimerRef.current = null;
      }
    };
  }, [phase]);

  // Phase 3: finish when loading → false
  useEffect(() => {
    if (loading || phase === "idle" || phase === "done") return;

    // Transition to finishing: drive the bar fully to the right first,
    // then fade it out once it has reached the end.
    setPhase("finishing");
    setFading(false);
    setProgress(100);

    fadeTimerRef.current = setTimeout(() => {
      setFading(true);
    }, FINISH_DURATION);

    finishTimerRef.current = setTimeout(() => {
      setPhase("done");
      setProgress(0);
      setFading(false);
    }, FINISH_DURATION + FADE_DURATION + HIDE_DELAY);

    return () => {
      if (finishTimerRef.current) {
        clearTimeout(finishTimerRef.current);
        finishTimerRef.current = null;
      }
      if (fadeTimerRef.current) {
        clearTimeout(fadeTimerRef.current);
        fadeTimerRef.current = null;
      }
    };
  }, [loading, phase]);

  // On unmount, clean up
  useEffect(() => {
    return () => {
      if (creepTimerRef.current) clearInterval(creepTimerRef.current);
      if (finishTimerRef.current) clearTimeout(finishTimerRef.current);
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
    };
  }, []);

  if (phase === "idle" || phase === "done") return null;

  const isFinishing = phase === "finishing";
  const transitionDuration = isFinishing
    ? `${FINISH_DURATION}ms`
    : phase === "accelerating"
      ? "120ms"
      : "200ms";

  return (
    <div
      className="canvas__loading-bar"
      role="progressbar"
      aria-label="Loading transcript"
      data-testid="transcript-loading-bar"
      data-fading={fading ? "true" : undefined}
      style={{ opacity: fading ? 0 : 1, transition: `opacity ${FADE_DURATION}ms ease-out` }}
    >
      <span
        className="canvas__loading-bar-indicator"
        style={{
          transform: `scaleX(${progress / 100})`,
          transition: `transform ${transitionDuration} ease-out`,
        }}
      >
        <span
          className="canvas__loading-bar-bloom"
          aria-hidden="true"
          style={{
            // counter the parent's scaleX so the bloom stays round, not squished
            transform: `scaleX(${progress > 0 ? 100 / progress : 1})`,
          }}
        />
      </span>
    </div>
  );
}

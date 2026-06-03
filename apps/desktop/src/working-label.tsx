import { useEffect, useRef, useState } from "react";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const FRAME_INTERVAL_MS = 80;

function useBrailleFrame(): string {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => {
      setFrame((f) => (f + 1) % SPINNER_FRAMES.length);
    }, FRAME_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, []);

  return SPINNER_FRAMES[frame]!;
}

/**
 * Same braille frames but driven by a ref + direct DOM mutation instead of
 * React state. Used by `WorkingSpinner` so the animation never stalls, even
 * while React is busy re-rendering other parts of the tree (e.g. streaming
 * a conversation response).
 */
function useBrailleFrameRef(): React.RefCallback<HTMLSpanElement> {
  const frameRef = useRef(0);
  const elRef = useRef<HTMLSpanElement | null>(null);
  const intervalRef = useRef<number | null>(null);

  const refCallback = useRef((el: HTMLSpanElement | null) => {
    // Clean up previous interval if element changes
    if (intervalRef.current !== null) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    elRef.current = el;
    if (el) {
      // Set initial glyph
      el.textContent = SPINNER_FRAMES[frameRef.current]!;
      intervalRef.current = window.setInterval(() => {
        frameRef.current = (frameRef.current + 1) % SPINNER_FRAMES.length;
        if (elRef.current) {
          elRef.current.textContent = SPINNER_FRAMES[frameRef.current]!;
        }
      }, FRAME_INTERVAL_MS);
    }
  }).current;

  useEffect(() => {
    return () => {
      if (intervalRef.current !== null) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, []);

  return refCallback;
}

export interface WorkingLabelProps {
  readonly label: string;
}

/**
 * Animated "Working…" indicator matching the pi TUI:
 *   - Braille spinner (10 frames @ 80ms) tinted with the theme accent.
 *   - Shimmer sweep across the label text.
 */
export function WorkingLabel({ label }: WorkingLabelProps) {
  const glyph = useBrailleFrame();
  return (
    <span className="working-label">
      <span className="working-label__spinner" aria-hidden>
        {glyph}
      </span>
      <span className="working-label__text">{label}</span>
    </span>
  );
}

export interface WorkingSpinnerProps {
  readonly className?: string;
  readonly title?: string;
}

/**
 * Standalone braille spinner — same animation as `WorkingLabel` but without
 * the shimmer text. Uses ref-based DOM mutation so it never stalls during
 * heavy React rendering (e.g. streaming).
 */
export function WorkingSpinner({ className, title }: WorkingSpinnerProps) {
  const spinnerRef = useBrailleFrameRef();
  const classes = `working-spinner${className ? ` ${className}` : ""}`;
  if (title) {
    return <span ref={spinnerRef} className={classes} role="img" aria-label={title} />;
  }
  return <span ref={spinnerRef} className={classes} aria-hidden />;
}

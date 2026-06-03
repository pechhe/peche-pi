import { useEffect, useState } from "react";

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
 * the shimmer text. Used in compact slots like the sidebar session row.
 */
export function WorkingSpinner({ className, title }: WorkingSpinnerProps) {
  const glyph = useBrailleFrame();
  const classes = `working-spinner${className ? ` ${className}` : ""}`;
  if (title) {
    return (
      <span className={classes} role="img" aria-label={title}>
        {glyph}
      </span>
    );
  }
  return (
    <span className={classes} aria-hidden>
      {glyph}
    </span>
  );
}

import { useEffect, useState } from "react";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const FRAME_INTERVAL_MS = 80;

export interface WorkingLabelProps {
  readonly label: string;
}

/**
 * Animated "Working…" indicator matching the pi TUI:
 *   - Braille spinner (10 frames @ 80ms) tinted with the theme accent.
 *   - Shimmer sweep across the label text.
 */
export function WorkingLabel({ label }: WorkingLabelProps) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => {
      setFrame((f) => (f + 1) % SPINNER_FRAMES.length);
    }, FRAME_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, []);

  return (
    <span className="working-label">
      <span className="working-label__spinner" aria-hidden>
        {SPINNER_FRAMES[frame]}
      </span>
      <span className="working-label__text">{label}</span>
    </span>
  );
}

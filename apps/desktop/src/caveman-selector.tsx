import { useEffect, useState } from "react";
import type { CavemanLevel } from "./ipc";
import { useButtonSound } from "./use-button-sound";

// Click cycles through these three levels only.
const CAVEMAN_CYCLE: readonly CavemanLevel[] = ["off", "micro", "ultra"];

const CAVEMAN_LABELS: Record<string, string> = {
  off: "Caveman off",
  lite: "Caveman lite",
  full: "Caveman full",
  ultra: "Caveman ultra",
  micro: "Caveman micro",
  "wenyan-lite": "文言 lite",
  wenyan: "文言",
  "wenyan-ultra": "文言 ultra",
};

function cavemanLabel(level: CavemanLevel): string {
  return CAVEMAN_LABELS[level] ?? `Caveman ${level}`;
}

function nextCavemanLevel(level: CavemanLevel): CavemanLevel {
  const index = CAVEMAN_CYCLE.indexOf(level);
  if (index === -1) {
    return CAVEMAN_CYCLE[0]!;
  }
  return CAVEMAN_CYCLE[(index + 1) % CAVEMAN_CYCLE.length]!;
}

interface CavemanSelectorProps {
  readonly level: CavemanLevel;
  readonly disabled?: boolean;
  readonly onSetLevel: (level: CavemanLevel) => void;
}

/**
 * Caveman compression control styled as a physical square push-button (the
 * shared `.devbtn` keycap recipe) with an amber indicator LED above it. Click
 * cycles off → micro → ultra; the LED lights whenever compression is active.
 */
export function CavemanSelector({ level, disabled = false, onSetLevel }: CavemanSelectorProps) {
  const [visualLevel, setVisualLevel] = useState(level);
  const buttonSound = useButtonSound({ variant: "click", disabled });

  useEffect(() => {
    setVisualLevel(level);
  }, [level]);

  const handleClick = () => {
    const next = nextCavemanLevel(visualLevel);
    setVisualLevel(next);
    onSetLevel(next);
  };

  const active = visualLevel !== "off";

  return (
    <span className="devbtn" data-section-label="Caveman">
      <button
        type="button"
        className={`devbtn__switch${active ? " devbtn__switch--on" : ""}`}
        aria-label={`Caveman compression: ${cavemanLabel(visualLevel)}`}
        title="Caveman output compression level (click to cycle: off → micro → ultra)"
        disabled={disabled}
        {...buttonSound}
        onClick={handleClick}
      >
        <span className="devbtn__led" aria-hidden="true" />
        <span className="devbtn__cap" aria-hidden="true" />
        <span className="devbtn__caption">{cavemanLabel(visualLevel)}</span>
      </button>
    </span>
  );
}

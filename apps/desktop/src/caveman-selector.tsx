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

export function CavemanSelector({ level, disabled = false, onSetLevel }: CavemanSelectorProps) {
  const buttonSound = useButtonSound({ category: "toggle", disabled });
  return (
    <span className="caveman-selector" title="Caveman output compression level (click to cycle: off → micro → ultra)">
      <span aria-hidden="true">🪨</span>
      <span className="sr-only">Caveman compression</span>
      <span className="composer__key-mount">
        <button
          aria-label={`Caveman compression: ${cavemanLabel(level)}`}
          className="caveman-selector__select"
          disabled={disabled}
          type="button"
          {...buttonSound}
          onClick={() => onSetLevel(nextCavemanLevel(level))}
        >
          {cavemanLabel(level)}
        </button>
      </span>
    </span>
  );
}

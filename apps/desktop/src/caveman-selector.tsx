import { useEffect, useState, type CSSProperties } from "react";
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

const CAVEMAN_DIAL_LEVELS: readonly { readonly value: CavemanLevel; readonly label: string; readonly clockAngle: number }[] = [
  { value: "off", label: "OFF", clockAngle: 180 },
  { value: "micro", label: "MICRO", clockAngle: 270 },
  { value: "ultra", label: "ULTRA", clockAngle: 360 },
];

function cavemanDialPoint(clockAngle: number): { readonly x: number; readonly y: number } {
  const radians = (clockAngle * Math.PI) / 180;
  return {
    x: 50 + Math.cos(radians) * 40,
    y: 50 + Math.sin(radians) * 40,
  };
}

function cavemanPointerAngle(clockAngle: number): number {
  return clockAngle - 270;
}

function CavemanDial({ level }: { readonly level: CavemanLevel }) {
  const active = CAVEMAN_DIAL_LEVELS.find((entry) => entry.value === level) ?? CAVEMAN_DIAL_LEVELS[0]!;
  const style = {
    "--reasoning-dial-angle": `${cavemanPointerAngle(active.clockAngle)}deg`,
  } as CSSProperties;

  return (
    <span className="reasoning-meter reasoning-meter--dial caveman-dial" style={style} aria-hidden="true">
      <span className="reasoning-meter__face">
        {CAVEMAN_DIAL_LEVELS.map((entry) => {
          const point = cavemanDialPoint(entry.clockAngle);
          return (
            <span
              className={`reasoning-meter__setting caveman-dial__setting caveman-dial__setting--${entry.value}${point.x >= 50 ? " reasoning-meter__setting--right" : ""}${entry.value === level ? " reasoning-meter__setting--active" : ""}`}
              key={entry.value}
              style={{
                "--reasoning-setting-x": `${point.x}%`,
                "--reasoning-setting-y": `${point.y}%`,
              } as CSSProperties}
            >
              <span className="reasoning-meter__label">{entry.label}</span>
              <span className="reasoning-meter__light" />
            </span>
          );
        })}
        <span className="reasoning-meter__knob" />
      </span>
    </span>
  );
}

interface CavemanSelectorProps {
  readonly level: CavemanLevel;
  readonly disabled?: boolean;
  readonly onSetLevel: (level: CavemanLevel) => void;
}

export function CavemanSelector({ level, disabled = false, onSetLevel }: CavemanSelectorProps) {
  const [visualLevel, setVisualLevel] = useState(level);
  const buttonSound = useButtonSound({ variant: "rotary", disabled });

  useEffect(() => {
    setVisualLevel(level);
  }, [level]);

  const handleClick = () => {
    const next = nextCavemanLevel(visualLevel);
    setVisualLevel(next);
    onSetLevel(next);
  };

  return (
    <span className="caveman-selector" title="Caveman output compression level (click to cycle: off → micro → ultra)">
      <span aria-hidden="true">🪨</span>
      <span className="sr-only">Caveman compression</span>
      <span className="composer__key-mount composer__key-mount--caveman">
        <button
          aria-label={`Caveman compression: ${cavemanLabel(visualLevel)}`}
          className="caveman-selector__select caveman-selector__select--dial"
          disabled={disabled}
          type="button"
          {...buttonSound}
          onClick={handleClick}
        >
          <CavemanDial level={visualLevel} />
        </button>
      </span>
    </span>
  );
}

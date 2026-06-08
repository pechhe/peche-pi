import { useEffect, useState } from "react";
import type { CavemanLevel } from "./ipc";
import { useButtonSound } from "./use-button-sound";

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

interface CavemanSelectorProps {
  readonly level: CavemanLevel;
  readonly disabled?: boolean;
  readonly onSetLevel: (level: CavemanLevel) => void;
}

/**
 * Caveman compression control styled as a physical square push-button (the
 * shared `.devbtn` keycap recipe) with an indicator LED above it. The button is
 * a binary in/out toggle: click flips between "off" and the configured "on"
 * level (chosen in Settings; resolved here from caveman config). The LED lights
 * whenever compression is active.
 */
export function CavemanSelector({ level, disabled = false, onSetLevel }: CavemanSelectorProps) {
  const [visualLevel, setVisualLevel] = useState(level);
  // What "on" means — configured in Settings, persisted in caveman config.
  const [onLevel, setOnLevel] = useState<CavemanLevel>("ultra");
  const buttonSound = useButtonSound({ variant: "click", disabled });

  useEffect(() => {
    setVisualLevel(level);
  }, [level]);

  useEffect(() => {
    const api = window.piApp;
    if (!api) return;
    void api.getCavemanConfig().then((config) => setOnLevel(config.onLevel));
  }, []);

  const active = visualLevel !== "off";

  const handleClick = () => {
    const next: CavemanLevel = active ? "off" : onLevel;
    setVisualLevel(next);
    onSetLevel(next);
  };

  return (
    <span className="devbtn" data-section-label="Caveman">
      <button
        type="button"
        className={`devbtn__switch${active ? " devbtn__switch--on" : ""}`}
        aria-label={`Caveman compression: ${cavemanLabel(visualLevel)}`}
        aria-pressed={active}
        title="Caveman output compression (click to toggle on/off — set the on level in Settings)"
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

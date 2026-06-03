import type { CavemanLevel } from "./ipc";

const CAVEMAN_LEVELS: readonly { readonly value: CavemanLevel; readonly label: string }[] = [
  { value: "off", label: "Caveman off" },
  { value: "lite", label: "Caveman lite" },
  { value: "full", label: "Caveman full" },
  { value: "ultra", label: "Caveman ultra" },
  { value: "micro", label: "Caveman micro" },
  { value: "wenyan-lite", label: "文言 lite" },
  { value: "wenyan", label: "文言" },
  { value: "wenyan-ultra", label: "文言 ultra" },
];

interface CavemanSelectorProps {
  readonly level: CavemanLevel;
  readonly disabled?: boolean;
  readonly onSetLevel: (level: CavemanLevel) => void;
}

export function CavemanSelector({ level, disabled = false, onSetLevel }: CavemanSelectorProps) {
  return (
    <label className="caveman-selector" title="Caveman output compression level">
      <span aria-hidden="true">🪨</span>
      <span className="sr-only">Caveman compression</span>
      <select
        aria-label="Caveman compression"
        className="caveman-selector__select"
        disabled={disabled}
        value={level}
        onChange={(event) => onSetLevel(event.target.value as CavemanLevel)}
      >
        {CAVEMAN_LEVELS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

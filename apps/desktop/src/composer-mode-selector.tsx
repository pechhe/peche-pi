import type { ComposerMode } from "./composer-mode";

interface ComposerModeSelectorProps {
  readonly mode: ComposerMode;
  readonly disabled?: boolean;
  readonly onSetMode: (mode: ComposerMode) => void;
}

export function ComposerModeSelector({ mode, disabled = false, onSetMode }: ComposerModeSelectorProps) {
  const isPlan = mode === "plan";
  return (
    <span className="composer__key-mount">
      <button
        aria-label={`Composer mode: ${isPlan ? "Plan" : "Build"}`}
        aria-pressed={isPlan}
        className={`composer-mode ${isPlan ? "composer-mode--plan" : ""}`}
        disabled={disabled}
        title={isPlan ? "Plan mode: grill with docs, then produce a PRD and Ralph plan" : "Build mode: send normally"}
        type="button"
        onClick={() => onSetMode(isPlan ? "build" : "plan")}
      >
        <span className="composer-mode__dot" aria-hidden="true" />
        <span>{isPlan ? "Plan" : "Build"}</span>
      </button>
    </span>
  );
}

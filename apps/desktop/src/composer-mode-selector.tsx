import type { ComposerMode } from "./composer-mode";
import { ShortcutHint } from "./shortcut-hint";
import { useButtonSound } from "./use-button-sound";

interface ComposerModeSelectorProps {
  readonly mode: ComposerMode;
  readonly disabled?: boolean;
  readonly onSetMode: (mode: ComposerMode) => void;
}

export function ComposerModeSelector({ mode, disabled = false, onSetMode }: ComposerModeSelectorProps) {
  const isPlan = mode === "plan";
  const buttonSound = useButtonSound({ variant: "rotary", disabled });
  return (
    <span className="composer__key-mount composer__key-mount--mode">
      <ShortcutHint keys="⌘B / ⌘P" />
      <button
        aria-label={`Composer mode: ${isPlan ? "Plan" : "Build"}`}
        aria-pressed={isPlan}
        className={`composer-mode ${isPlan ? "composer-mode--plan" : ""}`}
        disabled={disabled}
        title={isPlan ? "Plan mode: grill with docs, then produce a PRD and Ralph plan" : "Build mode: send normally"}
        type="button"
        {...buttonSound}
        onClick={() => onSetMode(isPlan ? "build" : "plan")}
      >
        <span className={`composer-mode__label ${!isPlan ? "composer-mode__label--active" : ""}`}>Build</span>
        <span className="composer-mode__track" aria-hidden="true">
          <span className="composer-mode__thumb" />
        </span>
        <span className={`composer-mode__label ${isPlan ? "composer-mode__label--active" : ""}`}>Plan</span>
      </button>
    </span>
  );
}

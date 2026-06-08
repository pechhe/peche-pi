import { useButtonSound } from "./use-button-sound";

interface OrchestrateSwitchProps {
  readonly on: boolean;
  readonly disabled?: boolean;
  readonly onToggle?: () => void;
}

/**
 * Orchestrator toggle styled as a physical square push-button (the shared
 * matte-aluminium DeviceButton keycap recipe) with an amber indicator LED
 * above it. ON = key stays depressed + LED lit; OFF = key raised + LED dark.
 *
 * The physical button renders in the modular composer-device skin; in the
 * plain prose composer it falls back to a compact text caption (CSS-gated).
 */
export function OrchestrateSwitch({ on, disabled = false, onToggle }: OrchestrateSwitchProps) {
  const buttonSound = useButtonSound({ variant: "click", disabled });
  return (
    <span className="devbtn" data-section-label="ORCHESTRATE">
      <button
        type="button"
        data-testid="orchestrate-toggle"
        className={`devbtn__switch${on ? " devbtn__switch--on" : ""}`}
        role="switch"
        aria-checked={on}
        aria-label="Orchestrator mode"
        title="Toggle orchestrator mode"
        disabled={disabled || !onToggle}
        {...buttonSound}
        onClick={onToggle}
      >
        <span className="devbtn__led" aria-hidden="true" />
        <span className="devbtn__cap" aria-hidden="true" />
        <span className="devbtn__caption">{on ? "Orchestrating" : "Orchestrate"}</span>
      </button>
    </span>
  );
}

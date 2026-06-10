import type { ChassisAction } from "./chassis";
import { useButtonSound } from "./use-button-sound";

interface ChassisActionControlProps {
  readonly action: ChassisAction;
  readonly disabled?: boolean;
  readonly onRun: () => void;
}

/**
 * Renders a single chassis action as a momentary push-button (the shared
 * matte-aluminium DeviceButton keycap recipe). For #46 it is one-shot only
 * (no sticky/wrap).
 */
export function ChassisActionControl({ action, disabled = false, onRun }: ChassisActionControlProps) {
  const buttonSound = useButtonSound({ variant: "click", disabled });
  return (
    <span className="devbtn" data-section-label={action.label}>
      <button
        type="button"
        data-testid={`chassis-action-${action.id}`}
        className="devbtn__switch"
        aria-label={action.label}
        title={action.label}
        disabled={disabled}
        {...buttonSound}
        onClick={onRun}
      >
        <span className="devbtn__cap" aria-hidden="true" />
        {action.showLabel ? (
          <span className="devbtn__caption">{action.label}</span>
        ) : null}
      </button>
    </span>
  );
}

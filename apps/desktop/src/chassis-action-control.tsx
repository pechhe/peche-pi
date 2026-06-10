import type { ChassisAction } from "./chassis";
import { useButtonSound } from "./use-button-sound";

interface ChassisActionControlProps {
  readonly action: ChassisAction;
  readonly disabled?: boolean;
  /** oneShot trigger: momentary push-button callback. */
  readonly onRun?: () => void;
  /** sticky trigger: toggle on/off callback. */
  readonly onToggle?: () => void;
  /** sticky trigger: whether the action is currently active. */
  readonly active?: boolean;
}

/**
 * Renders a single chassis action. oneShot → momentary push-button;
 * sticky → on/off toggle switch.
 */
export function ChassisActionControl({ action, disabled = false, onRun, onToggle, active = false }: ChassisActionControlProps) {
  const buttonSound = useButtonSound({ variant: "click", disabled });
  if (action.trigger === "sticky") {
    return (
      <span className="devbtn" data-section-label={action.label}>
        <button
          type="button"
          role="switch"
          data-testid={`chassis-action-${action.id}`}
          className={`devbtn__switch${active ? " devbtn__switch--on" : ""}`}
          aria-label={action.label}
          aria-checked={active}
          aria-pressed={active}
          title={action.label}
          disabled={disabled}
          {...buttonSound}
          onClick={onToggle}
        >
          <span className="devbtn__cap" aria-hidden="true" />
          {action.showLabel ? (
            <span className="devbtn__caption">{action.label}</span>
          ) : null}
        </button>
      </span>
    );
  }
  return (
    <span className="devbtn" data-section-label={action.label}>
      <button
        type="button"
        data-testid={`chassis-action-${action.id}`}
        className="devbtn__switch"
        aria-label={action.label}
        aria-pressed="false"
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

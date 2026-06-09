import { SidebarToggleIcon } from "./icons";
import { useButtonSound } from "./use-button-sound";

interface SidebarToggleButtonProps {
  readonly collapsed: boolean;
  readonly shortcutLabel: string;
  readonly onToggle: () => void;
}

export function SidebarToggleButton({ collapsed, shortcutLabel, onToggle }: SidebarToggleButtonProps) {
  const buttonSound = useButtonSound({ category: "toggle" });
  return (
    <div className="shortcut-tooltip-wrap sidebar-toggle">
      <button
        aria-label="Toggle sidebar"
        aria-pressed={!collapsed}
        className="icon-button sidebar-toggle__button"
        data-testid="sidebar-toggle"
        type="button"
        {...buttonSound}
        onClick={onToggle}
      >
        <SidebarToggleIcon />
      </button>
      <span className="shortcut-tooltip sidebar-toggle__tooltip" role="tooltip">
        <span>Toggle sidebar</span>
        <kbd>{shortcutLabel}</kbd>
      </span>
    </div>
  );
}

import type { THINKING_OPTIONS } from "./composer-commands";

type ThinkingValue = (typeof THINKING_OPTIONS)[number]["value"];

const LEVEL_FILL: Record<ThinkingValue, number> = {
  low: 0.25,
  medium: 0.5,
  high: 0.75,
  xhigh: 1,
};

const LEVEL_LABEL: Record<ThinkingValue, string> = {
  low: "low",
  medium: "med",
  high: "high",
  xhigh: "xhigh",
};

function reasoningFill(level: string): number {
  return LEVEL_FILL[level as ThinkingValue] ?? 0;
}

function reasoningLabel(level: string): string {
  return LEVEL_LABEL[level as ThinkingValue] ?? level;
}

interface ReasoningMeterProps {
  readonly level: string;
  readonly size?: number;
  readonly showLabel?: boolean;
  readonly className?: string;
}

export function ReasoningMeter({
  level,
  size = 14,
  showLabel = true,
  className,
}: ReasoningMeterProps) {
  const fill = reasoningFill(level);
  const label = reasoningLabel(level);

  const strokeWidth = 2;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  // Arc starts at 12 o'clock and fills clockwise
  const dashOffset = circumference * (1 - fill);
  // Rotate -90deg so 0 starts at top
  const transform = `rotate(-90 ${size / 2} ${size / 2})`;

  return (
    <span className={`reasoning-meter${className ? ` ${className}` : ""}`}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Track — full muted circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="var(--muted)"
          strokeWidth={strokeWidth}
          fill="none"
          opacity={0.3}
        />
        {/* Fill arc — cyan, fills clockwise from top */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="var(--accent)"
          strokeWidth={strokeWidth}
          fill="none"
          strokeLinecap={fill >= 1 ? undefined : "round"}
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          transform={transform}
        />
      </svg>
      {showLabel ? <span className="reasoning-meter__label">{label}</span> : null}
    </span>
  );
}

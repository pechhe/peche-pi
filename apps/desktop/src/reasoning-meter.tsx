import type { CSSProperties } from "react";

interface ReasoningDialLevel {
  readonly value: string;
  readonly label: string;
  readonly clockAngle: number;
  readonly x: number;
  readonly y: number;
}

const LEVEL_LABELS: Readonly<Record<string, string>> = {
  off: "OFF",
  minimal: "MIN",
  low: "LOW",
  medium: "MED",
  high: "HIGH",
  xhigh: "MAX",
};

const LEVEL_ORDER = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;
const SETTING_RADIUS_PERCENT = 40;

function normalizedLevel(level: string): string {
  return level === "max" ? "xhigh" : level;
}

function displayLabel(level: string, levelLabels?: Readonly<Record<string, string>>): string {
  // Prefer the provider's own name for xhigh (e.g. Opus "max", GPT-5.5 "xhigh")
  // instead of a hard-coded label, so the dial matches the selected model.
  if (level === "xhigh" && levelLabels?.xhigh) {
    return levelLabels.xhigh.toUpperCase();
  }
  return LEVEL_LABELS[level] ?? level.toUpperCase();
}

function clockAngleForIndex(index: number, count: number): number {
  if (index === 0) return 180;
  if (count <= 2) return 0;

  const remaining = count - 1;
  const start = 225;
  const end = 405;
  return start + ((index - 1) * (end - start)) / Math.max(1, remaining - 1);
}

function pointOnDial(clockAngle: number): { readonly x: number; readonly y: number } {
  const radians = (clockAngle * Math.PI) / 180;
  return {
    x: 50 + Math.cos(radians) * SETTING_RADIUS_PERCENT,
    y: 50 + Math.sin(radians) * SETTING_RADIUS_PERCENT,
  };
}

function pointerAngle(clockAngle: number): number {
  return clockAngle - 270;
}

function buildDialLevels(
  availableLevels: readonly string[] | undefined,
  levelLabels?: Readonly<Record<string, string>>,
): readonly ReasoningDialLevel[] {
  const available = new Set((availableLevels?.length ? availableLevels : LEVEL_ORDER).map(normalizedLevel));
  const values = LEVEL_ORDER.filter((level) => available.has(level));
  const ordered = values.length > 0 ? values : ["off"];

  return ordered.map((value, index) => {
    const clockAngle = clockAngleForIndex(index, ordered.length);
    const point = pointOnDial(clockAngle);
    return {
      value,
      label: displayLabel(value, levelLabels),
      clockAngle,
      x: point.x,
      y: point.y,
    };
  });
}

interface ReasoningMeterProps {
  readonly level: string;
  readonly availableLevels?: readonly string[];
  readonly levelLabels?: Readonly<Record<string, string>>;
  readonly size?: number;
  readonly showLabel?: boolean;
  readonly className?: string;
}

export function ReasoningMeter({
  level,
  availableLevels,
  levelLabels,
  size,
  className,
}: ReasoningMeterProps) {
  const activeLevel = normalizedLevel(level);
  const dialLevels = buildDialLevels(availableLevels, levelLabels);
  const activeEntry = dialLevels.find((entry) => entry.value === activeLevel) ?? dialLevels[0]!;
  const style = {
    "--reasoning-dial-size": size && size > 32 ? `${size}px` : undefined,
    "--reasoning-dial-angle": `${pointerAngle(activeEntry.clockAngle)}deg`,
  } as CSSProperties;

  return (
    <span
      className={`reasoning-meter reasoning-meter--dial${className ? ` ${className}` : ""}`}
      style={style}
      aria-label={`Reasoning ${level}`}
    >
      <span className="reasoning-meter__face" aria-hidden="true">
        {dialLevels.map((entry) => (
          <span
            className={`reasoning-meter__setting${entry.x >= 50 ? " reasoning-meter__setting--right" : ""}${entry.value === activeLevel ? " reasoning-meter__setting--active" : ""}`}
            key={entry.value}
            style={{
              "--reasoning-setting-x": `${entry.x}%`,
              "--reasoning-setting-y": `${entry.y}%`,
            } as CSSProperties}
          >
            <span className="reasoning-meter__label">{entry.label}</span>
            <span className="reasoning-meter__light" />
          </span>
        ))}
        <span className="reasoning-meter__knob" />
      </span>
    </span>
  );
}

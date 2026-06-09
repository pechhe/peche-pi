import { useEffect, useMemo, useState } from "react";
import type { RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import type { SmartCompactSettings } from "./ipc";
import { buildModelOptions } from "./composer-commands";
import { SettingsGroup, SettingsInfoRow, SettingsRow } from "./settings-utils";

interface SettingsSmartCompactSectionProps {
  readonly runtime?: RuntimeSnapshot;
  readonly settings: SmartCompactSettings;
  readonly onSetSettings: (settings: Partial<SmartCompactSettings>) => void;
}

export function SettingsSmartCompactSection({
  runtime,
  settings,
  onSetSettings,
}: SettingsSmartCompactSectionProps) {
  const modelOptions = useMemo(() => buildModelOptions(runtime), [runtime]);

  const [autoTrigger, setAutoTrigger] = useState(settings.autoTrigger ?? true);
  const [minContextPercent, setMinContextPercent] = useState(settings.minContextPercent ?? 60);
  const [minTokenThreshold, setMinTokenThreshold] = useState(settings.minTokenThreshold ?? 0);

  useEffect(() => {
    setAutoTrigger(settings.autoTrigger ?? true);
    setMinContextPercent(settings.minContextPercent ?? 60);
    setMinTokenThreshold(settings.minTokenThreshold ?? 0);
  }, [settings]);

  const summaryModelLabel = settings.summaryModel ?? "Session default";

  return (
    <SettingsGroup title="Smart compact" description="Configure automatic conversation compaction to manage context window usage.">
      <SettingsRow title="Summary model" description="Model used for handoff and analysis summaries. (Conversation compaction itself uses the session's own model.)">
        {modelOptions.length === 0 ? (
          <span className="settings-info-row__value">{summaryModelLabel}</span>
        ) : (
          <div className="settings-pill-row" style={{ flexWrap: "wrap" }}>
            <button
              className={`settings-pill${!settings.summaryModel ? " settings-pill--active" : ""}`}
              type="button"
              onClick={() => onSetSettings({ summaryModel: undefined })}
            >
              Session default
            </button>
            {modelOptions.map((option) => {
              const modelString = `${option.providerId}/${option.modelId}`;
              const isActive = settings.summaryModel === modelString;
              return (
                <button
                  className={`settings-pill${isActive ? " settings-pill--active" : ""}`}
                  key={modelString}
                  type="button"
                  aria-pressed={isActive}
                  onClick={() => onSetSettings({ summaryModel: modelString })}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        )}
      </SettingsRow>

      <SettingsRow title="Auto-trigger" description="Automatically compact when context gets full.">
        <input
          aria-label="Enable auto-trigger"
          checked={autoTrigger}
          type="checkbox"
          onChange={(event) => {
            const next = event.target.checked;
            setAutoTrigger(next);
            onSetSettings({ autoTrigger: next });
          }}
        />
      </SettingsRow>

      <SettingsRow title="Context percent threshold" description="Auto-compact when context usage reaches this percentage.">
        <input
          aria-label="Min context percent"
          className="settings-text-input settings-text-input--small"
          type="number"
          min={10}
          max={100}
          step={5}
          value={minContextPercent}
          onChange={(event) => {
            const value = Math.max(10, Math.min(100, Number(event.target.value) || 60));
            setMinContextPercent(value);
            onSetSettings({ minContextPercent: value });
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.currentTarget.blur();
            }
          }}
        />
        <span className="settings-info-row__value">%</span>
      </SettingsRow>

      <SettingsRow title="Token threshold" description="Auto-compact at this token count. Set to 0 to use percentage only. Whichever threshold is hit first triggers compaction.">
        <input
          aria-label="Min token threshold"
          className="settings-text-input settings-text-input--small"
          type="number"
          min={0}
          max={1000000}
          step={10000}
          value={minTokenThreshold}
          onChange={(event) => {
            const value = Math.max(0, Math.min(1000000, Number(event.target.value) || 0));
            setMinTokenThreshold(value);
            onSetSettings({ minTokenThreshold: value || undefined });
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.currentTarget.blur();
            }
          }}
        />
        <span className="settings-info-row__value">{minTokenThreshold > 0 ? `${(minTokenThreshold / 1000).toFixed(0)}K tokens` : "Disabled"}</span>
      </SettingsRow>

      <SettingsInfoRow
        label="Current threshold"
        value={
          minTokenThreshold > 0
            ? `${minContextPercent}% or ${(minTokenThreshold / 1000).toFixed(0)}K tokens (whichever first)`
            : `${minContextPercent}% of context window`
        }
      />
    </SettingsGroup>
  );
}

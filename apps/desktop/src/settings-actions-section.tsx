import { useState } from "react";
import type { ChassisAction } from "./chassis";
import type { PiDesktopApi } from "./ipc";
import { SettingsGroup, SettingsRow } from "./settings-utils";

interface SettingsActionsSectionProps {
  readonly api: PiDesktopApi | null | undefined;
  readonly chassisActions: readonly ChassisAction[];
  readonly refreshChassisActions?: () => void;
}

export function SettingsActionsSection({
  api,
  chassisActions,
  refreshChassisActions,
}: SettingsActionsSectionProps) {
  const [label, setLabel] = useState("");
  const [payload, setPayload] = useState("");
  const [showLabel, setShowLabel] = useState(true);

  const handleCreate = () => {
    if (!api || !label.trim() || !payload.trim()) return;
    const newAction: ChassisAction = {
      id: crypto.randomUUID(),
      label: label.trim(),
      showLabel,
      trigger: "oneShot",
      effect: { type: "submit", text: payload.trim() },
    };
    void api.setChassisActions([...chassisActions, newAction]).then(() => {
      setLabel("");
      setPayload("");
      setShowLabel(true);
      refreshChassisActions?.();
    });
  };

  return (
    <SettingsGroup title="Actions" description="One-shot buttons that send a fixed prompt.">
      <SettingsRow title="Create action">
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
          <input
            type="text"
            data-testid="chassis-action-label-input"
            placeholder="Label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            style={{ flex: "1 1 120px", minWidth: 0 }}
          />
          <input
            type="text"
            data-testid="chassis-action-payload-input"
            placeholder="Payload text"
            value={payload}
            onChange={(e) => setPayload(e.target.value)}
            style={{ flex: "2 1 180px", minWidth: 0 }}
          />
          <label style={{ display: "flex", alignItems: "center", gap: "0.25rem", whiteSpace: "nowrap" }}>
            <input
              type="checkbox"
              data-testid="chassis-action-showlabel"
              checked={showLabel}
              onChange={(e) => setShowLabel(e.target.checked)}
            />
            Show label
          </label>
          <button
            type="button"
            className="button button--secondary"
            data-testid="chassis-action-create"
            disabled={!label.trim() || !payload.trim()}
            onClick={handleCreate}
          >
            Add
          </button>
        </div>
      </SettingsRow>
      {chassisActions.length > 0 ? (
        chassisActions.map((action) => (
          <div key={action.id} data-testid={`chassis-action-row-${action.id}`}>
            <SettingsRow title={action.label} description={action.effect.text} />
          </div>
        ))
      ) : null}
    </SettingsGroup>
  );
}

import { useState } from "react";
import type { ChassisAction } from "./chassis";
import { WRAP_INPUT_TOKEN } from "./chassis";
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
  const [trigger, setTrigger] = useState<"oneShot" | "sticky">("oneShot");
  const [templateError, setTemplateError] = useState<string | null>(null);

  const handleCreate = () => {
    if (!api || !label.trim() || !payload.trim()) return;
    if (trigger === "sticky") {
      if (!payload.includes(WRAP_INPUT_TOKEN)) {
        setTemplateError(`Template must contain ${WRAP_INPUT_TOKEN}`);
        return;
      }
      const newAction: ChassisAction = {
        id: crypto.randomUUID(),
        label: label.trim(),
        showLabel,
        trigger: "sticky",
        effect: { type: "wrap", template: payload.trim() },
      };
      void api.setChassisActions([...chassisActions, newAction]).then(() => {
        setLabel("");
        setPayload("");
        setShowLabel(true);
        setTrigger("oneShot");
        setTemplateError(null);
        refreshChassisActions?.();
      });
    } else {
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
    }
  };

  const handlePayloadChange = (value: string) => {
    setPayload(value);
    if (templateError) {
      setTemplateError(null);
    }
  };

  return (
    <SettingsGroup title="Actions" description="One-shot buttons or sticky wrap toggles that send prompts.">
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
          <select
            data-testid="chassis-action-trigger"
            value={trigger}
            onChange={(e) => {
              setTrigger(e.target.value as "oneShot" | "sticky");
              setTemplateError(null);
            }}
            style={{ flex: "0 0 auto" }}
          >
            <option value="oneShot">One-shot</option>
            <option value="sticky">Sticky wrap</option>
          </select>
          <input
            type="text"
            data-testid="chassis-action-payload-input"
            placeholder={trigger === "sticky" ? `Wrap template with ${WRAP_INPUT_TOKEN}` : "Payload text"}
            value={payload}
            onChange={(e) => handlePayloadChange(e.target.value)}
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
        {templateError ? (
          <div data-testid="chassis-action-template-error" style={{ color: "var(--color-error, #e74c3c)", fontSize: "0.85em", marginTop: "0.25rem" }}>
            {templateError}
          </div>
        ) : null}
      </SettingsRow>
      {chassisActions.length > 0 ? (
        chassisActions.map((action) => (
          <div key={action.id} data-testid={`chassis-action-row-${action.id}`}>
            <SettingsRow
              title={action.label}
              description={action.trigger === "sticky" && action.effect.type === "wrap" ? action.effect.template : action.effect.type === "submit" ? action.effect.text : ""}
            />
          </div>
        ))
      ) : null}
    </SettingsGroup>
  );
}

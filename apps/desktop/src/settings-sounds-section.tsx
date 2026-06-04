import { useState } from "react";
import {
  BUTTON_CLICK_VARIANTS,
  BUTTON_CATEGORY_DESCRIPTIONS,
  BUTTON_CATEGORY_LABELS,
  type ButtonCategory,
  type ButtonClickVariant,
  type ButtonSoundSettings,
} from "./button-click-sound";
import { SettingsGroup, SettingsRow } from "./settings-utils";

interface SettingsSoundsSectionProps {
  readonly soundSettings: ButtonSoundSettings;
  readonly onSetSoundSettings: (settings: ButtonSoundSettings) => void;
}

const CATEGORIES: readonly ButtonCategory[] = ["primary", "navigation", "toggle", "secondary", "destructive"];

function variantLabel(variant: ButtonClickVariant): string {
  switch (variant) {
    case "click":
      return "Click";
    case "key":
      return "Key";
    case "none":
      return "Silent";
  }
}

export function SettingsSoundsSection({ soundSettings, onSetSoundSettings }: SettingsSoundsSectionProps) {
  const [previewing, setPreviewing] = useState<{ category: ButtonCategory; variant: ButtonClickVariant } | null>(null);

  const handleChange = (category: ButtonCategory, variant: ButtonClickVariant) => {
    onSetSoundSettings({ ...soundSettings, [category]: variant });
  };

  const handlePreview = (category: ButtonCategory, variant: ButtonClickVariant) => {
    setPreviewing({ category, variant });
    // Dynamic import to avoid circular dependency
    import("./button-click-sound").then(({ playClick, playKey }) => {
      if (variant === "click") playClick("down");
      else if (variant === "key") playKey("press");
    });
    setTimeout(() => setPreviewing(null), 300);
  };

  return (
    <>
      <SettingsGroup
        title="Button sounds"
        description="Choose sounds for different button types. Select 'Silent' to disable sounds for a category."
      >
        {CATEGORIES.map((category) => (
          <SettingsRow
            key={category}
            title={BUTTON_CATEGORY_LABELS[category]}
            description={BUTTON_CATEGORY_DESCRIPTIONS[category]}
          >
            <div className="sound-settings__control">
              <select
                className="sound-settings__select"
                value={soundSettings[category]}
                onChange={(e) => handleChange(category, e.target.value as ButtonClickVariant)}
                aria-label={`Sound for ${BUTTON_CATEGORY_LABELS[category]}`}
              >
                {BUTTON_CLICK_VARIANTS.map((variant) => (
                  <option key={variant} value={variant}>
                    {variantLabel(variant)}
                  </option>
                ))}
              </select>
              <button
                className={`sound-settings__preview${previewing?.category === category ? " sound-settings__preview--active" : ""}`}
                type="button"
                onClick={() => handlePreview(category, soundSettings[category])}
                disabled={soundSettings[category] === "none"}
                aria-label={`Preview ${BUTTON_CATEGORY_LABELS[category]} sound`}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path
                    d="M4 5.5v5h2.5l3.5 3V2.5L6.5 5.5H4z"
                    fill="currentColor"
                  />
                  {soundSettings[category] !== "none" && (
                    <>
                      <path
                        d="M11 5.5c.7.7 1 1.5 1 2.5s-.3 1.8-1 2.5"
                        stroke="currentColor"
                        strokeWidth="1.2"
                        strokeLinecap="round"
                      />
                      <path
                        d="M12.5 3.5c1.2 1.2 1.8 2.8 1.8 4.5s-.6 3.3-1.8 4.5"
                        stroke="currentColor"
                        strokeWidth="1.2"
                        strokeLinecap="round"
                      />
                    </>
                  )}
                </svg>
              </button>
            </div>
          </SettingsRow>
        ))}
      </SettingsGroup>

      <SettingsGroup title="All sounds off" description="Quickly disable all button sounds.">
        <SettingsRow title="Mute all sounds" description="Disable audio feedback for all buttons.">
          <input
            type="checkbox"
            checked={CATEGORIES.every((c) => soundSettings[c] === "none")}
            onChange={(e) => {
              const allNone = CATEGORIES.every((c) => soundSettings[c] === "none");
              const newValue: ButtonClickVariant = allNone ? "click" : "none";
              const newSettings: ButtonSoundSettings = {
                primary: newValue,
                navigation: newValue,
                toggle: newValue,
                secondary: newValue,
                destructive: newValue,
              };
              onSetSoundSettings(newSettings);
            }}
            aria-label="Mute all sounds"
          />
        </SettingsRow>
      </SettingsGroup>
    </>
  );
}

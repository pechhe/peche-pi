import type { ComposerDeviceMode, ThemeMode } from "./desktop-state";
import { SettingsGroup, SettingsRow } from "./settings-utils";

interface SettingsAppearanceSectionProps {
  readonly themeMode: ThemeMode;
  readonly onSetThemeMode: (mode: ThemeMode) => void;
  readonly enableTransparency: boolean;
  readonly onSetEnableTransparency: (enabled: boolean) => void;
  readonly composerDeviceMode: ComposerDeviceMode;
  readonly onSetComposerDeviceMode: (mode: ComposerDeviceMode) => void;
}

const COMPOSER_DEVICE_OPTIONS: { mode: ComposerDeviceMode; label: string; description: string }[] = [
  { mode: "off", label: "Off", description: "Standard prompt box." },
  { mode: "screen", label: "Screen", description: "Whole prompt becomes a CRT screen. One physical send button." },
  { mode: "modular", label: "Modular", description: "CRT screen for input, physical keys for each control." },
];

const THEME_OPTIONS: { mode: ThemeMode; label: string; description: string }[] = [
  { mode: "system", label: "System", description: "Follow your OS appearance setting" },
  { mode: "light", label: "Light", description: "Always use the light theme" },
  { mode: "dark", label: "Dark", description: "Always use the dark theme" },
  { mode: "dracula", label: "Dracula", description: "The iconic purple-tinted dark theme" },
];

export function SettingsAppearanceSection({
  themeMode,
  onSetThemeMode,
  enableTransparency,
  onSetEnableTransparency,
  composerDeviceMode,
  onSetComposerDeviceMode,
}: SettingsAppearanceSectionProps) {
  return (
    <>
      <SettingsGroup title="Theme">
        {THEME_OPTIONS.map((option) => (
          <SettingsRow key={option.mode} title={option.label} description={option.description}>
            <input
              checked={themeMode === option.mode}
              name="theme"
              type="radio"
              onChange={() => onSetThemeMode(option.mode)}
            />
          </SettingsRow>
        ))}
      </SettingsGroup>

      <SettingsGroup title="Visuals">
        <SettingsRow
          title="Window transparency"
          description="Let desktop colors show through supported surfaces."
        >
          <input
            aria-label="Window transparency"
            type="checkbox"
            checked={enableTransparency}
            onChange={(event) => onSetEnableTransparency(event.currentTarget.checked)}
          />
        </SettingsRow>
        {COMPOSER_DEVICE_OPTIONS.map((option) => (
          <SettingsRow
            key={option.mode}
            title={option.mode === "off" ? "Composer device mode: Off" : `Composer device mode: ${option.label}`}
            description={option.description}
          >
            <input
              checked={composerDeviceMode === option.mode}
              name="composer-device-mode"
              type="radio"
              onChange={() => onSetComposerDeviceMode(option.mode)}
            />
          </SettingsRow>
        ))}
      </SettingsGroup>
    </>
  );
}

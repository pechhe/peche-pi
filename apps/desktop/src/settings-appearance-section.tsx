import type { ComposerDeviceMode, ThemeMode, ThreadTransitionMotion, ThreadTransitionSettings } from "./desktop-state";
import { SettingsGroup, SettingsRow } from "./settings-utils";

interface SettingsAppearanceSectionProps {
  readonly themeMode: ThemeMode;
  readonly onSetThemeMode: (mode: ThemeMode) => void;
  readonly enableTransparency: boolean;
  readonly onSetEnableTransparency: (enabled: boolean) => void;
  readonly composerDeviceMode: ComposerDeviceMode;
  readonly onSetComposerDeviceMode: (mode: ComposerDeviceMode) => void;
  readonly threadTransition: ThreadTransitionSettings;
  readonly onSetThreadTransition: (settings: Partial<ThreadTransitionSettings>) => void;
}

const THREAD_TRANSITION_MOTION_OPTIONS: { motion: ThreadTransitionMotion; label: string; description: string }[] = [
  { motion: "off", label: "Off", description: "Composer appears docked instantly — no travel animation." },
  { motion: "curve", label: "Curve", description: "Launches at full speed, then eases slowly into the dock." },
  { motion: "dock", label: "Dock", description: "Builds speed fast, then a long glide that decelerates into the dock." },
  { motion: "spring", label: "Spring", description: "Physical spring that settles with a visible natural overshoot." },
];

const COMPOSER_DEVICE_OPTIONS: { mode: ComposerDeviceMode; label: string; description: string }[] = [
  { mode: "off", label: "Off", description: "Standard prompt box." },
  { mode: "screen", label: "Screen", description: "Whole prompt becomes a CRT screen. One physical send button." },
  { mode: "screen-neon", label: "Screen (Neon)", description: "Whole prompt is one green CRT screen with a glowing neon send key." },
  { mode: "modular", label: "Modular", description: "CRT screen for input, physical keys for each control." },
  { mode: "modular-metal", label: "Modular (Metal keys)", description: "Modular layout with brushed-metal control keys, matching the send dial." },
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
  threadTransition,
  onSetThreadTransition,
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

      <SettingsGroup title="Thread transition">
        {THREAD_TRANSITION_MOTION_OPTIONS.map((option) => (
          <SettingsRow
            key={option.motion}
            title={`Composer motion: ${option.label}`}
            description={option.description}
          >
            <input
              checked={threadTransition.motion === option.motion}
              name="thread-transition-motion"
              type="radio"
              onChange={() => onSetThreadTransition({ motion: option.motion })}
            />
          </SettingsRow>
        ))}
        <SettingsRow
          title="Animate hero out"
          description="Lift and fade the logo and title away as the composer leaves the center."
        >
          <input
            aria-label="Animate hero out"
            type="checkbox"
            checked={threadTransition.heroExit}
            disabled={threadTransition.motion === "off"}
            onChange={(event) => onSetThreadTransition({ heroExit: event.currentTarget.checked })}
          />
        </SettingsRow>
        <SettingsRow
          title="Lift message from composer"
          description="Delay the first message so it rises out of the composer as it docks."
        >
          <input
            aria-label="Lift message from composer"
            type="checkbox"
            checked={threadTransition.bubbleHandoff}
            disabled={threadTransition.motion === "off"}
            onChange={(event) => onSetThreadTransition({ bubbleHandoff: event.currentTarget.checked })}
          />
        </SettingsRow>
      </SettingsGroup>
    </>
  );
}

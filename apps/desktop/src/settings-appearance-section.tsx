import { useCallback, useEffect, useRef, useState } from "react";
import {
  type ComposerDeviceMode,
  STREAM_REVEAL_FX_TOKENS,
  type StreamRevealMode,
  type StreamRevealSpeed,
  type ThemeMode,
  type ThreadTransitionMotion,
  type ThreadTransitionSettings,
} from "./desktop-state";
import { StreamingMessageText } from "./message-markdown";
import { SettingsGroup, SettingsRow } from "./settings-utils";

const STREAM_PREVIEW_TEXT =
  "Streaming responses fade in word by word, so the model's output feels calm and deliberate instead of janky. " +
  "Each word resolves from soft focus into sharp text, creating a smooth left-to-right wave as consecutive fades overlap. " +
  "The reveal rate adapts automatically: steady on a slow trickle of tokens, but catching up quickly when the model sends a large batch at once. " +
  "The effect is subtle enough that you stop noticing it after a few messages, which is exactly the point — it should feel like text arriving naturally, not a flashy animation competing for your attention.";

// Continuously loops the real streaming reveal so each preset is visible to
// compare. Reuses StreamingMessageText (same typewriter + .sw fade as
// production). Instead of a fixed interval, it replays as soon as the previous
// reveal finishes (onCaughtUp) after a short pause — so the loop tracks the
// selected speed rather than racing or stalling against a hard-coded timer.
// The wrapper's data-stream-fx applies the chosen preset's tokens to the
// preview only; reveal speed comes from the saved root data-stream-speed.
const PREVIEW_LOOP_PAUSE_MS = 1500;
function StreamRevealPreview({ mode }: { readonly mode: StreamRevealMode }) {
  const [replay, setReplay] = useState(0);
  const timerRef = useRef<number | undefined>(undefined);
  const handleCaughtUp = useCallback(() => {
    if (timerRef.current !== undefined) return; // onCaughtUp can fire repeatedly; schedule once
    timerRef.current = window.setTimeout(() => {
      timerRef.current = undefined;
      setReplay((n) => n + 1);
    }, PREVIEW_LOOP_PAUSE_MS);
  }, []);
  useEffect(
    () => () => {
      if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);
    },
    [],
  );
  return (
    <div className="stream-reveal-preview" data-stream-fx={STREAM_REVEAL_FX_TOKENS[mode]}>
      <StreamingMessageText key={replay} text={STREAM_PREVIEW_TEXT} onCaughtUp={handleCaughtUp} />
    </div>
  );
}

interface SettingsAppearanceSectionProps {
  readonly themeMode: ThemeMode;
  readonly onSetThemeMode: (mode: ThemeMode) => void;
  readonly composerDeviceMode: ComposerDeviceMode;
  readonly onSetComposerDeviceMode: (mode: ComposerDeviceMode) => void;
  readonly streamReveal: StreamRevealMode;
  readonly onSetStreamReveal: (mode: StreamRevealMode) => void;
  readonly streamRevealSpeed: StreamRevealSpeed;
  readonly onSetStreamRevealSpeed: (speed: StreamRevealSpeed) => void;
  readonly threadTransition: ThreadTransitionSettings;
  readonly onSetThreadTransition: (settings: Partial<ThreadTransitionSettings>) => void;
}

const THREAD_TRANSITION_MOTION_OPTIONS: { motion: ThreadTransitionMotion; label: string; description: string }[] = [
  { motion: "off", label: "Off", description: "Composer appears docked instantly — no travel animation." },
  { motion: "curve", label: "Curve", description: "Launches at full speed, then eases slowly into the dock." },
  { motion: "dock", label: "Dock", description: "Builds speed fast, then a long glide that decelerates into the dock." },
  { motion: "spring", label: "Spring", description: "Physical spring that settles with a visible natural overshoot." },
];

const STREAM_SPEED_OPTIONS: { speed: StreamRevealSpeed; label: string; description: string }[] = [
  { speed: "low", label: "Low", description: "Calm, deliberate reveal that stays close to the model's real cadence." },
  { speed: "medium", label: "Medium (default)", description: "Balanced reveal — steady on a trickle, catches up gently on bursts." },
  { speed: "high", label: "High", description: "Fast reveal that races through buffered text — minimal lag." },
];

const STREAM_REVEAL_OPTIONS: { mode: StreamRevealMode; label: string; description: string }[] = [
  { mode: "plain", label: "Plain fade", description: "Words simply fade in — no blur, the lightest reveal." },
  { mode: "blur", label: "Blur (default)", description: "Words resolve from soft-focus into sharp as they fade in." },
  { mode: "blur-rise", label: "Blur + rise", description: "Blur reveal with a subtle upward settle, like text flowing in." },
  { mode: "warm", label: "Warm ink", description: "Each new word starts in the accent colour and settles to ink, like drying ink." },
  { mode: "glow", label: "Glow", description: "A faint accent glow trails each freshly typed word, then fades." },
];

const COMPOSER_DEVICE_OPTIONS: { mode: ComposerDeviceMode; label: string; description: string }[] = [
  { mode: "modular-cream", label: "Modular (Cream)", description: "Premium audio-hardware look: warm ivory screen with dark charcoal text instead of the green CRT." },
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
  composerDeviceMode,
  onSetComposerDeviceMode,
  streamReveal,
  onSetStreamReveal,
  streamRevealSpeed,
  onSetStreamRevealSpeed,
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
        {COMPOSER_DEVICE_OPTIONS.map((option) => (
          <SettingsRow
            key={option.mode}
            title={`Composer device mode: ${option.label}`}
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

      <SettingsGroup title="Streaming text reveal">
        {STREAM_REVEAL_OPTIONS.map((option) => (
          <SettingsRow key={option.mode} title={option.label} description={option.description}>
            <input
              checked={streamReveal === option.mode}
              name="stream-reveal"
              type="radio"
              onChange={() => onSetStreamReveal(option.mode)}
            />
          </SettingsRow>
        ))}
        {STREAM_SPEED_OPTIONS.map((option) => (
          <SettingsRow
            key={option.speed}
            title={`Reveal speed: ${option.label}`}
            description={option.description}
          >
            <input
              checked={streamRevealSpeed === option.speed}
              name="stream-reveal-speed"
              type="radio"
              onChange={() => onSetStreamRevealSpeed(option.speed)}
            />
          </SettingsRow>
        ))}
        <StreamRevealPreview mode={streamReveal} />
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

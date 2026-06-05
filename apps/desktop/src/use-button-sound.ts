import { useCallback, useRef, type PointerEvent } from "react";
import {
  type ButtonCategory,
  playClick,
  playKey,
  playRotary,
  type ButtonClickVariant,
} from "./button-click-sound";

interface UseButtonSoundOptions {
  /** Button category for sound settings lookup */
  category?: ButtonCategory;
  /** Override variant (ignores category settings) */
  variant?: ButtonClickVariant;
  /** Whether sound is disabled */
  disabled?: boolean;
}

interface UseButtonSoundResult {
  onPointerDown: (e: PointerEvent<HTMLElement>) => void;
  onPointerUp: (e: PointerEvent<HTMLElement>) => void;
  onPointerLeave: (e: PointerEvent<HTMLElement>) => void;
}

/**
 * Hook that adds press/release sound feedback to a button.
 *
 * Usage:
 * ```tsx
 * const buttonSound = useButtonSound({ category: "primary" });
 * <button {...buttonSound} onClick={handleClick}>Submit</button>
 * ```
 */
export function useButtonSound(options: UseButtonSoundOptions = {}): UseButtonSoundResult {
  const { category, variant, disabled = false } = options;
  const pressingRef = useRef(false);

  const handlePointerDown = useCallback(
    (e: PointerEvent<HTMLElement>) => {
      if (disabled || e.button !== 0) return; // Only primary button
      pressingRef.current = true;

      if (variant) {
        // Use explicit variant
        if (variant === "click") playClick("down");
        else if (variant === "key") playKey("press");
        else if (variant === "rotary") playRotary();
      } else if (category) {
        // Import settings dynamically to avoid circular deps
        import("./button-click-sound.js").then(({ getButtonSoundSettings }) => {
          const settings = getButtonSoundSettings();
          const v = settings[category];
          if (v === "click") playClick("down");
          else if (v === "key") playKey("press");
          else if (v === "rotary") playRotary();
        });
      }
    },
    [category, variant, disabled]
  );

  const handlePointerUp = useCallback(
    (e: PointerEvent<HTMLElement>) => {
      if (disabled || !pressingRef.current) return;
      pressingRef.current = false;

      if (variant) {
        // Use explicit variant
        if (variant === "click") playClick("up");
        else if (variant === "key") playKey("release");
        else if (variant === "rotary") playRotary();
      } else if (category) {
        import("./button-click-sound.js").then(({ getButtonSoundSettings }) => {
          const settings = getButtonSoundSettings();
          const v = settings[category];
          if (v === "click") playClick("up");
          else if (v === "key") playKey("release");
          else if (v === "rotary") playRotary();
        });
      }
    },
    [category, variant, disabled]
  );

  const handlePointerLeave = useCallback(() => {
    pressingRef.current = false;
  }, []);

  return {
    onPointerDown: handlePointerDown,
    onPointerUp: handlePointerUp,
    onPointerLeave: handlePointerLeave,
  };
}

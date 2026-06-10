/**
 * Hold-to-reveal composer shortcut hints.
 *
 * When the user holds a bare ⌘ (or Ctrl) for HOLD_MS without pressing any
 * other key, reveal the keycap hints anchored to the composer controls by
 * toggling a root class. Pressing any non-modifier key (i.e. actually using a
 * shortcut, or just typing) cancels the pending reveal, so the hints never
 * flash during normal day-to-day use. Releasing the modifier (or window blur)
 * hides them again.
 *
 * Purely cosmetic and decoupled from command logic; mirrors
 * physical-key-feedback.ts. Listens in the capture phase so a closer handler
 * calling stopPropagation can't suppress it.
 */

const HOLD_MS = 1000;
const ROOT_CLASS = "pi-hints-visible";

function isModifierKey(key: string): boolean {
  return key === "Meta" || key === "Control";
}

export function installShortcutHints(): () => void {
  let timer: number | undefined;
  let visible = false;

  const show = () => {
    visible = true;
    document.documentElement.classList.add(ROOT_CLASS);
  };

  const hide = () => {
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timer = undefined;
    }
    if (visible) {
      visible = false;
      document.documentElement.classList.remove(ROOT_CLASS);
    }
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (isModifierKey(event.key)) {
      // Auto-repeat after a shortcut already cancelled the reveal: the
      // modifier is still physically held but we already called hide().
      // Ignore so we don't re-arm.
      if (event.repeat) return;

      // Arm the hold timer (only if not already armed).
      if (timer === undefined && !visible) {
        timer = window.setTimeout(() => {
          timer = undefined;
          show();
        }, HOLD_MS);
      }
      return;
    }
    // Any non-modifier key means the user is typing or combo-ing — cancel.
    hide();
  };

  const onKeyUp = (event: KeyboardEvent): void => {
    if (isModifierKey(event.key)) hide();
  };

  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("keyup", onKeyUp, true);
  window.addEventListener("blur", hide);
  // Shortcut combos like ⌘S are consumed by the main process
  // (before-input-event preventDefault), so the renderer never sees the
  // non-modifier keydown that would normally cancel the pending reveal.
  // The command IPC fires when such a shortcut runs, so use it to
  // hide/cancel reliably without depending on a keyup that can be lost.
  const removeCommandListener = window.piApp?.onCommand?.(hide);

  return () => {
    window.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("keyup", onKeyUp, true);
    window.removeEventListener("blur", hide);
    removeCommandListener?.();
    hide();
  };
}

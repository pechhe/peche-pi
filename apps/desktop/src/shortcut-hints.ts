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
  let armed = false;

  const clearTimer = () => {
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timer = undefined;
    }
  };

  const hide = () => {
    clearTimer();
    armed = false;
    document.documentElement.classList.remove(ROOT_CLASS);
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (isModifierKey(event.key)) {
      // Recovery: if hints are visible but armed is false, the Meta keyup
      // was lost (common when focus shifts during a shortcut combo). Force
      // hide and let the hold re-arm below.
      if (document.documentElement.classList.contains(ROOT_CLASS) && !armed && event.repeat) {
        hide();
      }
      // Holding the modifier alone arms the reveal. Ignore OS auto-repeat —
      // without the `event.repeat` guard, a repeated Meta keydown after a
      // shortcut (which sets armed=false) would re-arm the timer and the
      // hints would flash back on / get stuck if keyup is lost.
      if (!armed && !event.repeat) {
        armed = true;
        timer = window.setTimeout(() => {
          // Only show hints if still armed — prevents a race where hide()
          // cleared the timer but the callback was already queued.
          if (armed) {
            document.documentElement.classList.add(ROOT_CLASS);
          }
        }, HOLD_MS);
      }
      return;
    }
    // Any other key — a shortcut combo (⌘1, ⌘P…), a combo-in-progress (Shift),
    // or plain typing — means the user isn't asking "what can I do here", so
    // cancel the pending reveal / hide immediately.
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
  // non-modifier keydown that would normally cancel the pending reveal —
  // it only sees the bare ⌘ keydown that armed the timer. The command IPC
  // fires when such a shortcut runs, so use it to hide/cancel reliably
  // without depending on a keyup that can be lost on focus changes.
  const removeCommandListener = window.piApp?.onCommand?.(hide);
  return () => {
    window.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("keyup", onKeyUp, true);
    window.removeEventListener("blur", hide);
    removeCommandListener?.();
    hide();
  };
}

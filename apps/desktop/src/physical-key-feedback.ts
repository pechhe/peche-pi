/**
 * Physical-key press feedback.
 *
 * When a composer control is triggered by keyboard (Enter to send, Shift+Tab
 * to cycle thinking, Cmd+T to open the model picker), briefly flash the
 * matching button with `.is-pressed` so it animates as if physically clicked.
 *
 * This is purely cosmetic and fully decoupled from the action logic: it
 * listens in the capture phase so it still fires even when a closer handler
 * calls stopPropagation, and it never flashes a disabled button.
 */

const PRESS_MS = 130;

function flash(el: Element | null): void {
  if (!el || (el as HTMLButtonElement).disabled) return;
  el.classList.add("is-pressed");
  window.setTimeout(() => el.classList.remove("is-pressed"), PRESS_MS);
}

function isInComposer(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest(".composer"));
}

export function installPhysicalKeyFeedback(): () => void {
  const onKeyDown = (event: KeyboardEvent): void => {
    // Enter to send: stay depressed for as long as the key is physically held
    // (no auto-release timeout). Released on keyup below.
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing && isInComposer(event.target)) {
      const el = document.querySelector(".composer__send");
      if (el && !(el as HTMLButtonElement).disabled) el.classList.add("is-pressed");
      return;
    }
    // Shift+Tab cycles thinking level.
    if (event.key === "Tab" && event.shiftKey && !(event.metaKey || event.ctrlKey)) {
      flash(document.querySelector('[data-physical-key="thinking"]'));
      return;
    }
    // Cmd/Ctrl+T opens the model picker.
    if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === "t") {
      flash(document.querySelector('[data-physical-key="model"]'));
      return;
    }
  };
  const onKeyUp = (event: KeyboardEvent): void => {
    if (event.key === "Enter") {
      document.querySelector(".composer__send")?.classList.remove("is-pressed");
    }
  };
  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("keyup", onKeyUp, true);
  return () => {
    window.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("keyup", onKeyUp, true);
  };
}

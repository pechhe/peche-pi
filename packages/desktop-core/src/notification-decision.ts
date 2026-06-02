/**
 * Pure decision logic for desktop notifications.
 *
 * Lives in `@pi-gui/desktop-core` so the same routing rules can be reused
 * by the Tauri sidecar and unit-tested without booting Electron.
 *
 * Decision matrix (when the corresponding preference is enabled):
 *   - window not focused              → toast + sound
 *   - window focused, different sess. → sound only (sidebar unread dot
 *                                       comes from hasUnseenUpdate)
 *   - window focused, same session    → sound only
 *
 * "Same session" means the event's sessionRef is the actively-viewed
 * session: selected, on the threads view, and the window is focused.
 */

export type NotificationEventKind = "runCompleted" | "runFailed" | "hostUiRequest";

export interface NotificationPreferencesInput {
  readonly backgroundCompletion: boolean;
  readonly backgroundFailure: boolean;
  readonly attentionNeeded: boolean;
  readonly playSound: boolean;
}

export interface NotificationDecisionInput {
  readonly eventKind: NotificationEventKind;
  readonly preferences: NotificationPreferencesInput;
  readonly isActivelyViewed: boolean;
  readonly isWindowFocused: boolean;
}

export type NotificationDecision =
  | { readonly kind: "suppressed" }
  | { readonly kind: "fire"; readonly toast: boolean; readonly sound: boolean };

export function decideNotification(input: NotificationDecisionInput): NotificationDecision {
  if (!isPreferenceEnabledForEvent(input.eventKind, input.preferences)) {
    return { kind: "suppressed" };
  }

  const toast = !input.isWindowFocused;
  const sound = input.preferences.playSound;

  if (!toast && !sound) {
    // Window focused and sound disabled — nothing audible/visible to do
    // beyond whatever the renderer already shows (unread dot, etc.).
    return { kind: "suppressed" };
  }

  return { kind: "fire", toast, sound };
}

function isPreferenceEnabledForEvent(
  eventKind: NotificationEventKind,
  preferences: NotificationPreferencesInput,
): boolean {
  switch (eventKind) {
    case "runCompleted":
      return preferences.backgroundCompletion;
    case "runFailed":
      return preferences.backgroundFailure;
    case "hostUiRequest":
      return preferences.attentionNeeded;
  }
}

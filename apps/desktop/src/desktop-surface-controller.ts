/**
 * Desktop Surface Controller — pure routing function.
 *
 * Given a Desktop Surface snapshot and a user input (keyboard command/key),
 * returns a Surface Intent describing what the user wants to happen, or null
 * if the input is not handled.
 *
 * This module does NOT execute workflows, perform IPC calls, own transcript
 * data, own composer data, create Chat Workspaces, or manage terminal
 * process state. It only interprets intent.
 */

import type { AppView } from "./desktop-state";
import type { NavigationEntry } from "./hooks/use-navigation-history";

// ---------------------------------------------------------------------------
// Desktop Surface — the visible app mode the user is operating in.
// ---------------------------------------------------------------------------

export interface DesktopSurface {
  /** Current active view (threads, new-thread, skills, extensions, settings). */
  readonly activeView: AppView;
  /** The currently selected workspace ID. */
  readonly selectedWorkspaceId: string;
  /** The currently selected session ID. */
  readonly selectedSessionId: string;
  /** The root workspace ID for settings/new-thread navigation. */
  readonly rootWorkspaceId: string;
  /** Whether the primary sidebar is collapsed. */
  readonly sidebarCollapsed: boolean;
  /** Session key that has the terminal open, or "" if terminal is hidden. */
  readonly terminalSessionKey: string;
  /** Whether thread search overlay is open. */
  readonly threadSearchOpen: boolean;
  /** Whether the diff panel is open. */
  readonly diffPanelOpen: boolean;
  /** Navigation history for back/forward. */
  readonly navigationHistory: {
    readonly goBack: () => NavigationEntry | null;
    readonly goForward: () => NavigationEntry | null;
  };
}

// ---------------------------------------------------------------------------
// Surface Input — user input to interpret.
// ---------------------------------------------------------------------------

export interface SurfaceInput {
  /** Resolved desktop command from shortcut, if any. */
  readonly command?: string;
  /** Raw key value from the keyboard event. */
  readonly key: string;
  /** Physical key code (e.g. "Comma", "KeyB"). */
  readonly code?: string;
  /** Whether Cmd (macOS) or Ctrl (other) was held. */
  readonly meta: boolean;
  /** Whether Shift was held. */
  readonly shift: boolean;
  /** Whether the event originated inside a terminal element. */
  readonly isInsideTerminal: boolean;
}

// ---------------------------------------------------------------------------
// Surface Intent — interpreted user intent, ready for execution.
// ---------------------------------------------------------------------------

export type SurfaceIntent =
  | { readonly type: "open-settings"; readonly workspaceId: string }
  | { readonly type: "open-new-thread"; readonly workspaceId: string }
  | { readonly type: "toggle-terminal"; readonly sessionId: string; readonly open: boolean }
  | { readonly type: "toggle-sidebar"; readonly visible: boolean }
  | { readonly type: "commit-and-push" }
  | { readonly type: "toggle-thread-search"; readonly open: boolean }
  | { readonly type: "toggle-diff-panel" }
  | { readonly type: "open-model-picker" }
  | { readonly type: "cycle-thinking" }
  | { readonly type: "navigate-back"; readonly entry: NavigationEntry }
  | { readonly type: "navigate-forward"; readonly entry: NavigationEntry };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Whether the primary sidebar can be toggled for the given active view.
 * Extracted from canTogglePrimarySidebar in App.tsx for reuse.
 */
export function canToggleSidebar(_activeView: AppView): boolean {
  return true;
}

// ---------------------------------------------------------------------------
// Pure routing function
// ---------------------------------------------------------------------------

/**
 * Interpret a keyboard input in the context of the current Desktop Surface
 * and return the intended Surface Intent, or null if unhandled.
 */
export function interpretSurfaceIntent(
  surface: DesktopSurface,
  input: SurfaceInput,
): SurfaceIntent | null {
  const { command, isInsideTerminal } = input;

  // --- Terminal-scoped shortcuts (only Cmd+J to toggle terminal) ---
  if (isInsideTerminal) {
    if (command === "toggle-terminal") {
      return {
        type: "toggle-terminal",
        sessionId: surface.selectedSessionId,
        open: surface.terminalSessionKey !== surface.selectedSessionId,
      };
    }
    return null;
  }

  // --- Non-terminal shortcuts below ---

  // Cmd+F — toggle thread search
  if (input.meta && !input.shift && input.key.toLowerCase() === "f") {
    return { type: "toggle-thread-search", open: !surface.threadSearchOpen };
  }

  // Cmd+D — toggle diff panel
  if (input.meta && !input.shift && input.key.toLowerCase() === "d") {
    return { type: "toggle-diff-panel" };
  }

  // Cmd+T — open model picker
  if (input.meta && !input.shift && input.key.toLowerCase() === "t") {
    return { type: "open-model-picker" };
  }

  // Shift+Tab — cycle thinking level
  if (input.key === "Tab" && input.shift && !input.meta) {
    return { type: "cycle-thinking" };
  }

  // Cmd+[ / Cmd+] — navigation history
  if (input.meta && !input.shift && !input.command) {
    if (input.key === "[") {
      const entry = surface.navigationHistory.goBack();
      if (entry) {
        return { type: "navigate-back", entry };
      }
      return null;
    }
    if (input.key === "]") {
      const entry = surface.navigationHistory.goForward();
      if (entry) {
        return { type: "navigate-forward", entry };
      }
      return null;
    }
  }

  // --- Command-based shortcuts (resolved by getDesktopCommandFromShortcut) ---
  if (command === "open-settings") {
    return { type: "open-settings", workspaceId: surface.rootWorkspaceId };
  }

  if (command === "open-new-thread") {
    return { type: "open-new-thread", workspaceId: surface.rootWorkspaceId };
  }

  if (command === "toggle-terminal") {
    const isOpen = surface.terminalSessionKey === surface.selectedSessionId;
    return {
      type: "toggle-terminal",
      sessionId: surface.selectedSessionId,
      open: !isOpen,
    };
  }

  if (command === "toggle-sidebar") {
    if (!canToggleSidebar(surface.activeView)) {
      return null;
    }
    return { type: "toggle-sidebar", visible: surface.sidebarCollapsed };
  }

  if (command === "commit-and-push") {
    return { type: "commit-and-push" };
  }

  return null;
}

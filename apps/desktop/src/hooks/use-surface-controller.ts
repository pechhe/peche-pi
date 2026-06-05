/**
 * useSurfaceController — thin React hook that wires DOM refs and focus
 * behavior to the pure Desktop Surface Controller.
 *
 * This hook owns:
 * - Keyboard event listener registration
 * - DOM focus execution after intent interpretation
 *
 * It does NOT own workflow execution, IPC calls, transcript data,
 * composer data, or terminal process state.
 */

import { useEffect, useRef } from "react";
import { interpretSurfaceIntent, type SurfaceIntent } from "../desktop-surface-controller";
import type { DesktopSurface } from "../desktop-surface-controller";
export type { DesktopSurface } from "../desktop-surface-controller";
import { getDesktopCommandFromShortcut } from "../ipc";
import type { NavigationEntry } from "./use-navigation-history";

// ---------------------------------------------------------------------------
// Focus target refs — the renderer passes these so the hook can focus them.
// ---------------------------------------------------------------------------

export interface FocusRefs {
  /** Ref to the session composer textarea. */
  readonly composerRef: React.RefObject<HTMLTextAreaElement | null>;
  /** Ref to the new-thread composer textarea. */
  readonly newThreadComposerRef: React.RefObject<HTMLTextAreaElement | null>;
}

// ---------------------------------------------------------------------------
// Intent handler callbacks — the renderer passes these so the hook can
// delegate execution after intent interpretation.
// ---------------------------------------------------------------------------

export interface IntentHandlers {
  readonly openSettings: (workspaceId: string) => void;
  readonly openNewThread: (workspaceId: string) => void;
  readonly toggleTerminal: (sessionId: string, open: boolean) => void;
  readonly toggleSidebar: (visible: boolean) => void;
  readonly commitAndPush: () => void;
  readonly toggleThreadSearch: (open: boolean) => void;
  readonly toggleDiffPanel: () => void;
  readonly openModelPicker: () => void;
  readonly cycleThinking: () => void;
  readonly navigateToEntry: (entry: NavigationEntry) => void;
  readonly focusComposer: () => void;
}

// ---------------------------------------------------------------------------
// Focus execution — which DOM element to focus after an intent.
// ---------------------------------------------------------------------------

function executeFocus(intent: SurfaceIntent, refs: FocusRefs, _handlers: IntentHandlers): void {
  switch (intent.type) {
    case "open-new-thread":
      // After navigating to new-thread view, focus the new-thread composer.
      window.requestAnimationFrame(() => {
        refs.newThreadComposerRef.current?.focus();
      });
      break;
    case "toggle-sidebar":
      // Sidebar toggle does not change focus.
      break;
    case "toggle-terminal":
      // Focus management is handled by the terminal panel onHide callback.
      break;
    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UseSurfaceControllerOptions {
  /** Current desktop surface snapshot. */
  readonly surface: DesktopSurface;
  /** Focus refs for DOM elements. */
  readonly focusRefs: FocusRefs;
  /** Intent handler callbacks. */
  readonly handlers: IntentHandlers;
}

export function useSurfaceController({ surface, focusRefs, handlers }: UseSurfaceControllerOptions): void {
  // Keep a stable ref to the current surface so the event listener doesn't
  // need to be re-registered on every surface change.
  const surfaceRef = useRef(surface);
  surfaceRef.current = surface;

  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const focusRefsRef = useRef(focusRefs);
  focusRefsRef.current = focusRefs;

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      const resolvedCommand = getDesktopCommandFromShortcut({
        modifier: event.metaKey || event.ctrlKey,
        shift: event.shiftKey,
        key: event.key,
        code: event.code,
      });

      const input = {
        command: resolvedCommand,
        key: event.key,
        code: event.code,
        meta: event.metaKey || event.ctrlKey,
        shift: event.shiftKey,
        isInsideTerminal: isEventInsideTerminal(event),
      };

      const intent = interpretSurfaceIntent(surfaceRef.current, input);
      if (!intent) {
        return;
      }

      event.preventDefault();
      const h = handlersRef.current;
      const fr = focusRefsRef.current;

      switch (intent.type) {
        case "open-settings":
          h.openSettings(intent.workspaceId);
          break;
        case "open-new-thread":
          h.openNewThread(intent.workspaceId);
          break;
        case "toggle-terminal":
          h.toggleTerminal(intent.sessionId, intent.open);
          break;
        case "toggle-sidebar":
          h.toggleSidebar(intent.visible);
          break;
        case "commit-and-push":
          h.commitAndPush();
          break;
        case "toggle-thread-search":
          h.toggleThreadSearch(intent.open);
          break;
        case "toggle-diff-panel":
          h.toggleDiffPanel();
          break;
        case "open-model-picker":
          h.openModelPicker();
          break;
        case "cycle-thinking":
          h.cycleThinking();
          break;
        case "navigate-back":
        case "navigate-forward":
          h.navigateToEntry(intent.entry);
          break;
      }

      executeFocus(intent, fr, h);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);
}

// ---------------------------------------------------------------------------
// Helper — same as App.tsx isEventInsideTerminal, kept local to this module.
// ---------------------------------------------------------------------------

function isEventInsideTerminal(event: globalThis.KeyboardEvent): boolean {
  const target = event.target;
  return target instanceof Element && Boolean(target.closest("[data-pi-terminal]"));
}

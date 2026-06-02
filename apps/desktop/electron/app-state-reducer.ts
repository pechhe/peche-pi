import type { DesktopAppState } from "../src/desktop-state";

/**
 * Pure state-transition layer for the desktop app.
 *
 * `reduce(state, action)` is a pure function: no I/O, no Electron, no
 * PiSdkDriver, no clock. Every write to `DesktopAppState` goes through
 * here so the state shape has a single enforcement point and is
 * unit-testable in isolation.
 *
 * Convention: when an action would not change the state, `reduce`
 * returns the *same* state reference. Callers can detect a no-op via
 * identity check (`next === state`).
 *
 * Convention: any action that produces a real state change clears
 * `lastError` and bumps `revision`. Those cross-cutting concerns belong
 * to the reducer, not to each caller.
 *
 * This module is the seam being grown. Today it handles a single
 * action; sibling `app-store-*.ts` files will be migrated one slice at
 * a time as we deepen candidate #2.
 */

export type DesktopAction =
  | { readonly type: "settings/setSidebarCollapsed"; readonly sidebarCollapsed: boolean };

export function reduce(state: DesktopAppState, action: DesktopAction): DesktopAppState {
  switch (action.type) {
    case "settings/setSidebarCollapsed": {
      if (state.sidebarCollapsed === action.sidebarCollapsed) {
        return state;
      }
      return bump({ ...state, sidebarCollapsed: action.sidebarCollapsed });
    }
  }
}

/**
 * Standard tail applied to every real state change: clear `lastError`
 * and bump `revision`. Kept private to the reducer so the convention
 * cannot drift across action handlers.
 */
function bump(state: DesktopAppState): DesktopAppState {
  return { ...state, lastError: undefined, revision: state.revision + 1 };
}

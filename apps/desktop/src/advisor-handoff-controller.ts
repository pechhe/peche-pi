/**
 * Advisor Handoff Controller — pure state-machine for advisor panel + handoff intents.
 *
 * Follows the desktop-surface-controller pattern: pure function, no I/O, no IPC.
 * Maps user intents (open advisor, close, set scope, promote, hand-back) to
 * state transitions.
 */

// ---------------------------------------------------------------------------
// Advisor Panel State
// ---------------------------------------------------------------------------

export type AdvisorPanelStatus = "idle" | "loading" | "ready" | "error";

export interface AdvisorPanelState {
  readonly visible: boolean;
  readonly sessionId: string;
  readonly workspaceId: string;
  readonly status: AdvisorPanelStatus;
  readonly scope: HandoffScope;
  readonly tokenEstimate: number;
  readonly errorMessage?: string;
  /** When true, the advisor session will be promoted to a standalone thread on close. */
  readonly promoteOnClose: boolean;
}

export type HandoffScope = "compressed" | "full" | "plan" | "selection";

export function createEmptyAdvisorState(): AdvisorPanelState {
  return {
    visible: false,
    sessionId: "",
    workspaceId: "",
    status: "idle",
    scope: "compressed",
    tokenEstimate: 0,
    promoteOnClose: false,
  };
}

// ---------------------------------------------------------------------------
// Advisor Intents
// ---------------------------------------------------------------------------

export type AdvisorIntent =
  | { readonly type: "open-advisor"; readonly workspaceId: string; readonly sessionId: string }
  | { readonly type: "open-advisor-questionnaire"; readonly workspaceId: string; readonly sessionId: string; readonly questionPrompt: string; readonly questionOptions: readonly string[] }
  | { readonly type: "close-advisor" }
  | { readonly type: "set-scope"; readonly scope: HandoffScope }
  | { readonly type: "set-token-estimate"; readonly estimate: number }
  | { readonly type: "set-status"; readonly status: AdvisorPanelStatus; readonly errorMessage?: string }
  | { readonly type: "set-advisor-session"; readonly sessionId: string }
  | { readonly type: "promote-to-thread" }
  | { readonly type: "hand-back" }
  | { readonly type: "toggle-promote-on-close" };

// ---------------------------------------------------------------------------
// Pure state transition
// ---------------------------------------------------------------------------

/**
 * Apply an advisor intent to the current state, returning a new state.
 * Returns the same reference if no change (identity check for no-op).
 */
export function reduceAdvisorState(
  state: AdvisorPanelState,
  intent: AdvisorIntent,
): AdvisorPanelState {
  switch (intent.type) {
    case "open-advisor":
      return {
        ...state,
        visible: true,
        workspaceId: intent.workspaceId,
        sessionId: intent.sessionId,
        status: "loading",
        scope: "compressed",
        tokenEstimate: 0,
        errorMessage: undefined,
        promoteOnClose: false,
      };

    case "open-advisor-questionnaire":
      return {
        ...state,
        visible: true,
        workspaceId: intent.workspaceId,
        sessionId: intent.sessionId,
        status: "loading",
        scope: "compressed",
        tokenEstimate: 0,
        errorMessage: undefined,
        promoteOnClose: false,
      };

    case "close-advisor":
      return {
        ...state,
        visible: false,
        // Keep sessionId so the session persists for reopening
        status: "idle",
        errorMessage: undefined,
      };

    case "set-scope":
      if (state.scope === intent.scope) return state;
      return { ...state, scope: intent.scope };

    case "set-token-estimate":
      if (state.tokenEstimate === intent.estimate) return state;
      return { ...state, tokenEstimate: intent.estimate };

    case "set-status":
      return {
        ...state,
        status: intent.status,
        errorMessage: intent.errorMessage,
      };

    case "set-advisor-session":
      return {
        ...state,
        sessionId: intent.sessionId,
        status: "ready",
      };

    case "promote-to-thread":
      // Promotion navigates the main view to the advisor session.
      // The caller handles the actual navigation; we just mark it.
      return {
        ...state,
        visible: false,
        promoteOnClose: false,
      };

    case "hand-back":
      // Hand-back sends the advisor's answer to the main composer as a draft.
      // The caller handles the actual IPC; we just signal the intent.
      return state;

    case "toggle-promote-on-close":
      return { ...state, promoteOnClose: !state.promoteOnClose };

    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Intent interpretation — what should the caller do after reducing?
// ---------------------------------------------------------------------------

export type AdvisorSideEffect =
  | { readonly type: "build-payload"; readonly workspaceId: string; readonly sessionId: string; readonly scope: HandoffScope }
  | { readonly type: "build-questionnaire-payload"; readonly workspaceId: string; readonly sessionId: string; readonly questionPrompt: string; readonly questionOptions: readonly string[] }
  | { readonly type: "navigate-to-session"; readonly sessionId: string }
  | { readonly type: "set-composer-draft"; readonly text: string }
  | null;

/**
 * After applying the intent, determine if a side effect is needed.
 * The caller (App.tsx) executes the side effect; the controller stays pure.
 */
export function getAdvisorSideEffect(
  state: AdvisorPanelState,
  intent: AdvisorIntent,
): AdvisorSideEffect {
  switch (intent.type) {
    case "open-advisor":
      return {
        type: "build-payload",
        workspaceId: intent.workspaceId,
        sessionId: intent.sessionId,
        scope: state.scope,
      };

    case "open-advisor-questionnaire":
      return {
        type: "build-questionnaire-payload",
        workspaceId: intent.workspaceId,
        sessionId: intent.sessionId,
        questionPrompt: intent.questionPrompt,
        questionOptions: intent.questionOptions,
      };

    case "promote-to-thread":
      if (state.sessionId) {
        return { type: "navigate-to-session", sessionId: state.sessionId };
      }
      return null;

    case "hand-back":
      // The caller reads the advisor transcript and injects it as a draft.
      // This is handled imperatively in App.tsx, not through this pure function.
      return null;

    default:
      return null;
  }
}

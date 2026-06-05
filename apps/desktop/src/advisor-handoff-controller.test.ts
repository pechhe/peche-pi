import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  reduceAdvisorState,
  getAdvisorSideEffect,
  createEmptyAdvisorState,
  type AdvisorIntent,
  type AdvisorPanelState,
} from "./advisor-handoff-controller.ts";

function expect(actual: unknown) {
  return {
    toBe: (expected: unknown) => assert.strictEqual(actual, expected),
    toEqual: (expected: unknown) => assert.deepStrictEqual(actual, expected),
    toBeNull: () => assert.strictEqual(actual, null),
    toBeDefined: () => assert.notStrictEqual(actual, undefined),
  };
}

describe("reduceAdvisorState", () => {
  it("open-advisor transitions to loading state", () => {
    const state = createEmptyAdvisorState();
    const next = reduceAdvisorState(state, {
      type: "open-advisor",
      workspaceId: "ws-1",
      sessionId: "sess-1",
    });
    expect(next.visible).toBe(true);
    expect(next.status).toBe("loading");
    expect(next.workspaceId).toBe("ws-1");
    expect(next.sessionId).toBe("sess-1");
    expect(next.scope).toBe("compressed");
    expect(next.promoteOnClose).toBe(false);
  });

  it("close-advisor hides panel but retains sessionId", () => {
    const state: AdvisorPanelState = {
      visible: true,
      sessionId: "advisor-1",
      workspaceId: "ws-1",
      status: "ready",
      scope: "full",
      tokenEstimate: 500,
      promoteOnClose: false,
    };
    const next = reduceAdvisorState(state, { type: "close-advisor" });
    expect(next.visible).toBe(false);
    expect(next.sessionId).toBe("advisor-1");
    expect(next.status).toBe("idle");
  });

  it("set-scope updates scope", () => {
    const state = createEmptyAdvisorState();
    const next = reduceAdvisorState(state, { type: "set-scope", scope: "full" });
    expect(next.scope).toBe("full");
  });

  it("set-scope returns same reference when unchanged", () => {
    const state = createEmptyAdvisorState();
    const next = reduceAdvisorState(state, { type: "set-scope", scope: "compressed" });
    assert.strictEqual(next, state);
  });

  it("set-token-estimate updates estimate", () => {
    const state = createEmptyAdvisorState();
    const next = reduceAdvisorState(state, { type: "set-token-estimate", estimate: 1234 });
    expect(next.tokenEstimate).toBe(1234);
  });

  it("set-status updates status and error", () => {
    const state = createEmptyAdvisorState();
    const next = reduceAdvisorState(state, {
      type: "set-status",
      status: "error",
      errorMessage: "Network failure",
    });
    expect(next.status).toBe("error");
    expect(next.errorMessage).toBe("Network failure");
  });

  it("set-advisor-session sets session ID and marks ready", () => {
    const state = { ...createEmptyAdvisorState(), status: "loading" as const };
    const next = reduceAdvisorState(state, { type: "set-advisor-session", sessionId: "adv-1" });
    expect(next.sessionId).toBe("adv-1");
    expect(next.status).toBe("ready");
  });

  it("promote-to-thread hides panel", () => {
    const state = { ...createEmptyAdvisorState(), visible: true, sessionId: "adv-1" };
    const next = reduceAdvisorState(state, { type: "promote-to-thread" });
    expect(next.visible).toBe(false);
  });

  it("hand-back returns same reference (side effect only)", () => {
    const state = createEmptyAdvisorState();
    const next = reduceAdvisorState(state, { type: "hand-back" });
    assert.strictEqual(next, state);
  });

  it("toggle-promote-on-close flips the flag", () => {
    const state = createEmptyAdvisorState();
    expect(state.promoteOnClose).toBe(false);
    const next = reduceAdvisorState(state, { type: "toggle-promote-on-close" });
    expect(next.promoteOnClose).toBe(true);
    const back = reduceAdvisorState(next, { type: "toggle-promote-on-close" });
    expect(back.promoteOnClose).toBe(false);
  });

  it("open-advisor-questionnaire transitions to loading", () => {
    const state = createEmptyAdvisorState();
    const next = reduceAdvisorState(state, {
      type: "open-advisor-questionnaire",
      workspaceId: "ws-1",
      sessionId: "sess-1",
      questionPrompt: "Pick a framework",
      questionOptions: ["React", "Vue"],
    });
    expect(next.visible).toBe(true);
    expect(next.status).toBe("loading");
  });
});

describe("getAdvisorSideEffect", () => {
  it("open-advisor returns build-payload effect", () => {
    const state = createEmptyAdvisorState();
    const effect = getAdvisorSideEffect(state, {
      type: "open-advisor",
      workspaceId: "ws-1",
      sessionId: "sess-1",
    });
    assert.deepStrictEqual(effect, {
      type: "build-payload",
      workspaceId: "ws-1",
      sessionId: "sess-1",
      scope: "compressed",
    });
  });

  it("open-advisor-questionnaire returns build-questionnaire-payload effect", () => {
    const state = createEmptyAdvisorState();
    const effect = getAdvisorSideEffect(state, {
      type: "open-advisor-questionnaire",
      workspaceId: "ws-1",
      sessionId: "sess-1",
      questionPrompt: "Which?",
      questionOptions: ["A", "B"],
    });
    assert.deepStrictEqual(effect, {
      type: "build-questionnaire-payload",
      workspaceId: "ws-1",
      sessionId: "sess-1",
      questionPrompt: "Which?",
      questionOptions: ["A", "B"],
    });
  });

  it("promote-to-thread returns navigate-to-session effect", () => {
    const state = { ...createEmptyAdvisorState(), sessionId: "adv-1" };
    const effect = getAdvisorSideEffect(state, { type: "promote-to-thread" });
    assert.deepStrictEqual(effect, {
      type: "navigate-to-session",
      sessionId: "adv-1",
    });
  });

  it("promote-to-thread with empty session returns null", () => {
    const state = createEmptyAdvisorState();
    const effect = getAdvisorSideEffect(state, { type: "promote-to-thread" });
    expect(effect).toBeNull();
  });

  it("close-advisor returns null", () => {
    const state = createEmptyAdvisorState();
    const effect = getAdvisorSideEffect(state, { type: "close-advisor" });
    expect(effect).toBeNull();
  });

  it("set-scope returns null", () => {
    const state = createEmptyAdvisorState();
    const effect = getAdvisorSideEffect(state, { type: "set-scope", scope: "full" });
    expect(effect).toBeNull();
  });

  it("hand-back returns null (caller handles imperatively)", () => {
    const state = createEmptyAdvisorState();
    const effect = getAdvisorSideEffect(state, { type: "hand-back" });
    expect(effect).toBeNull();
  });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";

function expect(actual: unknown) {
  return {
    toBe: (expected: unknown) => assert.strictEqual(actual, expected),
    toEqual: (expected: unknown) => assert.deepStrictEqual(actual, expected),
    toBeDefined: () => assert.notStrictEqual(actual, undefined),
    toBeUndefined: () => assert.strictEqual(actual, undefined),
    toBeNull: () => assert.strictEqual(actual, null),
    toContain: (expected: unknown) => {
      if (typeof actual === "string") {
        assert.ok(actual.includes(String(expected)));
      } else if (Array.isArray(actual)) {
        assert.ok(actual.includes(expected));
      } else {
        assert.fail("toContain expects a string or array");
      }
    },
    toBeGreaterThan: (expected: number) =>
      assert.ok(typeof actual === "number" && actual > expected),
    toBeGreaterThanOrEqual: (expected: number) =>
      assert.ok(typeof actual === "number" && actual >= expected),
  };
}

import {
  estimateTokens,
  serializeTranscript,
  buildHandoffPayload,
  buildAdvisorPayload,
  buildQuestionnaireAdvisorPayload,
  type HandoffScope,
  type BuildHandoffPayloadInput,
} from "./handoff-core.ts";
import type { TranscriptMessage } from "../src/desktop-state.ts";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeMessage(role: string, text: string, id = `msg-${Math.random()}`): TranscriptMessage {
  return {
    kind: "message",
    id,
    role,
    text,
    createdAt: new Date().toISOString(),
  } as unknown as TranscriptMessage;
}

function makeToolCall(toolName: string, label: string, id = `tool-${Math.random()}`): TranscriptMessage {
  return {
    kind: "tool",
    id,
    toolName,
    label,
    status: "success",
    createdAt: new Date().toISOString(),
  } as unknown as TranscriptMessage;
}

function makeSummary(label: string, id = `sum-${Math.random()}`): TranscriptMessage {
  return {
    kind: "summary",
    id,
    label,
    createdAt: new Date().toISOString(),
    presentation: "divider",
  } as unknown as TranscriptMessage;
}

function makeActivity(label: string, noise = false, id = `act-${Math.random()}`): TranscriptMessage {
  return {
    kind: "activity",
    id,
    label,
    createdAt: new Date().toISOString(),
    noise,
  } as unknown as TranscriptMessage;
}

const sampleTranscript: readonly TranscriptMessage[] = [
  makeMessage("user", "Help me design a REST API"),
  makeMessage("assistant", "Sure, let's start with the resource model..."),
  makeToolCall("read", "Read src/api.ts"),
  makeMessage("assistant", "Based on the existing code, here's my suggestion..."),
];

// ---------------------------------------------------------------------------
// estimateTokens
// ---------------------------------------------------------------------------

describe("estimateTokens", () => {
  it("returns 0 for empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("returns ~1 token per 4 chars", () => {
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
    expect(estimateTokens("a".repeat(100))).toBe(25);
  });
});

// ---------------------------------------------------------------------------
// serializeTranscript
// ---------------------------------------------------------------------------

describe("serializeTranscript", () => {
  it("serializes user and assistant messages", () => {
    const result = serializeTranscript([
      makeMessage("user", "Hello"),
      makeMessage("assistant", "Hi there"),
    ]);
    expect(result).toContain("[user]: Hello");
    expect(result).toContain("[assistant]: Hi there");
  });

  it("serializes tool calls", () => {
    const result = serializeTranscript([makeToolCall("read", "Read file.ts")]);
    expect(result).toContain("[tool: read]");
    expect(result).toContain("Read file.ts");
  });

  it("serializes summaries", () => {
    const result = serializeTranscript([makeSummary("Compacted context")]);
    expect(result).toContain("[summary]");
    expect(result).toContain("Compacted context");
  });

  it("skips noise activities", () => {
    const result = serializeTranscript([
      makeActivity("Important event", false),
      makeActivity("Noisy chatter", true),
    ]);
    expect(result).toContain("Important event");
    assert.ok(!result.includes("Noisy chatter"));
  });

  it("skips reasoning messages", () => {
    const result = serializeTranscript([{
      kind: "reasoning",
      id: "r1",
      createdAt: new Date().toISOString(),
      text: "Deep thoughts...",
    } as unknown as TranscriptMessage]);
    assert.ok(!result.includes("Deep thoughts"));
  });

  it("returns empty string for empty transcript", () => {
    expect(serializeTranscript([])).toBe("");
  });
});

// ---------------------------------------------------------------------------
// buildHandoffPayload
// ---------------------------------------------------------------------------

describe("buildHandoffPayload", () => {
  const sessionRef = { workspaceId: "ws-1", sessionId: "sess-1" };

  it("full scope includes serialized transcript", async () => {
    const payload = await buildHandoffPayload(sampleTranscript, {
      sessionRef,
      scope: "full",
    });
    expect(payload.scope).toBe("full");
    expect(payload.seedText).toContain("Full Transcript");
    expect(payload.seedText).toContain("[user]: Help me design a REST API");
    expect(payload.tokenEstimate).toBeGreaterThan(0);
  });

  it("plan scope includes full context", async () => {
    const payload = await buildHandoffPayload(sampleTranscript, {
      sessionRef,
      scope: "plan",
    });
    expect(payload.scope).toBe("plan");
    expect(payload.seedText).toContain("Full Context");
    expect(payload.seedText).toContain("[user]: Help me design a REST API");
  });

  it("compressed scope uses summary when available", async () => {
    const getSummary = async () => "This is a test summary.";
    const payload = await buildHandoffPayload(sampleTranscript, {
      sessionRef,
      scope: "compressed",
    }, getSummary);
    expect(payload.scope).toBe("compressed");
    expect(payload.seedText).toContain("Conversation Context");
    expect(payload.seedText).toContain("This is a test summary.");
    // Should NOT include raw transcript
    assert.ok(!payload.seedText.includes("Full Transcript"));
  });

  it("compressed scope works without summary", async () => {
    const payload = await buildHandoffPayload(sampleTranscript, {
      sessionRef,
      scope: "compressed",
    });
    expect(payload.scope).toBe("compressed");
    expect(payload.tokenEstimate).toBeGreaterThanOrEqual(0);
  });

  it("selection scope includes quoted text and summary", async () => {
    const getSummary = async () => "Summary of context.";
    const payload = await buildHandoffPayload(sampleTranscript, {
      sessionRef,
      scope: "selection",
      quotedText: "Let's start with the resource model",
      userNote: "Explore this approach further",
    }, getSummary);
    expect(payload.scope).toBe("selection");
    expect(payload.seedText).toContain("Quoted Excerpt");
    expect(payload.seedText).toContain("Let's start with the resource model");
    expect(payload.seedText).toContain("User's Request");
    expect(payload.seedText).toContain("Explore this approach further");
    expect(payload.seedText).toContain("Summary of context.");
  });

  it("includes custom framing when provided", async () => {
    const payload = await buildHandoffPayload(sampleTranscript, {
      sessionRef,
      scope: "full",
      framing: "You are a code reviewer.",
    });
    expect(payload.seedText).toContain("You are a code reviewer.");
  });

  it("includes user note with full scope", async () => {
    const payload = await buildHandoffPayload(sampleTranscript, {
      sessionRef,
      scope: "full",
      userNote: "Focus on error handling",
    });
    expect(payload.seedText).toContain("User's Request");
    expect(payload.seedText).toContain("Focus on error handling");
  });

  it("token estimate increases with content", async () => {
    const smallPayload = await buildHandoffPayload([], {
      sessionRef,
      scope: "full",
    });
    const largePayload = await buildHandoffPayload(sampleTranscript, {
      sessionRef,
      scope: "full",
    });
    expect(largePayload.tokenEstimate).toBeGreaterThan(smallPayload.tokenEstimate);
  });
});

// ---------------------------------------------------------------------------
// buildAdvisorPayload
// ---------------------------------------------------------------------------

describe("buildAdvisorPayload", () => {
  it("uses advisor framing", async () => {
    const payload = await buildAdvisorPayload(sampleTranscript, "full");
    expect(payload.seedText).toContain("advisor reviewing a conversation");
    expect(payload.seedText).toContain("second opinion");
  });

  it("passes scope through", async () => {
    const payload = await buildAdvisorPayload(sampleTranscript, "compressed");
    expect(payload.scope).toBe("compressed");
  });
});

// ---------------------------------------------------------------------------
// buildQuestionnaireAdvisorPayload
// ---------------------------------------------------------------------------

describe("buildQuestionnaireAdvisorPayload", () => {
  it("includes question and options in user note", async () => {
    const payload = await buildQuestionnaireAdvisorPayload(
      sampleTranscript,
      "Which framework should we use?",
      ["React", "Vue", "Svelte"],
    );
    expect(payload.seedText).toContain("questionnaire");
    expect(payload.seedText).toContain("Which framework should we use?");
    expect(payload.seedText).toContain("1. React");
    expect(payload.seedText).toContain("2. Vue");
    expect(payload.seedText).toContain("3. Svelte");
  });

  it("uses questionnaire advisor framing", async () => {
    const payload = await buildQuestionnaireAdvisorPayload(
      sampleTranscript,
      "Pick one",
      ["A", "B"],
    );
    expect(payload.seedText).toContain("decide between options");
  });
});

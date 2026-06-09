import { test } from "node:test";
import assert from "node:assert/strict";
import type { SessionDriverEvent, SessionRef, SessionSnapshot } from "@pi-gui/session-driver";
import { DesktopSessionState } from "./app-store-session-state.ts";
import { SessionStateMap } from "./session-state-map.ts";
import { createEmptyDesktopAppState, type DesktopAppState, type SessionRecord } from "../src/desktop-state.ts";

const ref: SessionRef = { workspaceId: "ws1", sessionId: "s1" };
const otherRef: SessionRef = { workspaceId: "ws1", sessionId: "s2" };

function snapshot(
  status: SessionSnapshot["status"] = "running",
  updatedAt = "2026-01-01T00:00:00.000Z",
  sessionRef: SessionRef = ref,
): SessionSnapshot {
  return {
    ref: sessionRef,
    workspace: { workspaceId: sessionRef.workspaceId, path: "/tmp/ws1", displayName: "WS1" },
    title: "Thread 1",
    status,
    updatedAt,
  };
}

function session(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: "s1",
    title: "Thread 1",
    updatedAt: "2026-01-01T00:00:00.000Z",
    preview: "",
    status: "idle",
    hasUnseenUpdate: false,
    isAwaitingAssistantText: false,
    ...overrides,
  };
}

function state(overrides: Partial<DesktopAppState> = {}): DesktopAppState {
  return {
    ...createEmptyDesktopAppState(),
    activeView: "threads",
    selectedWorkspaceId: "ws1",
    selectedSessionId: "s1",
    workspaces: [
      {
        id: "ws1",
        name: "WS1",
        path: "/tmp/ws1",
        kind: "primary",
        lastOpenedAt: "2026-01-01T00:00:00.000Z",
        sessions: [session()],
      },
    ],
    ...overrides,
  };
}

function event(input: { readonly type: SessionDriverEvent["type"]; readonly sessionRef?: SessionRef; readonly [key: string]: unknown }): SessionDriverEvent {
  return { sessionRef: ref, timestamp: "2026-01-01T00:00:01.000Z", ...input } as unknown as SessionDriverEvent;
}

test("DesktopSessionState consumes assistant deltas and builds selected transcript", () => {
  const module = new DesktopSessionState(new SessionStateMap());
  let patch = module.consumeSessionDriverEvent(state(), event({ type: "sessionOpened", snapshot: snapshot() }), {
    sessionActivelyViewed: false,
  });
  patch = module.consumeSessionDriverEvent(patch.state, event({ type: "assistantDelta", text: "hel" }), {
    sessionActivelyViewed: false,
  });
  patch = module.consumeSessionDriverEvent(patch.state, event({ type: "assistantDelta", text: "lo" }), {
    sessionActivelyViewed: false,
  });

  const assistantMessage = patch.selectedTranscript?.transcript.find((item) => item.kind === "message");
  assert.ok(assistantMessage);
  assert.equal(assistantMessage.kind, "message");
  assert.equal(assistantMessage.text, "hello");
  assert.equal(patch.state.workspaces[0]?.sessions[0]?.preview, "hello");
  assert.equal(patch.state.workspaces[0]?.sessions[0]?.status, "running");
  assert.equal(patch.shouldPersistTranscript, true);
});

test("DesktopSessionState projects host UI editor text to selected composer", () => {
  const module = new DesktopSessionState(new SessionStateMap());
  const patch = module.consumeSessionDriverEvent(
    state({ composerDraft: "old", composerDraftSyncNonce: 3 }),
    event({ type: "hostUiRequest", request: { kind: "editorText", requestId: "r1", text: "next" } }),
    { sessionActivelyViewed: false },
  );

  assert.equal(patch.state.composerDraft, "next");
  assert.equal(patch.state.composerDraftSyncSource, "extension-editor-text");
  assert.equal(patch.state.composerDraftSyncNonce, 4);
  assert.equal(patch.state.sessionExtensionUiBySession["ws1:s1"]?.editorText, "next");
  assert.equal(patch.shouldPersistTranscript, false);
});

test("DesktopSessionState keeps extension dialogs session-scoped and resets them", () => {
  const module = new DesktopSessionState(new SessionStateMap());
  let patch = module.consumeSessionDriverEvent(
    state(),
    event({ type: "hostUiRequest", request: { kind: "confirm", requestId: "r1", title: "Continue?", message: "Go" } }),
    { sessionActivelyViewed: false },
  );

  assert.equal(patch.state.sessionExtensionUiBySession["ws1:s1"]?.pendingDialogs.length, 1);

  patch = module.consumeSessionDriverEvent(
    patch.state,
    event({ type: "hostUiRequest", request: { kind: "reset", requestId: "r2" } }),
    { sessionActivelyViewed: false },
  );

  assert.equal(patch.state.sessionExtensionUiBySession["ws1:s1"], undefined);
});

test("DesktopSessionState marks actively viewed session viewed", () => {
  const module = new DesktopSessionState(new SessionStateMap());
  const patch = module.consumeSessionDriverEvent(state(), event({ type: "sessionOpened", snapshot: snapshot() }), {
    sessionActivelyViewed: true,
  });

  assert.equal(patch.state.workspaces[0]?.sessions[0]?.hasUnseenUpdate, false);
  assert.ok(patch.state.workspaces[0]?.sessions[0]?.lastViewedAt);
  assert.equal(patch.state.lastViewedAtBySession["ws1:s1"], patch.state.workspaces[0]?.sessions[0]?.lastViewedAt);
});

test("DesktopSessionState consumes reasoning deltas separately from assistant text", () => {
  const module = new DesktopSessionState(new SessionStateMap());
  let patch = module.consumeSessionDriverEvent(state(), event({ type: "reasoningDelta", text: "think" }), {
    sessionActivelyViewed: false,
  });
  patch = module.consumeSessionDriverEvent(patch.state, event({ type: "reasoningDelta", text: " more" }), {
    sessionActivelyViewed: false,
  });

  const reasoning = patch.selectedTranscript?.transcript.find((item) => item.kind === "reasoning");
  assert.ok(reasoning);
  assert.equal(reasoning.kind, "reasoning");
  assert.equal(reasoning.text, "think more");
  assert.equal(patch.state.workspaces[0]?.sessions[0]?.preview, "");
});

test("DesktopSessionState consumes tool lifecycle and run completion", () => {
  const module = new DesktopSessionState(new SessionStateMap());
  let patch = module.consumeSessionDriverEvent(
    state(),
    event({ type: "sessionUpdated", snapshot: snapshot("running"), timestamp: "2026-01-01T00:00:00.000Z" }),
    { sessionActivelyViewed: false },
  );
  patch = module.consumeSessionDriverEvent(
    patch.state,
    event({ type: "toolStarted", callId: "call-1", toolName: "read", input: { path: "a.ts" } }),
    { sessionActivelyViewed: false },
  );
  patch = module.consumeSessionDriverEvent(
    patch.state,
    event({ type: "toolFinished", callId: "call-1", toolName: "read", success: true, output: "done" }),
    { sessionActivelyViewed: false },
  );
  patch = module.consumeSessionDriverEvent(
    patch.state,
    event({ type: "runCompleted", snapshot: snapshot("idle"), timestamp: "2026-01-01T00:00:05.000Z" }),
    { sessionActivelyViewed: false },
  );

  const transcript = patch.selectedTranscript?.transcript ?? [];
  const tool = transcript.find((item) => item.kind === "tool");
  assert.ok(tool);
  assert.equal(tool.kind, "tool");
  assert.equal(tool.status, "success");
  assert.equal(patch.state.workspaces[0]?.sessions[0]?.status, "idle");
  assert.equal(patch.state.workspaces[0]?.sessions[0]?.runningSince, undefined);
  assert.equal(patch.shouldPersistUiImmediately, true);
});

test("DesktopSessionState projects run failure state and persistence flags", () => {
  const module = new DesktopSessionState(new SessionStateMap());
  const patch = module.consumeSessionDriverEvent(
    state(),
    event({ type: "runFailed", error: { message: "Boom", code: "E_FAIL" }, timestamp: "2026-01-01T00:01:00.000Z" }),
    { sessionActivelyViewed: false },
  );

  const activity = patch.selectedTranscript?.transcript.find((item) => item.kind === "activity");
  assert.ok(activity);
  assert.equal(activity.kind, "activity");
  assert.equal(activity.tone, "error");
  assert.equal(patch.state.workspaces[0]?.sessions[0]?.status, "failed");
  assert.equal(patch.shouldPersistUiImmediately, true);
});

test("DesktopSessionState emits selected transcript only for selected session", () => {
  const module = new DesktopSessionState(new SessionStateMap());
  const twoSessionState = state({
    workspaces: [
      {
        id: "ws1",
        name: "WS1",
        path: "/tmp/ws1",
        kind: "primary",
        lastOpenedAt: "2026-01-01T00:00:00.000Z",
        sessions: [session(), session({ id: "s2", title: "Thread 2" })],
      },
    ],
  });

  const unselectedPatch = module.consumeSessionDriverEvent(
    twoSessionState,
    event({ type: "assistantDelta", sessionRef: otherRef, text: "other" }),
    { sessionActivelyViewed: false },
  );
  assert.equal(unselectedPatch.selectedTranscript, null);

  const selectedPatch = module.consumeSessionDriverEvent(
    { ...unselectedPatch.state, selectedSessionId: "s2" },
    event({ type: "assistantDelta", sessionRef: otherRef, text: " session" }),
    { sessionActivelyViewed: false },
  );
  assert.equal(selectedPatch.selectedTranscript?.sessionId, "s2");
  const assistant = selectedPatch.selectedTranscript?.transcript.find((item) => item.kind === "message");
  assert.equal(assistant?.kind === "message" ? assistant.text : undefined, "other session");
});

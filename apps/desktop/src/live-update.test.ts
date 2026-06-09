import { test } from "node:test";
import assert from "node:assert/strict";
import { createEmptyDesktopAppState, type DesktopAppState, type SessionRecord, type WorkspaceRecord } from "./desktop-state.ts";
import { applyDesktopLiveUpdate, applySelectedTranscriptLiveUpdate, shouldFlushLiveUpdateImmediately } from "./live-update.ts";

function session(overrides: Omit<SessionRecord, "title" | "updatedAt" | "preview" | "status" | "hasUnseenUpdate" | "isAwaitingAssistantText"> & Partial<Pick<SessionRecord, "title" | "updatedAt" | "preview" | "status" | "hasUnseenUpdate" | "isAwaitingAssistantText">>): SessionRecord {
  return {
    title: `Session ${overrides.id}`,
    updatedAt: "2026-01-01T00:00:00.000Z",
    preview: "",
    status: "idle",
    hasUnseenUpdate: false,
    isAwaitingAssistantText: false,
    ...overrides,
  };
}

function workspaceRecord(id: string, sessions: readonly SessionRecord[]): WorkspaceRecord {
  return {
    id,
    name: id,
    path: `/tmp/${id}`,
    lastOpenedAt: "2026-01-01T00:00:00.000Z",
    kind: "primary",
    sessions,
  };
}

function stateWithWorkspaces(workspaces: readonly WorkspaceRecord[]): DesktopAppState {
  return {
    ...createEmptyDesktopAppState(),
    workspaces,
    selectedWorkspaceId: workspaces[0]?.id ?? "",
    selectedSessionId: workspaces[0]?.sessions[0]?.id ?? "",
  };
}

test("workspace-session patch preserves unrelated workspace and session identities", () => {
  const unchangedSession = session({ id: "s-1" });
  const changedSession = session({ id: "s-2", status: "running" });
  const untouchedWorkspace = workspaceRecord("w-2", [session({ id: "s-3" })]);
  const initialWorkspace = workspaceRecord("w-1", [unchangedSession, changedSession]);
  const initial = stateWithWorkspaces([initialWorkspace, untouchedWorkspace]);

  const updatedSession = { ...changedSession, preview: "streaming preview" };
  const next = applyDesktopLiveUpdate(initial, {
    type: "workspace-session",
    workspaceId: "w-1",
    session: updatedSession,
  })!;

  assert.notEqual(next, initial);
  assert.equal(next.workspaces[1], untouchedWorkspace);
  assert.equal(next.workspaces[0]!.sessions[0], unchangedSession);
  assert.equal(next.workspaces[0]!.sessions[1], updatedSession);
});

test("workspace-session patch is a no-op when the row data is unchanged", () => {
  const existing = session({ id: "s-1", title: "Existing" });
  const initial = stateWithWorkspaces([workspaceRecord("w-1", [existing])]);
  const next = applyDesktopLiveUpdate(initial, {
    type: "workspace-session",
    workspaceId: "w-1",
    session: { ...existing },
  });

  assert.equal(next, initial);
});

test("workspace-session patch appends a new session when not found", () => {
  const initial = stateWithWorkspaces([workspaceRecord("w-1", [])]);
  const newSession = session({ id: "s-new" });
  const next = applyDesktopLiveUpdate(initial, {
    type: "workspace-session",
    workspaceId: "w-1",
    session: newSession,
  })!;

  assert.notEqual(next, initial);
  assert.equal(next.workspaces[0]!.sessions.length, 1);
  assert.equal(next.workspaces[0]!.sessions[0], newSession);
});

test("workspace-session patch ignores unknown workspace", () => {
  const initial = stateWithWorkspaces([workspaceRecord("w-1", [session({ id: "s-1" })])]);
  const next = applyDesktopLiveUpdate(initial, {
    type: "workspace-session",
    workspaceId: "unknown",
    session: session({ id: "s-x" }),
  });

  assert.equal(next, initial);
});

test("selected-session metadata ignores stale session patches", () => {
  const initial = stateWithWorkspaces([workspaceRecord("w-1", [session({ id: "selected" })])]);
  const next = applyDesktopLiveUpdate(initial, {
    type: "selected-session-metadata",
    workspaceId: "w-1",
    sessionId: "other",
    queuedComposerMessages: [{ id: "q", mode: "followUp", text: "later", attachments: [], createdAt: "t", updatedAt: "t" }],
  });

  assert.equal(next, initial);
});

test("selected-session metadata patches queued messages for the selected session", () => {
  const initial = stateWithWorkspaces([workspaceRecord("w-1", [session({ id: "selected" })])]);
  const queuedMessages = [{ id: "q-1", mode: "followUp" as const, text: "hello", attachments: [], createdAt: "t", updatedAt: "t" }];
  const next = applyDesktopLiveUpdate(initial, {
    type: "selected-session-metadata",
    workspaceId: "w-1",
    sessionId: "selected",
    queuedComposerMessages: queuedMessages,
  })!;

  assert.notEqual(next, initial);
  assert.equal(next.queuedComposerMessages, queuedMessages);
});

test("selected transcript updates are immediate and separate from state patches", () => {
  const payload = { workspaceId: "w-1", sessionId: "s-1", transcript: [] as const };
  assert.equal(shouldFlushLiveUpdateImmediately({ type: "selected-transcript", payload }), true);
  assert.equal(applySelectedTranscriptLiveUpdate(null, { type: "selected-transcript", payload }), payload);
});

test("navigation updates are flushed immediately", () => {
  assert.equal(shouldFlushLiveUpdateImmediately({ type: "navigation", state: createEmptyDesktopAppState() }), true);
});

test("workspace-session patches are not immediate-flush", () => {
  assert.equal(shouldFlushLiveUpdateImmediately({ type: "workspace-session", workspaceId: "w-1", session: null }), false);
});

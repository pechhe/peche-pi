import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createEmptyDesktopAppState,
  type DesktopAppState,
  type SessionRecord,
  type WorkspaceRecord,
} from "./desktop-state.ts";
import { deriveOverlayComposerProps } from "./overlay-composer-props.ts";

function session(overrides: Partial<SessionRecord> & { readonly id: string }): SessionRecord {
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

function stateWith(workspaces: readonly WorkspaceRecord[], overrides?: Partial<DesktopAppState>): DesktopAppState {
  return {
    ...createEmptyDesktopAppState(),
    workspaces,
    selectedWorkspaceId: workspaces[0]?.id ?? "",
    selectedSessionId: workspaces[0]?.sessions[0]?.id ?? "",
    ...overrides,
  };
}

test("deriveOverlayComposerProps returns null when there is no snapshot", () => {
  assert.equal(deriveOverlayComposerProps(null), null);
});

test("deriveOverlayComposerProps returns null when no session is selected", () => {
  const state = stateWith([workspaceRecord("w-1", [])], { selectedSessionId: "" });
  assert.equal(deriveOverlayComposerProps(state), null);
});

test("deriveOverlayComposerProps derives the selected session, workspace, and key", () => {
  const selected = session({ id: "s-1" });
  const state = stateWith([workspaceRecord("w-1", [selected])]);

  const derived = deriveOverlayComposerProps(state);
  assert.ok(derived);
  assert.equal(derived.selectedSession.id, "s-1");
  assert.equal(derived.selectedWorkspace.id, "w-1");
  assert.equal(derived.selectedSessionKey, "w-1:s-1");
});

test("deriveOverlayComposerProps resolves provider/model/thinking from the session config", () => {
  const selected = session({
    id: "s-1",
    config: { provider: "anthropic", modelId: "claude-x", thinkingLevel: "high" },
  });
  const state = stateWith([workspaceRecord("w-1", [selected])]);

  const derived = deriveOverlayComposerProps(state);
  assert.ok(derived);
  assert.equal(derived.resolvedSessionProvider, "anthropic");
  assert.equal(derived.resolvedSessionModelId, "claude-x");
  assert.equal(derived.resolvedSessionThinkingLevel, "high");
});

test("deriveOverlayComposerProps reads composer state with safe defaults", () => {
  const selected = session({ id: "s-1" });
  const state = stateWith([workspaceRecord("w-1", [selected])], {
    composerDraft: "hello",
  });

  const derived = deriveOverlayComposerProps(state);
  assert.ok(derived);
  assert.equal(derived.persistedComposerDraft, "hello");
  assert.deepEqual(derived.snapshotComposerAttachments, []);
  assert.deepEqual(derived.queuedMessages, []);
  assert.deepEqual(derived.selectedSessionCommands, []);
  assert.deepEqual(derived.selectedWorkspaceCommandCompatibility, []);
});

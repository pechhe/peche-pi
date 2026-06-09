import { test } from "node:test";
import assert from "node:assert/strict";
import type { DesktopAppState } from "../src/desktop-state.ts";
import { createEmptyDesktopAppState } from "../src/desktop-state.ts";
import type { AppStoreInternals } from "./app-store-internals.ts";
import { SessionStateMap } from "./session-state-map.ts";
import type { SessionRef } from "@pi-gui/session-driver";
import type { RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import type { ExtensionCommandCompatibilityRecord } from "../src/desktop-state.ts";
import type { PendingRuntimeCommandExecution } from "./extension-command-compatibility.ts";
import type { WorkspaceRef } from "@pi-gui/session-driver";
import { ComposerManager } from "./app-store-composer-manager.ts";

/* ── Fake store ──────────────────────────────────────────── */

function createFakeStore(overrides?: Partial<DesktopAppState>): AppStoreInternals {
  const state = { ...createEmptyDesktopAppState(), ...overrides };
  const sessionState = new SessionStateMap();

  return {
    state,
    sessionState,
    runtimeByWorkspace: new Map<string, RuntimeSnapshot>(),
    extensionCommandCompatibilityByWorkspace: new Map<string, Map<string, ExtensionCommandCompatibilityRecord>>(),
    pendingRuntimeCommandsBySession: new Map<string, PendingRuntimeCommandExecution>(),
    workspaceRefFromState: () => undefined,
    selectedSessionRef: () => undefined,
    sessionFromState: () => undefined,
    findNextQueuedSession: () => undefined,
    driver: {} as any,
    catalogStore: {} as any,
    worktreeManager: {} as any,
    attachmentStore: {} as any,
    getExtensionFilePath: () => undefined,
    initialize: async () => {},
    refreshState: async () => state,
    emit: () => state,
    withError: async () => state,
    withErrorHandling: async (fn) => fn(),
    refreshRuntime: async () => state,
    selectSessionFast: async () => state,
    ensureSessionReady: async () => undefined,
    ensureSessionSubscription: async () => {},
    ensureSessionSubscribed: async () => {},
    refreshSessionCommandsFor: async () => {},
    buildCreateSessionOptions: async () => undefined,
    ensureChatWorkspace: async () => ({} as WorkspaceRef),
    cancelPendingDialogsForSession: async () => {},
    clearExtensionUiForSession: () => {},
    updateSessionConfig: () => {},
    setPendingAutoTitle: () => {},
    getPendingAutoTitle: () => undefined,
    clearPendingAutoTitle: () => {},
    setThreadType: () => {},
    getLearnedRuntimeCommandCompatibility: () => undefined,
    beginRuntimeCommandExecution: () => {},
    finishRuntimeCommandExecution: () => undefined,
    updateQueuedComposerMessages: () => {},
    getQueuedComposerMessages: () => [],
    setQueuedComposerEditState: () => {},
    getQueuedComposerEditState: () => undefined,
    publishSelectedTranscript: () => {},
    publishSelectedTranscriptFor: () => {},
    reloadTranscriptFromDriver: async () => {},
    persistUiState: async () => {},
    persistComposerAttachments: async () => {},
    persistTranscriptCacheForSession: () => {},
    schedulePersistUiState: () => {},
  };
}

/* ── Tests ───────────────────────────────────────────────── */

const ref: SessionRef = { workspaceId: "ws-1", sessionId: "s-1" };

test("ComposerManager.updateQueuedComposerMessages stores messages by session", () => {
  const store = createFakeStore();
  const mgr = new ComposerManager({ store });

  mgr.updateQueuedComposerMessages(ref, [
    { id: "m-1", text: "hello", mode: "followUp", createdAt: "2026-01-01", updatedAt: "2026-01-01" },
    { id: "m-2", text: "steer this", mode: "steer", createdAt: "2026-01-01", updatedAt: "2026-01-01" },
  ]);

  const messages = mgr.getQueuedComposerMessages(ref);
  assert.equal(messages.length, 2);
  assert.equal(messages[0]!.id, "m-1");
  assert.equal(messages[0]!.mode, "followUp");
  assert.equal(messages[1]!.id, "m-2");
  assert.equal(messages[1]!.mode, "steer");
});

test("ComposerManager.updateQueuedComposerMessages clears messages and edit state when empty", () => {
  const store = createFakeStore();
  const mgr = new ComposerManager({ store });

  mgr.updateQueuedComposerMessages(ref, [
    { id: "m-1", text: "hello", mode: "followUp", createdAt: "2026-01-01", updatedAt: "2026-01-01" },
  ]);
  mgr.setQueuedComposerEditState(ref, { messageId: "m-1", restoreDraft: "", restoreAttachments: [] });
  assert.equal(mgr.getQueuedComposerMessages(ref).length, 1);
  assert.ok(mgr.getQueuedComposerEditState(ref));

  mgr.updateQueuedComposerMessages(ref, undefined);
  assert.equal(mgr.getQueuedComposerMessages(ref).length, 0);
  assert.equal(mgr.getQueuedComposerEditState(ref), undefined);
});

test("ComposerManager.updateQueuedComposerMessages clears edit state when edited message is removed", () => {
  const store = createFakeStore();
  const mgr = new ComposerManager({ store });

  mgr.updateQueuedComposerMessages(ref, [
    { id: "m-1", text: "hello", mode: "followUp", createdAt: "2026-01-01", updatedAt: "2026-01-01" },
    { id: "m-2", text: "world", mode: "followUp", createdAt: "2026-01-01", updatedAt: "2026-01-01" },
  ]);
  mgr.setQueuedComposerEditState(ref, { messageId: "m-1", restoreDraft: "", restoreAttachments: [] });

  // Remove m-1, keep m-2
  mgr.updateQueuedComposerMessages(ref, [
    { id: "m-2", text: "world", mode: "followUp", createdAt: "2026-01-01", updatedAt: "2026-01-01" },
  ]);

  assert.equal(mgr.getQueuedComposerMessages(ref).length, 1);
  assert.equal(mgr.getQueuedComposerEditState(ref), undefined);
});

test("ComposerManager.getQueuedComposerMessages returns empty for unknown session", () => {
  const store = createFakeStore();
  const mgr = new ComposerManager({ store });

  const messages = mgr.getQueuedComposerMessages({ workspaceId: "ws-99", sessionId: "s-99" });
  assert.equal(messages.length, 0);
});

test("ComposerManager.setQueuedComposerEditState stores and clears edit state", () => {
  const store = createFakeStore();
  const mgr = new ComposerManager({ store });

  assert.equal(mgr.getQueuedComposerEditState(ref), undefined);

  mgr.setQueuedComposerEditState(ref, {
    messageId: "m-1",
    restoreDraft: "draft text",
    restoreAttachments: [],
  });

  const editState = mgr.getQueuedComposerEditState(ref);
  assert.ok(editState);
  assert.equal(editState.messageId, "m-1");
  assert.equal(editState.restoreDraft, "draft text");

  mgr.setQueuedComposerEditState(ref, undefined);
  assert.equal(mgr.getQueuedComposerEditState(ref), undefined);
});

test("ComposerManager.reloadTranscriptFromDriver loads transcript into cache", async () => {
  const store = createFakeStore();
  const transcript = [
    { kind: "user" as const, text: "hello", id: "u-1" },
    { kind: "assistant" as const, text: "hi there", id: "a-1" },
  ];
  (store.driver as any).getTranscript = async () => transcript;

  const mgr = new ComposerManager({ store });

  await mgr.reloadTranscriptFromDriver(ref);

  const key = `ws-1:s-1`;
  const cached = store.sessionState.transcriptCache.get(key);
  assert.ok(cached);
  assert.equal(cached.length, 2);
  assert.ok(store.sessionState.loadedTranscriptKeys.has(key));
});

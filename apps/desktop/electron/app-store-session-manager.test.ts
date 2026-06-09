import { test } from "node:test";
import assert from "node:assert/strict";
import type { DesktopAppState } from "../src/desktop-state.ts";
import { createEmptyDesktopAppState } from "../src/desktop-state.ts";
import type { AppStoreInternals } from "./app-store-internals.ts";
import { SessionStateMap } from "./session-state-map.ts";
import type { RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import type { ExtensionCommandCompatibilityRecord } from "../src/desktop-state.ts";
import type { PendingRuntimeCommandExecution } from "./extension-command-compatibility.ts";
import type { WorkspaceRef, SessionRef } from "@pi-gui/session-driver";
import { SessionManager } from "./app-store-session-manager.ts";

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

test("SessionManager.ensureSessionReady delegates to store", async () => {
  const store = createFakeStore();
  let called = false;
  store.ensureSessionReady = async () => { called = true; return undefined; };
  const mgr = new SessionManager({ store });

  const result = await mgr.ensureSessionReady(ref);
  assert.equal(called, true);
  assert.equal(result, undefined);
});

test("SessionManager.ensureSessionSubscribed delegates to store", async () => {
  const store = createFakeStore();
  let called = false;
  store.ensureSessionSubscribed = async () => { called = true; };
  const mgr = new SessionManager({ store });

  await mgr.ensureSessionSubscribed(ref);
  assert.equal(called, true);
});

test("SessionManager.refreshSessionCommandsFor delegates to store", async () => {
  const store = createFakeStore();
  let calledWith: SessionRef | undefined;
  store.refreshSessionCommandsFor = async (sr) => { calledWith = sr; };
  const mgr = new SessionManager({ store });

  await mgr.refreshSessionCommandsFor(ref);
  assert.deepEqual(calledWith, ref);
});

test("SessionManager.updateSessionConfig stores config in sessionState", () => {
  const store = createFakeStore();
  const mgr = new SessionManager({ store });

  mgr.updateSessionConfig(ref, { provider: "openai", modelId: "gpt-4" });
  const key = `ws-1:s-1`;
  const config = store.sessionState.sessionConfigBySession.get(key);
  assert.ok(config);
  assert.equal(config.provider, "openai");
  assert.equal(config.modelId, "gpt-4");
});

test("SessionManager.updateSessionConfig deletes config when empty", () => {
  const store = createFakeStore();
  const key = `ws-1:s-1`;
  store.sessionState.sessionConfigBySession.set(key, { provider: "openai" });
  const mgr = new SessionManager({ store });

  mgr.updateSessionConfig(ref, undefined);
  assert.equal(store.sessionState.sessionConfigBySession.has(key), false);
});

test("SessionManager.setPendingAutoTitle / getPendingAutoTitle / clearPendingAutoTitle", () => {
  const store = createFakeStore();
  const mgr = new SessionManager({ store });

  const cancelCalled = { value: false };
  mgr.setPendingAutoTitle(ref, { requestToken: "tok-1", cancel: () => { cancelCalled.value = true; } });
  const pending = mgr.getPendingAutoTitle(ref);
  assert.ok(pending);
  assert.equal(pending.requestToken, "tok-1");

  mgr.clearPendingAutoTitle(ref);
  assert.equal(mgr.getPendingAutoTitle(ref), undefined);
  assert.equal(cancelCalled.value, true);
});

test("SessionManager.setThreadType delegates to store", () => {
  const store = createFakeStore();
  let calledWith: { sessionId: string; type: string } | undefined;
  store.setThreadType = (sid, type) => { calledWith = { sessionId: sid, type }; };
  const mgr = new SessionManager({ store });

  mgr.setThreadType("s-1", "plan");
  assert.ok(calledWith);
  assert.equal(calledWith.sessionId, "s-1");
  assert.equal(calledWith.type, "plan");
});

test("SessionManager.beginRuntimeCommandExecution stores command in pendingRuntimeCommandsBySession", () => {
  const store = createFakeStore();
  const mgr = new SessionManager({ store });
  const cmd = { name: "test", source: "runtime" } as any;

  mgr.beginRuntimeCommandExecution(ref, cmd);
  const key = `ws-1:s-1`;
  const pending = store.pendingRuntimeCommandsBySession.get(key);
  assert.ok(pending);
  assert.equal(pending.command, cmd);
});

test("SessionManager.finishRuntimeCommandExecution clears pending and records compatibility", () => {
  const store = createFakeStore();
  const mgr = new SessionManager({ store });
  const cmd = { name: "test", sourceInfo: { path: "/ext" } } as any;

  mgr.beginRuntimeCommandExecution(ref, cmd);
  const result = mgr.finishRuntimeCommandExecution(ref);
  assert.ok(result);
  assert.equal(result.command, cmd);
  assert.equal(store.pendingRuntimeCommandsBySession.has(`ws-1:s-1`), false);
});

test("SessionManager.clearExtensionUiForSession clears extensionUi from sessionState", () => {
  const store = createFakeStore();
  const key = `ws-1:s-1`;
  store.sessionState.extensionUiBySession.set(key, { some: "data" } as any);
  const mgr = new SessionManager({ store });

  mgr.clearExtensionUiForSession(ref);
  assert.equal(store.sessionState.extensionUiBySession.has(key), false);
});

test("SessionManager.clearExtensionUiForSession is no-op when no extensionUi exists", () => {
  const store = createFakeStore();
  const mgr = new SessionManager({ store });

  // Should not throw
  mgr.clearExtensionUiForSession(ref);
});

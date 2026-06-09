import { test } from "node:test";
import assert from "node:assert/strict";

// Test that WorkspaceManager can be imported and constructed.
// The actual workspace operations are tested via the existing
// app-store-workspace.ts integration tests.

test("WorkspaceManager module can be imported", async () => {
  const mod = await import("./app-store-workspace-manager.ts");
  assert.ok(mod.WorkspaceManager);
});

test("WorkspaceManager can be constructed with a fake store", async () => {
  const { WorkspaceManager } = await import("./app-store-workspace-manager.ts");
  const fakeStore = {
    state: {} as any,
    sessionState: {} as any,
    runtimeByWorkspace: new Map(),
    extensionCommandCompatibilityByWorkspace: new Map(),
    pendingRuntimeCommandsBySession: new Map(),
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
    refreshState: async () => ({} as any),
    emit: () => ({} as any),
    withError: async () => ({} as any),
    withErrorHandling: async (fn: any) => fn(),
    refreshRuntime: async () => ({} as any),
    selectSessionFast: async () => ({} as any),
    ensureSessionReady: async () => undefined,
    ensureSessionSubscription: async () => {},
    ensureSessionSubscribed: async () => {},
    refreshSessionCommandsFor: async () => {},
    buildCreateSessionOptions: async () => undefined,
    ensureChatWorkspace: async () => ({} as any),
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
    subscribeToSessionEvents: () => () => {},
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

  const mgr = new WorkspaceManager({ store: fakeStore as any });
  assert.ok(mgr);
  assert.equal(typeof mgr.addWorkspace, "function");
  assert.equal(typeof mgr.selectSession, "function");
  assert.equal(typeof mgr.createSession, "function");
  assert.equal(typeof mgr.archiveSession, "function");
  assert.equal(typeof mgr.unarchiveSession, "function");
  assert.equal(typeof mgr.snoozeSession, "function");
  assert.equal(typeof mgr.unsnoozeSession, "function");
  assert.equal(typeof mgr.markToTestSession, "function");
  assert.equal(typeof mgr.unmarkToTestSession, "function");
  assert.equal(typeof mgr.syncCurrentWorkspace, "function");
});

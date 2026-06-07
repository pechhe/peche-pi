import assert from "node:assert/strict";
import test from "node:test";
import {
  SessionRuntimeRegistry,
} from "../src/session-runtime-registry.ts";
import type {
  AgentSessionRuntime,
  AgentSession,
  CreateAgentSessionOptions,
  SessionManager as RealSessionManager,
} from "@earendil-works/pi-coding-agent";
import type { SessionEventListener, WorkspaceRef } from "@pi-gui/session-driver";

// ---------------------------------------------------------------------------
// Fake helpers — lightweight stubs that satisfy the registry interface
// ---------------------------------------------------------------------------

function fakeSessionManager(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    getSessionFile: () => "/tmp/fake.session.json",
    buildSessionContext: () => ({ thinkingLevel: "medium", model: null }),
    appendSessionInfo: () => {},
    appendModelChange: () => {},
    appendThinkingLevelChange: () => {},
    getEntries: () => [],
    getTree: () => [],
    getLeafId: () => "leaf",
    ...overrides,
  } as unknown as RealSessionManager;
}

function fakeSession(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    sessionId: "session-1",
    sessionFile: "/tmp/fake.session.json",
    sessionManager: fakeSessionManager(),
    sessionName: "Test Session",
    isStreaming: false,
    messages: [],
    model: { contextWindow: 100_000 },
    getContextUsage: () => ({ tokens: 1234, contextWindow: 100_000, percent: 1.234 }),
    agent: { state: { model: null, thinkingLevel: "medium" }, waitForIdle: async () => {} },
    abort: async () => {},
    dispose: () => {},
    reload: async () => {},
    compact: async () => {},
    prompt: async () => {},
    subscribe: (_listener: SessionEventListener) => () => {},
    bindExtensions: async () => {},
    supportsThinking: () => true,
    getAvailableThinkingLevels: () => ["off", "low", "medium", "high"],
    navigateTree: async () => ({ cancelled: false }),
    clearQueue: () => {},
    extensionRunner: undefined,
    promptTemplates: [],
    resourceLoader: { getSkills: () => ({ skills: [] }) },
    settingsManager: { getDefaultThinkingLevel: () => "medium" },
    modelRegistry: { find: () => undefined, getApiKeyAndHeaders: async () => ({ ok: false, error: "no key" }) },
    ...overrides,
  } as unknown as AgentSession;
}

function fakeRuntime(sessionOverrides: Partial<Record<string, unknown>> = {}) {
  const session = fakeSession(sessionOverrides);
  return {
    session,
    dispose: async () => {},
    setRebindSession: (_handler: (session: AgentSession) => void) => {},
    newSession: async () => ({ cancelled: false }),
    fork: async () => ({ cancelled: false }),
    switchSession: async () => ({ cancelled: false }),
  } as unknown as AgentSessionRuntime;
}

const FAKE_WORKSPACE: WorkspaceRef = {
  workspaceId: "/workspace",
  path: "/workspace",
  displayName: "Workspace",
};

function makeCatalogs(overrides: Record<string, unknown> = {}) {
  return {
    sessions: {
      getSession: async () => null,
      listSessions: async () => ({ sessions: [] }),
      upsertSession: async () => {},
      deleteSession: async () => {},
      ...(overrides.sessions as Record<string, unknown>),
    },
    workspaces: {
      getWorkspace: async () => null,
      listWorkspaces: async () => ({ workspaces: [] }),
      upsertWorkspace: async () => {},
      deleteWorkspace: async () => {},
      ...(overrides.workspaces as Record<string, unknown>),
    },
    getSessionFile: async () => undefined,
    setSessionFile: async () => {},
    replaceWorkspaceSessions: async () => {},
    ...(overrides as Record<string, unknown>),
  } as any;
}

function createRegistry(
  catalogOverrides: Record<string, unknown> = {},
  factory?: (options?: CreateAgentSessionOptions) => Promise<AgentSessionRuntime>,
) {
  return new SessionRuntimeRegistry({
    runtimeFactory: factory ?? (async () => fakeRuntime()),
    modelRegistry: undefined,
    catalogs: makeCatalogs(catalogOverrides),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("createRecord returns a stable record with correct defaults", () => {
  const registry = createRegistry();
  const runtime = fakeRuntime();
  const record = registry.createRecord(FAKE_WORKSPACE, runtime, "My Thread");

  assert.equal(record.title, "My Thread");
  assert.equal(record.status, "idle");
  assert.equal(record.closed, false);
  assert.equal(record.runtime, runtime);
  assert.equal(record.session, runtime.session);
  assert.equal(record.workspace.workspaceId, FAKE_WORKSPACE.workspaceId);
  assert.equal(record.ref.workspaceId, FAKE_WORKSPACE.workspaceId);
  assert.equal(record.ref.sessionId, runtime.session.sessionId);
  assert.equal(record.listeners.size, 0);
  assert.equal(record.queuedMessages.length, 0);
  assert.equal(record.sessionFile, "/tmp/fake.session.json");
});

test("snapshotForRecord returns a snapshot reflecting current record state", () => {
  const registry = createRegistry();
  const runtime = fakeRuntime();
  const record = registry.createRecord(FAKE_WORKSPACE, runtime, "Title");
  record.status = "running";
  record.updatedAt = "2026-01-01T00:00:00.000Z";
  record.preview = "Hello world";

  const snapshot = registry.snapshotForRecord(record);
  assert.equal(snapshot.title, "Title");
  assert.equal(snapshot.status, "running");
  assert.equal(snapshot.updatedAt, "2026-01-01T00:00:00.000Z");
  assert.equal(snapshot.preview, "Hello world");
  assert.equal(snapshot.ref.sessionId, record.ref.sessionId);
});

test("snapshotForRecord reflects authoritative context usage from getContextUsage", () => {
  const registry = createRegistry();
  const runtime = fakeRuntime();
  const record = registry.createRecord(FAKE_WORKSPACE, runtime, "Title");

  const snapshot = registry.snapshotForRecord(record);
  assert.deepEqual(snapshot.contextUsage, { usedTokens: 1234, contextWindow: 100_000 });
});

test("snapshotForRecord omits context usage when tokens is null (post-compaction)", () => {
  const registry = createRegistry();
  // tokens is null right after compaction / before the next LLM response.
  const runtime = fakeRuntime({
    getContextUsage: () => ({ tokens: null, contextWindow: 100_000, percent: null }),
  });
  const record = registry.createRecord(FAKE_WORKSPACE, runtime, "Title");

  const snapshot = registry.snapshotForRecord(record);
  assert.equal(snapshot.contextUsage, undefined);
});

test("snapshotForRecord omits context usage when getContextUsage returns undefined", () => {
  const registry = createRegistry();
  const runtime = fakeRuntime({ getContextUsage: () => undefined });
  const record = registry.createRecord(FAKE_WORKSPACE, runtime, "Title");

  const snapshot = registry.snapshotForRecord(record);
  assert.equal(snapshot.contextUsage, undefined);
});

test("getRecord returns undefined for unknown session", () => {
  const registry = createRegistry();
  const result = registry.getRecord({ workspaceId: "/ws", sessionId: "unknown" });
  assert.equal(result, undefined);
});

test("getRecord returns the record after registerRecord", () => {
  const registry = createRegistry();
  const runtime = fakeRuntime();
  const record = registry.createRecord(FAKE_WORKSPACE, runtime, "T");
  registry.registerRecord(record);

  const found = registry.getRecord(record.ref);
  assert.equal(found, record);
});

test("ensureRecord throws when session not in catalog", async () => {
  const registry = createRegistry();
  await assert.rejects(
    () => registry.ensureRecord({ workspaceId: "/ws", sessionId: "nope" }),
    (err: Error) => {
      assert.match(err.message, /not in the catalog/);
      return true;
    },
  );
});

test("ensureRecord opens a persisted session via runtime factory", async () => {
  const openedSession = fakeSession({ sessionId: "opened-1" });
  const openedRuntime = fakeRuntime({ sessionId: "opened-1" });
  openedRuntime.session = openedSession;

  const registry = createRegistry(
    {
      sessions: {
        getSession: async () => ({
          sessionRef: { workspaceId: "/ws", sessionId: "s1" },
          workspaceId: "/ws",
          title: "Persisted",
          updatedAt: "2026-01-01T00:00:00.000Z",
          status: "idle",
          sessionFilePath: "/tmp/s1.json",
        }),
        listSessions: async () => ({ sessions: [] }),
        upsertSession: async () => {},
        deleteSession: async () => {},
      },
      workspaces: {
        getWorkspace: async () => ({
          workspaceId: "/ws",
          path: "/ws",
          displayName: "W",
        }),
        listWorkspaces: async () => ({ workspaces: [] }),
        upsertWorkspace: async () => {},
        deleteWorkspace: async () => {},
      },
      getSessionFile: async () => "/tmp/s1.json",
    },
    async () => openedRuntime,
  );

  const record = await registry.ensureRecord({ workspaceId: "/ws", sessionId: "s1" });
  assert.equal(record.session, openedSession);
  assert.equal(record.title, "Persisted");
  assert.equal(record.sessionFile, "/tmp/s1.json");
  assert.equal(record.closed, false);
});

test("ensureRecord returns existing live record without re-opening", async () => {
  const registry = createRegistry();
  const runtime = fakeRuntime();
  const record = registry.createRecord(FAKE_WORKSPACE, runtime, "T");
  registry.registerRecord(record);

  const result = await registry.ensureRecord(record.ref);
  assert.equal(result, record);
});

test("ensureRecord re-opens a closed record", async () => {
  const openedRuntime = fakeRuntime({ sessionId: "s1" });

  const registry = createRegistry(
    {
      sessions: {
        getSession: async () => ({
          sessionRef: { workspaceId: "/ws", sessionId: "s1" },
          workspaceId: "/ws",
          title: "Closed",
          updatedAt: "2026-01-01T00:00:00.000Z",
          status: "idle",
          sessionFilePath: "/tmp/s1.json",
        }),
        listSessions: async () => ({ sessions: [] }),
        upsertSession: async () => {},
        deleteSession: async () => {},
      },
      workspaces: {
        getWorkspace: async () => ({
          workspaceId: "/ws",
          path: "/ws",
          displayName: "W",
        }),
        listWorkspaces: async () => ({ workspaces: [] }),
        upsertWorkspace: async () => {},
        deleteWorkspace: async () => {},
      },
      getSessionFile: async () => "/tmp/s1.json",
    },
    async () => openedRuntime,
  );

  // First ensure opens it
  const first = await registry.ensureRecord({ workspaceId: "/ws", sessionId: "s1" });
  assert.equal(first.closed, false);

  // Close it
  await registry.closeSession(first.ref);
  assert.equal(first.closed, true);

  // Second ensure re-opens
  const second = await registry.ensureRecord({ workspaceId: "/ws", sessionId: "s1" });
  assert.equal(second.closed, false);
  assert.equal(second.session, openedRuntime.session);
});

test("closeSession aborts session and disposes runtime", async () => {
  let aborted = false;
  let disposed = false;
  const session = fakeSession({
    abort: async () => { aborted = true; },
  });
  const runtime = fakeRuntime();
  runtime.session = session;
  runtime.dispose = async () => { disposed = true; };

  const registry = createRegistry();
  const record = registry.createRecord(FAKE_WORKSPACE, runtime, "T");
  record.session = session;
  registry.registerRecord(record);

  await registry.closeSession(record.ref);

  assert.equal(record.closed, true);
  assert.equal(record.status, "idle");
  assert.equal(record.runningRunId, undefined);
  assert.equal(aborted, true);
  assert.equal(disposed, true);
  assert.equal(record.runtime, undefined);
  assert.equal(record.session, undefined);
});

test("closeSession is a no-op for unknown session", async () => {
  const registry = createRegistry();
  // Should not throw
  await registry.closeSession({ workspaceId: "/ws", sessionId: "unknown" });
});

test("closeSession handles missing session gracefully", async () => {
  const registry = createRegistry();
  const runtime = fakeRuntime();
  const record = registry.createRecord(FAKE_WORKSPACE, runtime, "T");
  record.session = undefined;
  record.runtime = undefined;
  registry.registerRecord(record);

  await registry.closeSession(record.ref);
  assert.equal(record.closed, true);
});

test("rebind migrates key when session ID changes", () => {
  const registry = createRegistry();
  const runtime = fakeRuntime({ sessionId: "old-id" });
  const record = registry.createRecord(FAKE_WORKSPACE, runtime, "T");
  registry.registerRecord(record);

  const oldKey = "old-id"; // from fakeRuntime({ sessionId: "old-id" })
  assert.equal(registry.getRecord({ workspaceId: FAKE_WORKSPACE.workspaceId, sessionId: oldKey }), record);

  // Rebind with new session ID
  const newSession = fakeSession({ sessionId: "new-id" });
  registry.rebind(record, newSession);

  // Old key removed
  assert.equal(registry.getRecord({ workspaceId: FAKE_WORKSPACE.workspaceId, sessionId: oldKey }), undefined);
  // New key present
  const newKey = registry.getRecord({ workspaceId: FAKE_WORKSPACE.workspaceId, sessionId: "new-id" });
  assert.equal(newKey, record);
  assert.equal(record.ref.sessionId, "new-id");
  assert.equal(record.session, newSession);
});

test("rebind transfers listeners from existing target record", () => {
  const registry = createRegistry();

  // Create two records with different session IDs
  const runtime1 = fakeRuntime({ sessionId: "id-1" });
  const record1 = registry.createRecord(FAKE_WORKSPACE, runtime1, "R1");
  registry.registerRecord(record1);

  const runtime2 = fakeRuntime({ sessionId: "id-2" });
  const record2 = registry.createRecord(FAKE_WORKSPACE, runtime2, "R2");
  registry.registerRecord(record2);

  // Add a listener to record2
  const listener2: SessionEventListener = () => {};
  record2.listeners.add(listener2);

  // Rebind record1 with session ID matching record2
  const newSession = fakeSession({ sessionId: "id-2" });
  registry.rebind(record1, newSession);

  // Listener transferred to record1
  assert.equal(record1.listeners.has(listener2), true);
  // record2's runtime disposed, record2 removed from map
  assert.equal(registry.getRecord({ workspaceId: FAKE_WORKSPACE.workspaceId, sessionId: "id-2" }), record1);
});

test("disposeRuntime disposes runtime when present", async () => {
  let disposed = false;
  const runtime = fakeRuntime();
  runtime.dispose = async () => { disposed = true; };

  const registry = createRegistry();
  const record = registry.createRecord(FAKE_WORKSPACE, runtime, "T");

  await registry.disposeRuntime(record);
  assert.equal(disposed, true);
  assert.equal(record.runtime, undefined);
  assert.equal(record.session, undefined);
  assert.deepEqual(record.sessionCommands, []);
});

test("disposeRuntime disposes session when runtime is absent", () => {
  let sessionDisposed = false;
  const session = fakeSession({
    dispose: () => { sessionDisposed = true; },
  });

  const registry = createRegistry();
  const record = registry.createRecord(FAKE_WORKSPACE, fakeRuntime(), "T");
  record.runtime = undefined;
  record.session = session;

  // disposeRuntime is sync in this path (session.dispose is sync)
  void registry.disposeRuntime(record);
  assert.equal(sessionDisposed, true);
  assert.equal(record.session, undefined);
});

test("cancelPendingHostUiRequests resolves all pending with cancelled", () => {
  const registry = createRegistry();
  const record = registry.createRecord(FAKE_WORKSPACE, fakeRuntime(), "T");

  let resolved1: any = null;
  let resolved2: any = null;
  record.pendingHostUiRequests.set("req-1", {
    resolve: (r) => { resolved1 = r; },
    reject: () => {},
  });
  record.pendingHostUiRequests.set("req-2", {
    resolve: (r) => { resolved2 = r; },
    reject: () => {},
  });

  registry.cancelPendingHostUiRequests(record);

  assert.deepEqual(resolved1, { requestId: "req-1", cancelled: true });
  assert.deepEqual(resolved2, { requestId: "req-2", cancelled: true });
  assert.equal(record.pendingHostUiRequests.size, 0);
});

test("subscribe adds listener and returns unsubscribe that removes from all records", () => {
  const registry = createRegistry();
  const runtime = fakeRuntime();
  const record = registry.createRecord(FAKE_WORKSPACE, runtime, "T");
  registry.registerRecord(record);

  const listener: SessionEventListener = () => {};
  const unsub = registry.subscribe(record, listener);

  assert.equal(record.listeners.has(listener), true);

  unsub();

  assert.equal(record.listeners.has(listener), false);
});

test("getRecordsForWorkspace yields only matching records", () => {
  const registry = createRegistry();

  const r1 = registry.createRecord({ ...FAKE_WORKSPACE, workspaceId: "/ws-a" }, fakeRuntime({ sessionId: "r1-session" }), "A");
  const r2 = registry.createRecord({ ...FAKE_WORKSPACE, workspaceId: "/ws-b" }, fakeRuntime({ sessionId: "r2-session" }), "B");
  const r3 = registry.createRecord({ ...FAKE_WORKSPACE, workspaceId: "/ws-a" }, fakeRuntime({ sessionId: "r3-session" }), "C");
  registry.registerRecord(r1);
  registry.registerRecord(r2);
  registry.registerRecord(r3);

  const wsARecords = [...registry.getRecordsForWorkspace("/ws-a")];
  assert.equal(wsARecords.length, 2);
  assert.equal(wsARecords.includes(r1), true);
  assert.equal(wsARecords.includes(r3), true);

  const wsBRecords = [...registry.getRecordsForWorkspace("/ws-b")];
  assert.equal(wsBRecords.length, 1);
  assert.equal(wsBRecords[0], r2);

  const wsCRecords = [...registry.getRecordsForWorkspace("/ws-c")];
  assert.equal(wsCRecords.length, 0);
});

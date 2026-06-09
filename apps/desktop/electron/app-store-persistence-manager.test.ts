import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DesktopAppState } from "../src/desktop-state";
import { createEmptyDesktopAppState } from "../src/desktop-state";
import type { AppStoreInternals, RefreshStateOptions } from "./app-store-internals";
import { SessionStateMap } from "./session-state-map";
import { JsonFileStore } from "./json-file-store";
import type { ComposerAttachment, TranscriptMessage } from "../src/desktop-state";
import type { SessionRef } from "@pi-gui/session-driver";
import type { RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import type { ExtensionCommandCompatibilityRecord } from "../src/desktop-state";
import type { PendingRuntimeCommandExecution } from "./extension-command-compatibility";
import type { WorkspaceRef } from "@pi-gui/session-driver";
import { PersistenceManager } from "./app-store-persistence-manager";
import { writePersistedUiState, type PersistedUiState } from "./app-store-persistence";

/* ── Fake store ──────────────────────────────────────────── */

function createFakeStore(overrides?: Partial<DesktopAppState>): AppStoreInternals {
  const state = { ...createEmptyDesktopAppState(), ...overrides };
  const sessionState = new SessionStateMap();
  const extensionCommandCompatibilityByWorkspace = new Map<string, Map<string, ExtensionCommandCompatibilityRecord>>();
  const pendingRuntimeCommandsBySession = new Map<string, PendingRuntimeCommandExecution>();
  const runtimeByWorkspace = new Map<string, RuntimeSnapshot>();

  return {
    state,
    sessionState,
    runtimeByWorkspace,
    extensionCommandCompatibilityByWorkspace,
    pendingRuntimeCommandsBySession,
    workspaceRefFromState: () => undefined,
    selectedSessionRef: () => undefined,
    sessionFromState: () => undefined,
    findNextQueuedSession: () => undefined,
    driver: {} as any,
    catalogStore: {} as any,
    worktreeManager: {} as any,
    attachmentStore: { write: async () => {}, read: async () => null } as any,
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
}

async function withTempDir<T>(run: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "pi-persist-mgr-test-"));
  try {
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/* ── Tests ───────────────────────────────────────────────── */

test("PersistenceManager.persistUiState writes state to disk", async () => {
  await withTempDir(async (dir) => {
    const uiStatePath = join(dir, "ui-state.json");
    const transcriptDir = join(dir, "transcripts");
    const attachmentsDir = join(dir, "attachments");
    await mkdir(transcriptDir, { recursive: true });
    await mkdir(attachmentsDir, { recursive: true });

    const store = createFakeStore({
      selectedWorkspaceId: "ws-1",
      selectedSessionId: "sess-1",
      activeView: "conversation",
      sidebarCollapsed: true,
    });

    const transcriptStore = new JsonFileStore<TranscriptMessage[] | { version: 1; transcript: readonly TranscriptMessage[] }>(
      transcriptDir,
      "transcript",
    );
    const attachmentStore = new JsonFileStore<ComposerAttachment[]>(attachmentsDir, "attachments");

    const mgr = new PersistenceManager({
      store,
      uiStateFilePath: uiStatePath,
      transcriptStore,
      attachmentStore,
    });

    await mgr.persistUiState();

    const raw = await readFile(uiStatePath, "utf8");
    const parsed = JSON.parse(raw) as PersistedUiState;
    assert.equal(parsed.selectedWorkspaceId, "ws-1");
    assert.equal(parsed.selectedSessionId, "sess-1");
    assert.equal(parsed.activeView, "conversation");
    assert.equal(parsed.sidebarCollapsed, true);
    assert.equal(parsed.version, 10);
  });
});

test("PersistenceManager.persistUiState clears timer before writing", async () => {
  await withTempDir(async (dir) => {
    const uiStatePath = join(dir, "ui-state.json");
    const transcriptDir = join(dir, "transcripts");
    const attachmentsDir = join(dir, "attachments");
    await mkdir(transcriptDir, { recursive: true });
    await mkdir(attachmentsDir, { recursive: true });

    const store = createFakeStore({ selectedWorkspaceId: "ws-2" });
    const transcriptStore = new JsonFileStore<any>(transcriptDir, "transcript");
    const attachmentStore = new JsonFileStore<any>(attachmentsDir, "attachments");

    const mgr = new PersistenceManager({
      store,
      uiStateFilePath: uiStatePath,
      transcriptStore,
      attachmentStore,
    });

    // Schedule a persist, then call persistUiState directly — the timer should be cleared
    mgr.schedulePersistUiState();
    await mgr.persistUiState();

    const raw = await readFile(uiStatePath, "utf8");
    const parsed = JSON.parse(raw) as PersistedUiState;
    assert.equal(parsed.selectedWorkspaceId, "ws-2");
  });
});

test("PersistenceManager.schedulePersistUiState debounces writes", async () => {
  await withTempDir(async (dir) => {
    const uiStatePath = join(dir, "ui-state.json");
    const transcriptDir = join(dir, "transcripts");
    const attachmentsDir = join(dir, "attachments");
    await mkdir(transcriptDir, { recursive: true });
    await mkdir(attachmentsDir, { recursive: true });

    const store = createFakeStore({ selectedWorkspaceId: "ws-3" });
    const transcriptStore = new JsonFileStore<any>(transcriptDir, "transcript");
    const attachmentStore = new JsonFileStore<any>(attachmentsDir, "attachments");

    const mgr = new PersistenceManager({
      store,
      uiStateFilePath: uiStatePath,
      transcriptStore,
      attachmentStore,
    });

    // Schedule multiple times — only the last should take effect
    mgr.schedulePersistUiState();
    mgr.schedulePersistUiState();
    mgr.schedulePersistUiState();

    // Wait for debounce to fire (250ms + buffer)
    await new Promise((r) => setTimeout(r, 400));

    const raw = await readFile(uiStatePath, "utf8");
    const parsed = JSON.parse(raw) as PersistedUiState;
    assert.equal(parsed.selectedWorkspaceId, "ws-3");
  });
});

test("PersistenceManager.persistComposerAttachments writes attachments then persists UI", async () => {
  await withTempDir(async (dir) => {
    const uiStatePath = join(dir, "ui-state.json");
    const transcriptDir = join(dir, "transcripts");
    const attachmentsDir = join(dir, "attachments");
    await mkdir(transcriptDir, { recursive: true });
    await mkdir(attachmentsDir, { recursive: true });

    const fakeAttachmentStore = new JsonFileStore<ComposerAttachment[]>(attachmentsDir, "attachments");
    let attachmentWritten = false;
    const store = createFakeStore({ selectedWorkspaceId: "ws-4" });

    // Override attachmentStore with our file-backed store
    (store as any).attachmentStore = fakeAttachmentStore;

    const transcriptStore = new JsonFileStore<any>(transcriptDir, "transcript");

    const mgr = new PersistenceManager({
      store,
      uiStateFilePath: uiStatePath,
      transcriptStore,
      attachmentStore: fakeAttachmentStore,
    });

    const attachments: ComposerAttachment[] = [
      { kind: "file", name: "test.txt", path: "/tmp/test.txt", size: 100, mimeType: "text/plain" },
    ];

    await mgr.persistComposerAttachments("key-1", attachments);

    // Verify attachment was written
    const written = await fakeAttachmentStore.read("key-1");
    assert.ok(written, "attachment should be written");
    assert.equal(written!.length, 1);
    assert.equal(written![0].name, "test.txt");

    // Verify UI state was also persisted
    const raw = await readFile(uiStatePath, "utf8");
    const parsed = JSON.parse(raw) as PersistedUiState;
    assert.equal(parsed.selectedWorkspaceId, "ws-4");
  });
});

test("PersistenceManager persistUiState serializes extensionCommandCompatibility", async () => {
  await withTempDir(async (dir) => {
    const uiStatePath = join(dir, "ui-state.json");
    const transcriptDir = join(dir, "transcripts");
    const attachmentsDir = join(dir, "attachments");
    await mkdir(transcriptDir, { recursive: true });
    await mkdir(attachmentsDir, { recursive: true });

    const store = createFakeStore();
    const compat = new Map<string, ExtensionCommandCompatibilityRecord>();
    compat.set("cmd-1", { command: "test", compatible: true, lastCheckedAt: "2026-01-01" });
    store.extensionCommandCompatibilityByWorkspace.set("ws-1", compat);

    const transcriptStore = new JsonFileStore<any>(transcriptDir, "transcript");
    const attachmentStore = new JsonFileStore<any>(attachmentsDir, "attachments");

    const mgr = new PersistenceManager({
      store,
      uiStateFilePath: uiStatePath,
      transcriptStore,
      attachmentStore,
    });

    await mgr.persistUiState();

    const raw = await readFile(uiStatePath, "utf8");
    const parsed = JSON.parse(raw) as PersistedUiState;
    assert.ok(parsed.extensionCommandCompatibilityByWorkspace, "compat should be serialized");
    assert.deepEqual(parsed.extensionCommandCompatibilityByWorkspace!["ws-1"], [
      { command: "test", compatible: true, lastCheckedAt: "2026-01-01" },
    ]);
  });
});

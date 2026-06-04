import {
  estimateTokens,
  type AgentSessionRuntime,
  type AgentSession,
  type CreateAgentSessionOptions,
} from "@earendil-works/pi-coding-agent";
import type { SessionCatalogSnapshot } from "@pi-gui/catalogs";
import type {
  SessionConfig,
  SessionContextUsage,
  SessionDriverEvent,
  SessionEventListener,
  SessionRef,
  SessionSnapshot,
  SessionStatus,
  Unsubscribe,
  WorkspaceRef,
} from "@pi-gui/session-driver";
import type { SessionQueuedMessage } from "@pi-gui/session-driver/types";
import {
  buildSnapshot,
  deriveSessionConfig,
  deriveWorkspaceTitle,
  extractPreview,
  nowIso,
  sessionKey,
  toSessionErrorInfo,
  type SnapshotSource,
} from "./session-supervisor-utils.js";
import {
  createEmptyExtensionUiState,
  type ExtensionUiState,
} from "./extension-ui-state.js";
import type { SessionFileCatalogStorage } from "./json-catalog-store.js";
import type { HostUiResponse } from "@pi-gui/session-driver";

// ---------------------------------------------------------------------------
// ManagedSessionRecord — lives here as the registry's core data type
// ---------------------------------------------------------------------------

export interface ManagedSessionRecord {
  ref: SessionRef;
  workspace: WorkspaceRef;
  title: string;
  runtime: AgentSessionRuntime | undefined;
  session: AgentSession | undefined;
  sessionFile: string | undefined;
  status: SessionStatus;
  updatedAt: string;
  archivedAt: string | undefined;
  preview: string | undefined;
  config: SessionConfig | undefined;
  runningRunId: string | undefined;
  queuedMessages: SessionQueuedMessage[];
  contextUsage: SessionContextUsage | undefined;
  closed: boolean;
  listeners: Set<SessionEventListener>;
  eventQueue: Promise<void>;
  unsubscribeAgent: (() => void) | undefined;
  pendingHostUiRequests: Map<
    string,
    {
      resolve: (response: HostUiResponse) => void;
      reject: (error: Error) => void;
    }
  >;
  extensionUiState: ExtensionUiState;
  bindingExtensions: boolean;
  sessionCommands: readonly import("@pi-gui/session-driver/runtime-types").RuntimeCommandRecord[];
}

// ---------------------------------------------------------------------------
// Registry interface — small, testable seam for live session lifecycle
// ---------------------------------------------------------------------------

export interface SessionRuntimeRegistryInterface {
  /** Look up a record by session ref. Returns undefined if not tracked. */
  getRecord(sessionRef: SessionRef): ManagedSessionRecord | undefined;

  /**
   * Create a new ManagedSessionRecord for a freshly created runtime.
   * Does NOT persist to catalog — caller handles persistence.
   */
  createRecord(
    workspace: WorkspaceRef,
    runtime: AgentSessionRuntime,
    title: string,
  ): ManagedSessionRecord;

  /**
   * Ensure a record exists for the given session ref.
   * Returns an existing live record, or opens a persisted session via the
   * runtime factory. Throws if the session is not in the catalog or cannot
   * be reopened.
   *
   * After ensuring the record, the caller should call `bindSessionRuntime`
   * to set up the rebind handler and extension binding.
   */
  ensureRecord(sessionRef: SessionRef): Promise<ManagedSessionRecord>;

  /**
   * Core close lifecycle: abort session, unsubscribe agent events, dispose
   * runtime, clear record state. Does NOT persist to catalog or emit events —
   * caller handles those.
   */
  closeSession(sessionRef: SessionRef): Promise<void>;

  /**
   * Rebind: key migration when session ID changes, listener transfer from
   * any existing target record, session assignment, and re-subscription to
   * agent events. Does NOT bind extensions — caller handles that.
   */
  rebind(record: ManagedSessionRecord, session: AgentSession): void;

  /** Dispose the runtime (or session fallback) on a record. */
  disposeRuntime(record: ManagedSessionRecord): Promise<void>;

  /** Cancel all pending host UI requests on a record. */
  cancelPendingHostUiRequests(record: ManagedSessionRecord): void;

  /** Subscribe a listener to a record. Returns an unsubscribe function. */
  subscribe(record: ManagedSessionRecord, listener: SessionEventListener): Unsubscribe;

  /** Build a snapshot from a record (computes context usage). */
  snapshotForRecord(record: ManagedSessionRecord): SessionSnapshot;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export interface SessionRuntimeRegistryDependencies {
  readonly runtimeFactory: (
    options?: CreateAgentSessionOptions,
  ) => Promise<AgentSessionRuntime>;
  readonly modelRegistry: import("@earendil-works/pi-coding-agent").ModelRegistry | undefined;
  readonly catalogs: SessionFileCatalogStorage;
}

export class SessionRuntimeRegistry implements SessionRuntimeRegistryInterface {
  private readonly records = new Map<string, ManagedSessionRecord>();
  private readonly runtimeFactory: SessionRuntimeRegistryDependencies["runtimeFactory"];
  private readonly modelRegistry: SessionRuntimeRegistryDependencies["modelRegistry"];
  private readonly catalogs: SessionRuntimeRegistryDependencies["catalogs"];

  constructor(deps: SessionRuntimeRegistryDependencies) {
    this.runtimeFactory = deps.runtimeFactory;
    this.modelRegistry = deps.modelRegistry;
    this.catalogs = deps.catalogs;
  }

  // -- Record access -------------------------------------------------------

  getRecord(sessionRef: SessionRef): ManagedSessionRecord | undefined {
    return this.records.get(sessionKey(sessionRef));
  }

  /**
   * Iterate records whose workspace matches the given id.
   * Used by workspace-level operations (rename, remove) that need to
   * update or clean up per-workspace records.
   */
  *getRecordsForWorkspace(workspaceId: string): IterableIterator<ManagedSessionRecord> {
    for (const record of this.records.values()) {
      if (record.workspace.workspaceId === workspaceId) {
        yield record;
      }
    }
  }

  // -- Record creation -----------------------------------------------------

  createRecord(
    workspace: WorkspaceRef,
    runtime: AgentSessionRuntime,
    title: string,
  ): ManagedSessionRecord {
    const session = runtime.session;
    const ref: SessionRef = {
      workspaceId: workspace.workspaceId,
      sessionId: session.sessionId,
    };

    const record: ManagedSessionRecord = {
      ref,
      workspace: { ...workspace },
      title,
      runtime,
      session,
      sessionFile: session.sessionFile ?? session.sessionManager.getSessionFile(),
      status: "idle",
      updatedAt: nowIso(),
      archivedAt: undefined,
      preview: undefined,
      config: deriveSessionConfig(session.sessionManager),
      runningRunId: undefined,
      queuedMessages: [],
      contextUsage: undefined,
      closed: false,
      listeners: new Set<SessionEventListener>(),
      eventQueue: Promise.resolve(),
      unsubscribeAgent: undefined,
      pendingHostUiRequests: new Map(),
      extensionUiState: createEmptyExtensionUiState(),
      bindingExtensions: false,
      sessionCommands: [],
    };
    return record;
  }

  /** Register a record in the internal map by its session key. */
  registerRecord(record: ManagedSessionRecord): void {
    this.records.set(sessionKey(record.ref), record);
  }

  // -- Ensure record (lazy open) -------------------------------------------

  async ensureRecord(sessionRef: SessionRef): Promise<ManagedSessionRecord> {
    const key = sessionKey(sessionRef);
    const existing = this.records.get(key);
    if (existing && existing.session && !existing.closed) {
      return existing;
    }

    const sessionEntry = await this.catalogs.sessions.getSession(sessionRef);
    if (!sessionEntry) {
      throw new Error(`Session ${key} is not in the catalog.`);
    }

    const workspace = await this.catalogs.workspaces.getWorkspace(sessionEntry.workspaceId);
    if (!workspace) {
      throw new Error(`Workspace ${sessionEntry.workspaceId} is not in the catalog.`);
    }

    const sessionFile =
      existing?.sessionFile ??
      sessionEntry.sessionFilePath ??
      (await this.catalogs.getSessionFile(sessionRef));
    if (!sessionFile) {
      throw new Error(
        `Session ${key} cannot be reopened because no session file is tracked.`,
      );
    }

    const [{ createQuestionnaireTool }, { SessionManager }] = await Promise.all([
      import("./questionnaire-tool.js"),
      import("@earendil-works/pi-coding-agent"),
    ]);
    const runtime = await this.runtimeFactory({
      cwd: workspace.path,
      sessionManager: SessionManager.open(sessionFile),
      customTools: [createQuestionnaireTool()],
      ...(this.modelRegistry ? { modelRegistry: this.modelRegistry } : {}),
    });
    const session = runtime.session;

    const record: ManagedSessionRecord =
      existing ??
      this.createRecord(
        {
          workspaceId: workspace.workspaceId,
          path: workspace.path,
          displayName: workspace.displayName,
        },
        runtime,
        sessionEntry.title,
      );
    record.runtime = runtime;
    record.session = session;
    record.sessionFile = sessionFile;
    record.title = sessionEntry.title;
    record.status = sessionEntry.status;
    record.updatedAt = sessionEntry.updatedAt;
    record.archivedAt = sessionEntry.archivedAt;
    record.preview = sessionEntry.previewSnippet ?? undefined;
    record.config = deriveSessionConfig(session.sessionManager);
    record.closed = false;

    this.records.set(key, record);
    return record;
  }

  // -- Close lifecycle -----------------------------------------------------

  async closeSession(sessionRef: SessionRef): Promise<void> {
    const record = this.records.get(sessionKey(sessionRef));
    if (!record) {
      return;
    }

    record.closed = true;
    record.runningRunId = undefined;
    record.status = "idle";

    if (record.session) {
      try {
        await record.session.abort();
      } catch {
        // Best effort.
      }
      record.unsubscribeAgent?.();
      record.unsubscribeAgent = undefined;
      await this.disposeRuntime(record);
    }
  }

  // -- Rebind (key migration + listener transfer) --------------------------

  rebind(record: ManagedSessionRecord, session: AgentSession): void {
    const previousKey = sessionKey(record.ref);
    const nextRef: SessionRef = {
      workspaceId: record.workspace.workspaceId,
      sessionId: session.sessionId,
    };
    const nextKey = sessionKey(nextRef);

    if (previousKey !== nextKey) {
      const existingTarget = this.records.get(nextKey);
      if (existingTarget && existingTarget !== record) {
        for (const listener of existingTarget.listeners) {
          record.listeners.add(listener);
        }
        existingTarget.unsubscribeAgent?.();
        existingTarget.unsubscribeAgent = undefined;
        this.cancelPendingHostUiRequests(existingTarget);
        void this.disposeRuntime(existingTarget);
      }
      this.records.delete(previousKey);
      record.ref = nextRef;
      this.records.set(nextKey, record);
    }

    record.session = session;
    record.sessionFile = session.sessionFile ?? session.sessionManager.getSessionFile();
    record.unsubscribeAgent?.();
    record.unsubscribeAgent = session.subscribe((event) => {
      // The actual event handling is done by the caller (SessionSupervisor).
      // This subscription keeps the agent event pipeline alive; the caller
      // installs its own handler via the runtime's rebind callback.
      void event;
    });
  }

  // -- Runtime disposal ----------------------------------------------------

  async disposeRuntime(record: ManagedSessionRecord): Promise<void> {
    const runtime = record.runtime;
    const session = record.session;
    record.runtime = undefined;
    record.session = undefined;
    record.sessionCommands = [];
    if (runtime) {
      await runtime.dispose();
      return;
    }
    session?.dispose();
  }

  // -- Pending host UI requests --------------------------------------------

  cancelPendingHostUiRequests(record: ManagedSessionRecord): void {
    for (const [requestId, pending] of [...record.pendingHostUiRequests.entries()]) {
      record.pendingHostUiRequests.delete(requestId);
      pending.resolve({ requestId, cancelled: true });
    }
  }

  // -- Listener subscription -----------------------------------------------

  subscribe(record: ManagedSessionRecord, listener: SessionEventListener): Unsubscribe {
    record.listeners.add(listener);
    return () => {
      for (const currentRecord of this.records.values()) {
        currentRecord.listeners.delete(listener);
      }
    };
  }

  // -- Snapshot ------------------------------------------------------------

  snapshotForRecord(record: ManagedSessionRecord): SessionSnapshot {
    record.contextUsage = computeContextUsage(record.session);
    return buildSnapshot(record);
  }
}

// ---------------------------------------------------------------------------
// Helpers (moved from session-supervisor.ts — pure, testable)
// ---------------------------------------------------------------------------

function computeContextUsage(
  session: AgentSession | undefined,
): SessionContextUsage | undefined {
  const contextWindow = session?.model?.contextWindow;
  if (!session || typeof contextWindow !== "number" || contextWindow <= 0) {
    return undefined;
  }

  const tokens = session.messages.reduce((sum, m) => sum + estimateTokens(m), 0);
  return { usedTokens: Math.max(0, tokens), contextWindow };
}

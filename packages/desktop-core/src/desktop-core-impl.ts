import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import {
  createPiSdkDriver,
  type PiSdkDriverConfig,
} from "@pi-gui/pi-sdk-driver";
import type {
  WorkspaceRef,
  SessionRef,
  SessionSnapshot,
  SessionDriverEvent,
  SessionMessageInput,
  WorkspaceId,
} from "@pi-gui/session-driver";
import type { SessionCatalogEntry, SessionCatalogSnapshot } from "@pi-gui/catalogs";
import type { DesktopCore } from "./desktop-core.js";
import type {
  CoreState,
  CoreWorkspaceRecord,
  CoreSessionRecord,
  CoreSessionCommandRecord,
} from "./core-state.js";

/**
 * Options for creating a headless DesktopCore.
 */
export interface CreateDesktopCoreOptions {
  /** Directory for catalogs and persistence. */
  readonly dataDir: string;
  /** Optional initial workspace paths to add on init. */
  readonly initialWorkspacePaths?: readonly string[];
}

type CoreListener = (state: CoreState) => void;

function emptyState(): CoreState {
  return {
    workspaces: [],
    selectedWorkspaceId: null,
    selectedSessionId: null,
    sessionCommandsBySession: {},
    revision: 0,
  };
}

function sessionKey(ref: SessionRef): string {
  return `${ref.workspaceId}::${ref.sessionId}`;
}

/**
 * Headless Desktop Core implementation.
 *
 * Wraps PiSdkDriver and provides canonical state orchestration
 * without any Electron or Tauri dependency.
 */
export class DesktopCoreImpl implements DesktopCore {
  private _state: CoreState = emptyState();
  private readonly listeners = new Set<CoreListener>();
  private readonly dataDir: string;
  private readonly initialWorkspacePaths: readonly string[];
  private initPromise: Promise<void> | undefined;
  private _driver: ReturnType<typeof createPiSdkDriver> | undefined;
  private readonly sessionCommands = new Map<string, CoreSessionCommandRecord[]>();
  private readonly driverOptions: PiSdkDriverConfig;

  constructor(options: CreateDesktopCoreOptions) {
    this.dataDir = options.dataDir;
    this.initialWorkspacePaths = options.initialWorkspacePaths ?? [];
    this.driverOptions = {
      catalogFilePath: join(options.dataDir, "catalogs.json"),
      agentDir: options.dataDir,
    };
  }

  get state(): CoreState {
    return this._state;
  }

  private get driver(): ReturnType<typeof createPiSdkDriver> {
    if (!this._driver) {
      this._driver = createPiSdkDriver(this.driverOptions);
    }
    return this._driver;
  }

  /* ── Lifecycle ──────────────────────────────────────── */

  async initialize(): Promise<void> {
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = (async () => {
      await mkdir(this.dataDir, { recursive: true });

      for (const path of this.initialWorkspacePaths) {
        const trimmed = path.trim();
        if (!trimmed) continue;
        try {
          await this.driver.syncWorkspace(trimmed);
        } catch {
          // Workspace may not exist yet — ok
        }
      }

      await this.refreshState();
    })();

    return this.initPromise;
  }

  /* ── State management ───────────────────────────────── */

  private async refreshState(): Promise<CoreState> {
    const [workspacesSnapshot, sessionsSnapshot] = await Promise.all([
      this.driver.listWorkspaces(),
      this.driver.listSessions(),
    ]);

    const workspaces: CoreWorkspaceRecord[] = workspacesSnapshot.workspaces.map((ws) => {
      const wsSessions = sessionsSnapshot.sessions.filter(
        (s) => s.sessionRef.workspaceId === ws.workspaceId,
      );
      return {
        id: ws.workspaceId,
        path: ws.path,
        displayName: ws.displayName,
        sessions: wsSessions.map(toCoreSession),
      };
    });

    const commands: Record<string, readonly CoreSessionCommandRecord[]> = {};
    for (const [key, cmds] of this.sessionCommands) {
      commands[key] = cmds;
    }

    this._state = {
      workspaces,
      selectedWorkspaceId: this._state.selectedWorkspaceId,
      selectedSessionId: this._state.selectedSessionId,
      sessionCommandsBySession: commands,
      revision: this._state.revision + 1,
    };

    this.emit();
    return this._state;
  }

  private patchState(patch: Partial<CoreState> & { revision: number }): CoreState {
    this._state = { ...this._state, ...patch };
    this.emit();
    return this._state;
  }

  private emit(): void {
    const snap = this._state;
    for (const l of this.listeners) {
      try {
        l(snap);
      } catch {
        // swallow listener errors
      }
    }
  }

  /* ── Workspace ──────────────────────────────────────── */

  async listWorkspaces(): Promise<{ readonly workspaces: readonly WorkspaceRef[] }> {
    return this.driver.listWorkspaces();
  }

  async addWorkspace(path: string): Promise<CoreState> {
    await this.driver.syncWorkspace(path.trim());
    return this.refreshState();
  }

  async removeWorkspace(workspaceId: string): Promise<CoreState> {
    if (!this._state.workspaces.some((w) => w.id === workspaceId)) {
      throw new Error(`Workspace not found: ${workspaceId}`);
    }
    await this.driver.removeWorkspace(workspaceId as WorkspaceId);
    if (this._state.selectedWorkspaceId === workspaceId) {
      this._state = { ...this._state, selectedWorkspaceId: null, selectedSessionId: null };
    }
    return this.refreshState();
  }

  async selectWorkspace(workspaceId: string): Promise<CoreState> {
    if (!this._state.workspaces.some((w) => w.id === workspaceId)) {
      throw new Error(`Workspace not found: ${workspaceId}`);
    }
    return this.patchState({
      selectedWorkspaceId: workspaceId,
      selectedSessionId: null,
      revision: this._state.revision + 1,
    });
  }

  /* ── Session ────────────────────────────────────────── */

  async listSessions(): Promise<SessionCatalogSnapshot> {
    return this.driver.listSessions();
  }

  async createSession(
    workspaceId: string,
    title?: string,
  ): Promise<{ sessionRef: SessionRef; snapshot: SessionSnapshot }> {
    const ws = this._state.workspaces.find((w) => w.id === workspaceId);
    if (!ws) {
      throw new Error(`Workspace not found: ${workspaceId}`);
    }
    const options = title !== undefined ? { title } : undefined;
    const snapshot = await this.driver.createSession(
      { workspaceId, path: ws.path },
      options,
    );
    await this.refreshState();
    return { sessionRef: snapshot.ref, snapshot };
  }

  async selectSession(sessionRef: SessionRef): Promise<CoreState> {
    await this.driver.openSession(sessionRef);
    const commands = await this.driver.getSessionCommands(sessionRef);
    this.sessionCommands.set(
      sessionKey(sessionRef),
      commands.map((c) => ({
        name: c.name,
        sourceInfo: { path: c.sourceInfo.path },
      })),
    );

    return this.patchState({
      selectedWorkspaceId: sessionRef.workspaceId,
      selectedSessionId: sessionRef.sessionId,
      revision: this._state.revision + 1,
    });
  }

  async archiveSession(sessionRef: SessionRef): Promise<CoreState> {
    await this.driver.archiveSession(sessionRef);
    return this.refreshState();
  }

  async unarchiveSession(sessionRef: SessionRef): Promise<CoreState> {
    await this.driver.unarchiveSession(sessionRef);
    return this.refreshState();
  }

  async getTranscript(sessionRef: SessionRef): Promise<readonly unknown[]> {
    return this.driver.getTranscript(sessionRef);
  }

  /* ── Composer ───────────────────────────────────────── */

  async submitMessage(sessionRef: SessionRef, text: string): Promise<unknown> {
    const input: SessionMessageInput = { text };
    await this.driver.sendUserMessage(sessionRef, input);
    return undefined;
  }

  async cancelRun(sessionRef: SessionRef): Promise<void> {
    await this.driver.cancelCurrentRun(sessionRef);
  }

  /* ── Model ──────────────────────────────────────────── */

  async refreshRuntime(workspaceId: string): Promise<CoreState> {
    const ws = this._state.workspaces.find((w) => w.id === workspaceId);
    if (!ws) {
      throw new Error(`Workspace not found: ${workspaceId}`);
    }
    await this.driver.runtimeSupervisor.refreshRuntime({
      workspaceId: ws.id,
      path: ws.path,
      displayName: ws.displayName,
    });
    return this.refreshState();
  }

  async setDefaultModel(workspaceId: string, provider: string, modelId: string): Promise<CoreState> {
    const ws = this._state.workspaces.find((w) => w.id === workspaceId);
    if (!ws) {
      throw new Error(`Workspace not found: ${workspaceId}`);
    }
    await this.driver.runtimeSupervisor.setDefaultModel(
      { workspaceId: ws.id, path: ws.path, displayName: ws.displayName },
      { provider, modelId },
    );
    return this.refreshState();
  }

  async setSessionThinkingLevel(sessionRef: SessionRef, level: string): Promise<CoreState> {
    await this.driver.setSessionThinkingLevel(sessionRef, level);
    return this.patchState({ revision: this._state.revision + 1 });
  }

  /* ── Subscription ───────────────────────────────────── */

  subscribe(sessionRef: SessionRef, listener: (event: unknown) => void): () => void {
    return this.driver.subscribe(sessionRef, (event: SessionDriverEvent) => {
      listener(event);
    });
  }

  subscribeState(listener: (state: CoreState) => void): () => void {
    this.listeners.add(listener);
    try {
      listener(this._state);
    } catch {
      // ignore
    }
    return () => {
      this.listeners.delete(listener);
    };
  }

  async flushPersistence(): Promise<void> {
    // PiSdkDriver has no explicit flush; catalogs persist on write.
    // This method exists for symmetry — callers can await it to
    // ensure pending async writes settle.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/* ── Helpers ─────────────────────────────────────────── */

function toCoreSession(entry: SessionCatalogEntry): CoreSessionRecord {
  return {
    id: entry.sessionRef.sessionId,
    title: entry.title ?? "Untitled",
    status: (entry.status as CoreSessionRecord["status"]) ?? "idle",
    preview: entry.previewSnippet ?? undefined,
    updatedAt: entry.updatedAt,
    archivedAt: entry.archivedAt ?? undefined,
  };
}

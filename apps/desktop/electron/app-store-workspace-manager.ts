import type { DesktopAppState, CreateSessionInput, WorkspaceSessionTarget } from "../src/desktop-state.ts";
import type { StateAccess, Infrastructure, StoreHelpers, SessionLifecycle, PersistenceOps } from "./app-store-internals.ts";
import * as workspace from "./app-store-workspace.ts";

/* ── Narrow interface consumed by WorkspaceManager ────────── */

export interface WorkspaceManagerDeps {
  readonly store: StateAccess & Infrastructure & StoreHelpers & SessionLifecycle & PersistenceOps;
}

/* ── WorkspaceManager ─────────────────────────────────────── */

/**
 * Owns workspace/worktree logic. Constructed with a narrow interface.
 * The DesktopAppStore delegates workspace ops to this manager.
 */
export class WorkspaceManager {
  private readonly store: StateAccess & Infrastructure & StoreHelpers & SessionLifecycle & PersistenceOps;

  constructor(deps: WorkspaceManagerDeps) {
    this.store = deps.store;
  }

  /* ── Workspace operations ──────────────────────────────── */

  async addWorkspace(path: string): Promise<DesktopAppState> {
    return workspace.addWorkspace(this.store, path);
  }

  async renameWorkspace(workspaceId: string, displayName: string): Promise<DesktopAppState> {
    return workspace.renameWorkspace(this.store, workspaceId, displayName);
  }

  async removeWorkspace(workspaceId: string): Promise<DesktopAppState> {
    return workspace.removeWorkspace(this.store, workspaceId);
  }

  async selectWorkspace(workspaceId: string): Promise<DesktopAppState> {
    return workspace.selectWorkspace(this.store, workspaceId);
  }

  async selectSession(target: WorkspaceSessionTarget): Promise<DesktopAppState> {
    return workspace.selectSession(this.store, target);
  }

  async archiveSession(target: WorkspaceSessionTarget): Promise<DesktopAppState> {
    return workspace.archiveSession(this.store, target);
  }

  async unarchiveSession(target: WorkspaceSessionTarget): Promise<DesktopAppState> {
    return workspace.unarchiveSession(this.store, target);
  }

  async archiveAllNonRunningSessions(workspaceId: string, olderThanMs?: number): Promise<DesktopAppState> {
    return workspace.archiveAllNonRunningSessions(this.store, workspaceId, olderThanMs);
  }

  async syncCurrentWorkspace(): Promise<DesktopAppState> {
    return workspace.syncCurrentWorkspace(this.store);
  }

  /* ── Session creation ─────────────────────────────────── */

  async createSession(input: CreateSessionInput): Promise<DesktopAppState> {
    return workspace.createSession(this.store, input);
  }
}

import type { SessionRef, SessionSnapshot, SessionConfig, CreateSessionOptions, WorkspaceRef } from "@pi-gui/session-driver";
import type { RuntimeCommandRecord } from "@pi-gui/session-driver/runtime-types";
import type { DesktopAppState, ChatRecord, WorkspaceSessionTarget, ExtensionCommandCompatibilityRecord } from "../src/desktop-state.ts";
import type { StateAccess, Infrastructure, StoreHelpers, SessionLifecycle, PersistenceOps } from "./app-store-internals.ts";
import type { PendingAutoTitle } from "./session-state-map.ts";
import type { PendingRuntimeCommandExecution } from "./extension-command-compatibility.ts";
import { sessionKey } from "@pi-gui/pi-sdk-driver";
import { getLearnedCommandCompatibility, recordLearnedCommandCompatibility } from "./extension-command-compatibility.ts";

/* ── Narrow interface consumed by SessionManager ─────────── */

export interface SessionManagerDeps {
  readonly store: StateAccess & Infrastructure & StoreHelpers & PersistenceOps & SessionLifecycle;
}

/* ── SessionManager ──────────────────────────────────────── */

/**
 * Owns session lifecycle logic (selection, readiness, subscriptions,
 * runtime commands, auto-title, thread type). Constructed with a narrow
 * interface. The DesktopAppStore delegates SessionLifecycle calls to this manager.
 */
export class SessionManager {
  private readonly store: StateAccess & Infrastructure & StoreHelpers & PersistenceOps & SessionLifecycle;

  constructor(deps: SessionManagerDeps) {
    this.store = deps.store;
  }

  /* ── Session selection ────────────────────────────────── */

  async selectSessionFast(target: WorkspaceSessionTarget): Promise<DesktopAppState> {
    // Delegate to store — selection logic is deeply intertwined with state
    return this.store.selectSessionFast(target);
  }

  /* ── Session readiness ────────────────────────────────── */

  async ensureSessionReady(sessionRef: SessionRef): Promise<SessionSnapshot | undefined> {
    return this.store.ensureSessionReady(sessionRef);
  }

  /* ── Subscription management ──────────────────────────── */

  async ensureSessionSubscription(sessionRef: SessionRef): Promise<void> {
    return this.store.ensureSessionSubscription(sessionRef);
  }

  async ensureSessionSubscribed(sessionRef: SessionRef): Promise<void> {
    return this.store.ensureSessionSubscribed(sessionRef);
  }

  /* ── Command management ───────────────────────────────── */

  async refreshSessionCommandsFor(sessionRef: SessionRef): Promise<void> {
    return this.store.refreshSessionCommandsFor(sessionRef);
  }

  /* ── Session creation ─────────────────────────────────── */

  async buildCreateSessionOptions(workspaceId: string): Promise<CreateSessionOptions | undefined> {
    return this.store.buildCreateSessionOptions(workspaceId);
  }

  async ensureChatWorkspace(chat: ChatRecord): Promise<WorkspaceRef> {
    return this.store.ensureChatWorkspace(chat);
  }

  /* ── Dialog management ────────────────────────────────── */

  async cancelPendingDialogsForSession(sessionRef: SessionRef): Promise<void> {
    return this.store.cancelPendingDialogsForSession(sessionRef);
  }

  /* ── Extension UI ─────────────────────────────────────── */

  clearExtensionUiForSession(sessionRef: SessionRef): void {
    const key = sessionKey(sessionRef);
    if (!this.store.sessionState.extensionUiBySession.has(key)) {
      return;
    }
    this.store.sessionState.extensionUiBySession.delete(key);
  }

  /* ── Session config ───────────────────────────────────── */

  updateSessionConfig(sessionRef: SessionRef, config: SessionConfig | undefined): void {
    const key = sessionKey(sessionRef);
    if (config && Object.keys(config).length > 0) {
      this.store.sessionState.sessionConfigBySession.set(key, config);
    } else {
      this.store.sessionState.sessionConfigBySession.delete(key);
    }
  }

  /* ── Auto-title tracking ──────────────────────────────── */

  setPendingAutoTitle(sessionRef: SessionRef, pending: PendingAutoTitle): void {
    this.clearPendingAutoTitle(sessionRef);
    this.store.sessionState.pendingAutoTitleBySession.set(sessionKey(sessionRef), pending);
  }

  getPendingAutoTitle(sessionRef: SessionRef): PendingAutoTitle | undefined {
    return this.store.sessionState.pendingAutoTitleBySession.get(sessionKey(sessionRef));
  }

  clearPendingAutoTitle(sessionRef: SessionRef): void {
    const key = sessionKey(sessionRef);
    const pendingAutoTitle = this.store.sessionState.pendingAutoTitleBySession.get(key);
    if (!pendingAutoTitle) {
      return;
    }
    this.store.sessionState.pendingAutoTitleBySession.delete(key);
    pendingAutoTitle.cancel();
  }

  /* ── Thread type ──────────────────────────────────────── */

  setThreadType(sessionId: string, type: string): void {
    this.store.setThreadType(sessionId, type);
  }

  /* ── Runtime command tracking ─────────────────────────── */

  getLearnedRuntimeCommandCompatibility(
    workspaceId: string,
    command: RuntimeCommandRecord,
  ): ExtensionCommandCompatibilityRecord | undefined {
    return getLearnedCommandCompatibility(this.store.extensionCommandCompatibilityByWorkspace, workspaceId, command);
  }

  beginRuntimeCommandExecution(sessionRef: SessionRef, command: RuntimeCommandRecord): void {
    this.store.pendingRuntimeCommandsBySession.set(sessionKey(sessionRef), { command });
  }

  finishRuntimeCommandExecution(sessionRef: SessionRef, timestamp?: string): PendingRuntimeCommandExecution | undefined {
    const ts = timestamp ?? new Date().toISOString();
    const key = sessionKey(sessionRef);
    const pending = this.store.pendingRuntimeCommandsBySession.get(key);
    if (!pending) {
      return undefined;
    }
    this.store.pendingRuntimeCommandsBySession.delete(key);
    if (!pending.blockedMessage) {
      recordLearnedCommandCompatibility(this.store.extensionCommandCompatibilityByWorkspace, sessionRef.workspaceId, {
        commandName: pending.command.name,
        extensionPath: pending.command.sourceInfo.path,
        status: "supported",
        message: "Observed working in pi-gui.",
        capability: "gui-safe",
        updatedAt: ts,
      });
    }
    return pending;
  }
}

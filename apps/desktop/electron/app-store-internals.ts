import type { PiSdkDriver, JsonCatalogStore } from "@pi-gui/pi-sdk-driver";
import type { CreateSessionOptions, SessionConfig, SessionRef, SessionSnapshot, WorkspaceRef } from "@pi-gui/session-driver";
import type { RuntimeCommandRecord, RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import type {
  AppView,
  ChatRecord,
  ComposerAttachment,
  ComposerDraftSyncSource,
  DesktopAppState,
  ExtensionCommandCompatibilityRecord,
  QueuedComposerMessage,
  WorkspaceSessionTarget,
} from "../src/desktop-state";
import type { PendingAutoTitle, QueuedComposerEditState, SessionStateMap } from "./session-state-map";
import type { GitWorktreeManager } from "./worktree-manager";
import type { JsonFileStore } from "./json-file-store";
import type { PendingRuntimeCommandExecution } from "./extension-command-compatibility";

/* ── Sub-interfaces ─────────────────────────────────────── */

/** Read/write access to shared mutable state. */
export interface StateAccess {
  state: DesktopAppState;
  readonly sessionState: SessionStateMap;
  readonly runtimeByWorkspace: Map<string, RuntimeSnapshot>;
  readonly extensionCommandCompatibilityByWorkspace: Map<string, Map<string, ExtensionCommandCompatibilityRecord>>;
  readonly pendingRuntimeCommandsBySession: Map<string, PendingRuntimeCommandExecution>;
  workspaceRefFromState(workspaceId: string): WorkspaceRef | undefined;
  selectedSessionRef(): SessionRef | undefined;
  sessionFromState(sessionRef: SessionRef): { archivedAt?: string; updatedAt: string; title: string; status: string } | undefined;
  findNextQueuedSession(excludeWorkspaceId?: string, excludeSessionId?: string): { readonly workspaceId: string; readonly sessionId: string } | undefined;
}

/** Driver, catalog, worktree, and attachment infrastructure. */
export interface Infrastructure {
  readonly driver: PiSdkDriver;
  readonly catalogStore: JsonCatalogStore;
  readonly worktreeManager: GitWorktreeManager;
  readonly attachmentStore: JsonFileStore<ComposerAttachment[]>;
  getExtensionFilePath(workspaceId: string, filePath: string): string | undefined;
}

/** Shared lifecycle helpers: init, emit, error handling, state refresh. */
export interface StoreHelpers {
  initialize(): Promise<void>;
  refreshState(options?: RefreshStateOptions): Promise<DesktopAppState>;
  emit(): DesktopAppState;
  withError(error: unknown): Promise<DesktopAppState>;
  withErrorHandling(fn: () => Promise<DesktopAppState>): Promise<DesktopAppState>;
  refreshRuntime(workspaceId?: string): Promise<DesktopAppState>;
}

/** Session lifecycle: creation, readiness, subscriptions, runtime commands. */
export interface SessionLifecycle {
  selectSessionFast(target: WorkspaceSessionTarget): Promise<DesktopAppState>;
  ensureSessionReady(sessionRef: SessionRef): Promise<SessionSnapshot | undefined>;
  ensureSessionSubscription(sessionRef: SessionRef): Promise<void>;
  ensureSessionSubscribed(sessionRef: SessionRef): Promise<void>;
  refreshSessionCommandsFor(sessionRef: SessionRef): Promise<void>;
  buildCreateSessionOptions(workspaceId: string): Promise<CreateSessionOptions | undefined>;
  ensureChatWorkspace(chat: ChatRecord): Promise<WorkspaceRef>;
  cancelPendingDialogsForSession(sessionRef: SessionRef): Promise<void>;
  clearExtensionUiForSession(sessionRef: SessionRef): void;
  updateSessionConfig(sessionRef: SessionRef, config: SessionConfig | undefined): void;
  setPendingAutoTitle(sessionRef: SessionRef, pending: PendingAutoTitle): void;
  getPendingAutoTitle(sessionRef: SessionRef): PendingAutoTitle | undefined;
  clearPendingAutoTitle(sessionRef: SessionRef): void;
  setThreadType(sessionId: string, type: string): void;
  getLearnedRuntimeCommandCompatibility(
    workspaceId: string,
    command: RuntimeCommandRecord,
  ): ExtensionCommandCompatibilityRecord | undefined;
  beginRuntimeCommandExecution(sessionRef: SessionRef, command: RuntimeCommandRecord): void;
  finishRuntimeCommandExecution(sessionRef: SessionRef, timestamp?: string): PendingRuntimeCommandExecution | undefined;
}

/** Composer message queue and transcript operations. */
export interface ComposerOps {
  updateQueuedComposerMessages(
    sessionRef: SessionRef,
    queuedMessages: readonly import("@pi-gui/session-driver").SessionQueuedMessage[] | undefined,
  ): void;
  getQueuedComposerMessages(sessionRef: SessionRef): readonly QueuedComposerMessage[];
  setQueuedComposerEditState(sessionRef: SessionRef, editState: QueuedComposerEditState | undefined): void;
  getQueuedComposerEditState(sessionRef: SessionRef): QueuedComposerEditState | undefined;
  publishSelectedTranscript(): void;
  publishSelectedTranscriptFor(sessionRef: SessionRef): void;
  reloadTranscriptFromDriver(sessionRef: SessionRef): Promise<void>;
  appendCompletedCompactionCard?(sessionRef: SessionRef, key: string, origin: "auto" | "manual"): Promise<void>;
}

/** Persistence: UI state, attachments, transcript cache. */
export interface PersistenceOps {
  persistUiState(): Promise<void>;
  persistComposerAttachments(key: string, attachments: readonly ComposerAttachment[]): Promise<void>;
  persistTranscriptCacheForSession(sessionRef: SessionRef): void;
  schedulePersistUiState(): void;
}

/* ── Composite interface ─────────────────────────────────── */

/**
 * Internal interface shared by method-group files
 * (`app-store-workspace.ts`, `app-store-worktree.ts`, `app-store-composer.ts`)
 * so they can call back into the store without needing access to private members.
 *
 * Consumers should prefer the narrowest sub-interface they need
 * (`StateAccess`, `Infrastructure`, `StoreHelpers`, `SessionLifecycle`,
 * `ComposerOps`, `PersistenceOps`). This composite is kept for backward
 * compatibility and for `DesktopAppStore` itself.
 */
export interface AppStoreInternals extends StateAccess, Infrastructure, StoreHelpers, SessionLifecycle, ComposerOps, PersistenceOps {}

export interface RefreshStateOptions {
  readonly selectedWorkspaceId?: string;
  readonly selectedSessionId?: string;
  readonly composerDraft?: string;
  readonly composerDraftSyncSource?: ComposerDraftSyncSource;
  readonly clearLastError?: boolean;
  readonly refreshWorktrees?: boolean;
  readonly activeView?: AppView;
  readonly markSelectedSessionViewed?: boolean;
  readonly hydrateSelectedSession?: boolean;
}

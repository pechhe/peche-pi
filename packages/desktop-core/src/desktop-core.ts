import type { WorkspaceRef, SessionRef, SessionSnapshot } from "@pi-gui/session-driver";
import type { CoreState } from "./core-state.js";

/**
 * Headless Desktop Core contract.
 *
 * Wraps a PiSdkDriver and provides canonical state orchestration for
 * workspace listing, session CRUD, composer send/cancel, model selection,
 * and JSON persistence. Platform-agnostic — no Electron, no Tauri.
 */
export interface DesktopCore {
  /** Current projected state. */
  readonly state: CoreState;

  /** Initialise persistence, restore state, and refresh. */
  initialize(): Promise<void>;

  /* ── Workspace ─────────────────────────────────── */

  /** List known workspaces. */
  listWorkspaces(): Promise<{ readonly workspaces: readonly WorkspaceRef[] }>;

  /** Add and sync a workspace path. */
  addWorkspace(path: string): Promise<CoreState>;

  /** Remove a workspace. */
  removeWorkspace(workspaceId: string): Promise<CoreState>;

  /** Select a workspace (clears selected session). */
  selectWorkspace(workspaceId: string): Promise<CoreState>;

  /* ── Session ───────────────────────────────────── */

  /** List all sessions across workspaces. */
  listSessions(): Promise<import("@pi-gui/catalogs").SessionCatalogSnapshot>;

  /** Create a new session in a workspace. */
  createSession(workspaceId: string, title?: string): Promise<{ sessionRef: SessionRef; snapshot: SessionSnapshot }>;

  /** Select a session (hydrates transcript etc.). */
  selectSession(sessionRef: SessionRef): Promise<CoreState>;

  /** Archive a session. */
  archiveSession(sessionRef: SessionRef): Promise<CoreState>;

  /** Unarchive a session. */
  unarchiveSession(sessionRef: SessionRef): Promise<CoreState>;

  /** Get transcript for a session. */
  getTranscript(sessionRef: SessionRef): Promise<readonly unknown[]>;

  /* ── Composer ──────────────────────────────────── */

  /** Submit a composer message. */
  submitMessage(sessionRef: SessionRef, text: string): Promise<unknown>;

  /** Cancel the current run in a session. */
  cancelRun(sessionRef: SessionRef): Promise<void>;

  /* ── Model ─────────────────────────────────────── */

  /** Refresh the runtime (models, skills, extensions) for a workspace. */
  refreshRuntime(workspaceId: string): Promise<CoreState>;

  /** Set the default model for a workspace. */
  setDefaultModel(workspaceId: string, provider: string, modelId: string): Promise<CoreState>;

  /** Set the thinking level for a session. */
  setSessionThinkingLevel(sessionRef: SessionRef, level: string): Promise<CoreState>;

  /* ── Event subscription ────────────────────────── */

  /** Subscribe to session events. */
  subscribe(sessionRef: SessionRef, listener: (event: unknown) => void): () => void;

  /** Subscribe to core state changes. */
  subscribeState(listener: (state: CoreState) => void): () => void;

  /** Flush all pending persistence. */
  flushPersistence(): Promise<void>;
}

import type { BrowserWindow } from "electron";
import { exec } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { homedir } from "node:os";
import { promisify } from "node:util";
import { EditWatcher, type LiveEditStatsListener } from "./edit-watcher.ts";

const execAsync = promisify(exec);
import {
  type GenerateThreadTitleOptions,
  JsonCatalogStore,
  PiSdkDriver,
  type PiSdkDriverConfig,
  sessionKey,
} from "@pi-gui/pi-sdk-driver";
import type { SessionCatalogEntry, WorkspaceCatalogEntry } from "@pi-gui/catalogs";
import type {
  NavigateSessionTreeOptions,
  NavigateSessionTreeResult,
  SessionTreeSnapshot,
} from "@pi-gui/session-driver/types";
import type {
  CreateSessionOptions,
  HostUiResponse,
  SessionConfig,
  SessionDriverEvent,
  SessionQueuedMessage,
  SessionRef,
  SessionSnapshot,
  WorkspaceRef,
} from "@pi-gui/session-driver";
import type {
  ModelSettingsSnapshot,
  RuntimeCommandRecord,
  RuntimeLoginCallbacks,
  RuntimeSettingsSnapshot,
  RuntimeSnapshot,
} from "@pi-gui/session-driver/runtime-types";
import {
  type AppView,
  type ChatRecord,
  type ComposerAttachment,
  type ComposerDraftSyncSource,
  type ExtensionCommandCompatibilityRecord,
  type ModelSettingsScopeMode,
  createEmptyDesktopAppState,
  ZOOM_BASELINE,
  type CreateSessionInput,
  type CreateWorktreeInput,
  type DesktopAppState,
  type NotificationPreferences,
  type ComposerDeviceMode,
  type StreamRevealMode,
  type StreamRevealSpeed,
  type PlanModeIdeologySetting,
  type ThreadTransitionSettings,
  type ThemeMode,
  type QueuedComposerMessage,
  type RemoveWorktreeInput,
  type SelectedTranscriptRecord,
  type SessionRecord,
  type StartChatInput,
  type StartAutomationThreadInput,
  type StartThreadInput,
  type SubagentSettingsRecord,
  type TranscriptMessage,
  type WorkspaceRecord,
  type WorkspaceSessionTarget,
} from "../src/desktop-state";
import type { ComposerMode } from "../src/composer-mode";
import { DesktopSessionState, type DesktopSessionStatePatch, updateSessionRecord } from "./app-store-session-state";
import { reduce } from "./app-state-reducer";
import type { AppStoreInternals, RefreshStateOptions } from "./app-store-internals";
import {
  readPersistedUiState,
  type LegacyPersistedUiState,
  type PersistedUiState,
  writePersistedUiState,
} from "./app-store-persistence";
import { JsonFileStore } from "./json-file-store";
import {
  type PendingRuntimeCommandExecution,
  getLearnedCommandCompatibility,
  pruneCompatibilityForRuntimeSnapshot,
  recordLearnedCommandCompatibility,
  restoreCompatibilityByWorkspace,
  serializeCompatibilityByWorkspace,
} from "./extension-command-compatibility";
import {
  buildWorktreeRecords,
  buildWorkspaceRecords,
  cloneComposerAttachment,
  cloneComposerAttachments,
  cloneTranscriptMessage,
  latestSessionActivityAt,
  mergeQueuedComposerMessages,
  mapToRecord,
  previewFromTranscript,
  toSessionRef,
} from "./app-store-utils";
import { resolveRepoWorkspaceId } from "../src/workspace-roots";
import { SessionStateMap, serializeExtensionUiState, type QueuedComposerEditState } from "./session-state-map";
import { GitWorktreeManager } from "./worktree-manager";
import * as workspace from "./app-store-workspace";
import * as worktree from "./app-store-worktree";
import * as composer from "./app-store-composer";
import * as ghRunner from "./gh-runner";
import { isSessionActivelyViewed } from "./session-visibility";
import { applySubagentEnvironment } from "./app-store-subagent";
import * as subagent from "./app-store-subagent";
import { launchSessionInDefaultTerminal } from "./external-terminal";

const DEFAULT_CHAT_AGENTS_MD = `# Chat Agent

You are a general-purpose agentic assistant operating inside a standalone chat.
This chat has no associated coding project or workspace.

## Rules

- These chats are for general agentic tasks — research, writing, advice, browsing, and similar non-code-project work.
- You do not inherit any project-level AGENTS.md. Ignore any global agent instructions that assume a coding project context.
- You may write files into your chat's scratch directory, but you should not modify files outside it unless the user explicitly directs you to.
- Keep responses helpful and grounded. Ask clarifying questions when the task is ambiguous.
- The user can view and edit this AGENTS.md per chat to customize your behaviour.
`;

type StateListener = (state: DesktopAppState) => void;
type SelectedTranscriptListener = (payload: SelectedTranscriptRecord | null) => void;
type SessionEventListener = (event: SessionDriverEvent, state: DesktopAppState) => void | Promise<void>;
type StatePatchListener = (patch: { readonly workspaceId: string; readonly session: SessionRecord | null }) => void;
type TranscriptDeltaPayload = { readonly sessionId: string; readonly workspaceId: string; readonly initial: boolean; readonly messages: readonly TranscriptMessage[] };
type TranscriptDeltaListener = (delta: TranscriptDeltaPayload) => void;
type TranscriptMessageRow = Extract<TranscriptMessage, { kind: "message" }>;

function isStreamingSessionEvent(event: SessionDriverEvent): boolean {
  return event.type === "assistantDelta" || event.type === "reasoningDelta" || event.type === "toolUpdated";
}

const LEGACY_TRANSCRIPT_HISTORY_LIMIT = 180;
interface PersistedTranscriptRecord {
  readonly version: 1;
  readonly transcript: readonly TranscriptMessage[];
}

type PersistedTranscriptStoreValue = PersistedTranscriptRecord | readonly TranscriptMessage[];

function isPersistedTranscriptRecord(value: PersistedTranscriptStoreValue): value is PersistedTranscriptRecord {
  if (Array.isArray(value)) {
    return false;
  }
  const candidate = value as { version?: unknown; transcript?: unknown };
  return candidate.version === 1 && Array.isArray(candidate.transcript);
}

export interface DesktopAppStoreOptions {
  readonly userDataDir: string;
  readonly initialWorkspacePaths: readonly string[];
  readonly getWindow?: () => BrowserWindow | null;
  readonly generateThreadTitleOverride?: (
    workspace: WorkspaceRef,
    options: GenerateThreadTitleOptions,
  ) => Promise<string | null | undefined>;
}

export class DesktopAppStore implements AppStoreInternals {
  state = createEmptyDesktopAppState();
  private readonly listeners = new Set<StateListener>();
  private readonly selectedTranscriptListeners = new Set<SelectedTranscriptListener>();
  private readonly statePatchListeners = new Set<StatePatchListener>();
  private readonly transcriptDeltaListeners = new Set<TranscriptDeltaListener>();
  private readonly transcriptLastSentCount = new Map<string, number>();
  private readonly pendingTranscriptDeltaBySession = new Map<string, TranscriptDeltaPayload>();
  private transcriptDeltaFlushTimer: NodeJS.Timeout | undefined;
  private readonly sessionEventListeners = new Set<SessionEventListener>();
  private readonly autoCompactInFlight = new Set<string>();
  readonly driver: PiSdkDriver;
  readonly catalogStore: JsonCatalogStore;
  readonly worktreeManager: GitWorktreeManager;
  private readonly uiStateFilePath: string;
  private readonly transcriptStore: JsonFileStore<PersistedTranscriptStoreValue>;
  readonly attachmentStore: JsonFileStore<ComposerAttachment[]>;
  readonly sessionState = new SessionStateMap();
  private readonly desktopSessionState = new DesktopSessionState(this.sessionState);
  readonly runtimeByWorkspace = new Map<string, RuntimeSnapshot>();
  readonly extensionCommandCompatibilityByWorkspace = new Map<string, Map<string, ExtensionCommandCompatibilityRecord>>();
  readonly pendingRuntimeCommandsBySession = new Map<string, PendingRuntimeCommandExecution>();
  private readonly reportedCompatibilityIssuesBySession = new Map<string, Set<string>>();
  private readonly initialWorkspacePaths: readonly string[];
  private readonly getWindow: () => BrowserWindow | null;
  private persistUiStateTimer: NodeJS.Timeout | undefined;
  private readonly transcriptPersistTimers = new Map<string, NodeJS.Timeout>();
  private readonly restoredSelectedSessionKeysAwaitingSelection = new Set<string>();
  private initPromise: Promise<void> | undefined;
  private selectionEpoch = 0;
  private refreshStateDepth = 0;
  private readonly editWatcher = new EditWatcher();
  private liveEditStatsListener: LiveEditStatsListener | undefined;

  setLiveEditStatsListener(listener: LiveEditStatsListener | undefined): void {
    this.liveEditStatsListener = listener;
  }

  /** Set externally after construction. Used by refreshState to include automations. */
  automationStoreRef: { getAll(): readonly import("../src/desktop-state.ts").Automation[] } | null = null;

  constructor(options: DesktopAppStoreOptions) {
    const catalogFilePath = join(options.userDataDir, "catalogs.json");
    const driverOptions: PiSdkDriverConfig = {
      catalogFilePath,
      ...(options.generateThreadTitleOverride
        ? { generateThreadTitleOverride: options.generateThreadTitleOverride }
        : {}),
    };

    this.driver = new PiSdkDriver(driverOptions);
    this.catalogStore = new JsonCatalogStore({ catalogFilePath });
    this.worktreeManager = new GitWorktreeManager({
      catalogStorage: this.catalogStore,
      worktreesRoot: join(options.userDataDir, "worktrees"),
    });
    this.uiStateFilePath = join(options.userDataDir, "ui-state.json");
    this.transcriptStore = new JsonFileStore<PersistedTranscriptStoreValue>(options.userDataDir, "transcripts");
    this.attachmentStore = new JsonFileStore<ComposerAttachment[]>(options.userDataDir, "attachments");
    this.initialWorkspacePaths = options.initialWorkspacePaths;
    this.getWindow = options.getWindow ?? (() => null);
    this.editWatcher.setListener((stats) => this.liveEditStatsListener?.(stats));
  }

  /* ── Lifecycle ──────────────────────────────────────────── */

  async initialize(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.initializeInternal();
    }
    return this.initPromise;
  }

  async getState(): Promise<DesktopAppState> {
    await this.initialize();
    return structuredClone(this.state);
  }

  async getSelectedTranscript(): Promise<SelectedTranscriptRecord | null> {
    try {
      await this.initialize();
      const sessionRef = this.selectedSessionRef();
      if (!sessionRef) {
        return null;
      }
      await this.ensureTranscriptLoaded(sessionRef);
      return this.buildSelectedTranscriptRecord(sessionRef);
    } catch {
      return null;
    }
  }

  /**
   * Get the transcript for an arbitrary session (not just the selected one).
   * Loads from persisted storage or driver if not already cached.
   */
  async getSessionTranscript(sessionRef: SessionRef): Promise<readonly TranscriptMessage[]> {
    await this.initialize();
    await this.ensureTranscriptLoaded(sessionRef);
    return this.sessionState.transcriptCache.get(sessionKey(sessionRef)) ?? [];
  }

  /**
   * Read raw session entries from a subagent's `.jsonl` file on disk. The
   * renderer converts these into a read-only timeline. Returns [] on any error
   * (e.g. file not yet created for a freshly-launched subagent).
   */
  async getSubagentSessionEntries(sessionFilePath: string): Promise<readonly unknown[]> {
    await this.initialize();
    try {
      return this.driver.readSessionFileEntries(sessionFilePath);
    } catch {
      return [];
    }
  }

  /**
   * Search transcript text across multiple sessions by reading persisted files.
   * Returns matching session keys with context snippets. Does NOT load into cache.
   */
  async searchTranscripts(
    sessionKeysToSearch: readonly string[],
    query: string,
  ): Promise<readonly { sessionKey: string; snippet: string; messageId: string }[]> {
    const q = query.trim().toLowerCase();
    if (!q || sessionKeysToSearch.length === 0) return [];

    const results: { sessionKey: string; snippet: string; messageId: string }[] = [];
    const MAX_RESULTS = 20;

    for (const key of sessionKeysToSearch) {
      if (results.length >= MAX_RESULTS) break;
      const persisted = await this.readPersistedTranscript(key);
      if (!persisted) continue;

      for (const msg of persisted.transcript) {
        const text = extractSearchableText(msg);
        if (!text) continue;
        const lower = text.toLowerCase();
        const idx = lower.indexOf(q);
        if (idx === -1) continue;

        // Extract a context snippet around the match
        const start = Math.max(0, idx - 60);
        const end = Math.min(text.length, idx + q.length + 60);
        const snippet = (start > 0 ? "…" : "") + text.slice(start, end).replace(/\s+/g, " ").trim() + (end < text.length ? "…" : "");
        results.push({ sessionKey: key, snippet, messageId: (msg as { id?: string }).id ?? "" });
        break; // one match per session is enough
      }
    }

    return results;
  }

  async flushPersistence(): Promise<void> {
    await this.initialize();
    if (this.persistUiStateTimer) {
      clearTimeout(this.persistUiStateTimer);
      this.persistUiStateTimer = undefined;
    }

    const pendingTranscriptWrites = [...this.transcriptPersistTimers.entries()];
    this.transcriptPersistTimers.clear();
    await Promise.all(
      pendingTranscriptWrites.map(async ([key, timer]) => {
        clearTimeout(timer);
        // writePersistedTranscript clones internally before serializing.
        const transcript = this.sessionState.transcriptCache.get(key) ?? [];
        await this.writePersistedTranscript(key, transcript);
      }),
    );

    await this.persistUiState();
  }

  async emitTestSessionEvent(event: SessionDriverEvent): Promise<void> {
    await this.initialize();
    await this.handleSessionEvent(event);
  }

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    void this.getState().then(listener).catch(() => undefined);
    return () => {
      this.listeners.delete(listener);
    };
  }

  subscribeToStatePatch(listener: StatePatchListener): () => void {
    this.statePatchListeners.add(listener);
    return () => {
      this.statePatchListeners.delete(listener);
    };
  }

  subscribeToSelectedTranscript(listener: SelectedTranscriptListener): () => void {
    this.selectedTranscriptListeners.add(listener);
    void this.getSelectedTranscript().then(listener).catch(() => undefined);
    return () => {
      this.selectedTranscriptListeners.delete(listener);
    };
  }

  subscribeToSessionEvents(listener: SessionEventListener): () => void {
    this.sessionEventListeners.add(listener);
    return () => {
      this.sessionEventListeners.delete(listener);
    };
  }

  /* ── Workspace methods (delegated) ─────────────────────── */

  async addWorkspace(path: string): Promise<DesktopAppState> {
    return workspace.addWorkspace(this, path);
  }

  getWorkspacePath(workspaceId: string): string | undefined {
    return this.state.workspaces.find((w) => w.id === workspaceId)?.path;
  }

  async getProviderApiKey(providerId: string): Promise<string | undefined> {
    await this.initialize();
    return this.driver.getProviderApiKey(providerId);
  }

  getSkillFilePath(workspaceId: string, filePath: string): string | undefined {
    return this.runtimeByWorkspace.get(workspaceId)?.skills.find((s) => s.filePath === filePath)?.filePath;
  }

  getExtensionFilePath(workspaceId: string, filePath: string): string | undefined {
    return this.runtimeByWorkspace.get(workspaceId)?.extensions.find((entry) => entry.path === filePath)?.path;
  }

  async renameWorkspace(workspaceId: string, displayName: string): Promise<DesktopAppState> {
    return workspace.renameWorkspace(this, workspaceId, displayName);
  }

  async removeWorkspace(workspaceId: string): Promise<DesktopAppState> {
    return workspace.removeWorkspace(this, workspaceId);
  }

  async reorderWorkspaces(order: readonly string[]): Promise<DesktopAppState> {
    await this.initialize();
    const primaryIds = new Set(this.state.workspaces.filter((w) => w.kind === "primary").map((w) => w.id));
    const sanitized = [...new Set(order)].filter((id) => primaryIds.has(id));
    this.state = {
      ...this.state,
      workspaceOrder: sanitized,
      lastError: undefined,
      revision: this.state.revision + 1,
    };
    await this.persistUiState();
    return this.emit();
  }

  async selectWorkspace(workspaceId: string): Promise<DesktopAppState> {
    return workspace.selectWorkspace(this, workspaceId);
  }

  async selectSession(target: WorkspaceSessionTarget): Promise<DesktopAppState> {
    return workspace.selectSession(this, target);
  }

  async selectSessionFast(target: WorkspaceSessionTarget): Promise<DesktopAppState> {
    await this.initialize();
    const sessionRef = toSessionRef(target);
    if (!this.sessionFromState(sessionRef)) {
      return this.withErrorHandling(async () =>
        this.refreshState({
          selectedWorkspaceId: target.workspaceId,
          selectedSessionId: target.sessionId,
          clearLastError: true,
          activeView: "threads",
        }),
      );
    }

    return this.withErrorHandling(async () => {
      const selectionEpoch = ++this.selectionEpoch;
      this.applyFastSessionSelection(sessionRef);
      try {
        await this.hydrateSelectedSessionAfterSelection(sessionRef, selectionEpoch);
      } catch (error) {
        await this.handleSelectedSessionHydrationError(sessionRef, selectionEpoch, error);
      }
      return structuredClone(this.state);
    });
  }

  async archiveSession(target: WorkspaceSessionTarget): Promise<DesktopAppState> {
    return workspace.archiveSession(this, target);
  }

  async unarchiveSession(target: WorkspaceSessionTarget): Promise<DesktopAppState> {
    return workspace.unarchiveSession(this, target);
  }

  async snoozeSession(target: WorkspaceSessionTarget, until: string): Promise<DesktopAppState> {
    return workspace.snoozeSession(this, target, until);
  }

  async unsnoozeSession(target: WorkspaceSessionTarget): Promise<DesktopAppState> {
    return workspace.unsnoozeSession(this, target);
  }

  async markToTestSession(target: WorkspaceSessionTarget): Promise<DesktopAppState> {
    return workspace.toTestSession(this, target);
  }

  async unmarkToTestSession(target: WorkspaceSessionTarget): Promise<DesktopAppState> {
    return workspace.unmarkToTestSession(this, target);
  }

  async archiveAllNonRunningSessions(workspaceId: string, olderThanMs?: number): Promise<DesktopAppState> {
    return workspace.archiveAllNonRunningSessions(this, workspaceId, olderThanMs);
  }

  async syncCurrentWorkspace(): Promise<DesktopAppState> {
    return workspace.syncCurrentWorkspace(this);
  }

  /* ── Worktree methods (delegated) ──────────────────────── */

  async createWorktree(input: CreateWorktreeInput): Promise<DesktopAppState> {
    return worktree.createWorktree(this, input);
  }

  async removeWorktree(input: RemoveWorktreeInput): Promise<DesktopAppState> {
    return worktree.removeWorktree(this, input);
  }

  /* ── Composer methods (delegated) ──────────────────────── */

  async updateComposerDraft(composerDraft: string): Promise<DesktopAppState> {
    return composer.updateComposerDraft(this, composerDraft);
  }

  async addComposerAttachments(attachments: readonly ComposerAttachment[]): Promise<DesktopAppState> {
    return composer.addComposerAttachments(this, attachments);
  }

  async removeComposerAttachment(attachmentId: string): Promise<DesktopAppState> {
    return composer.removeComposerAttachment(this, attachmentId);
  }

  async submitComposer(
    textInput: string,
    options?: { readonly deliverAs?: "steer" | "followUp"; readonly mode?: ComposerMode; readonly isFirstPlanPrompt?: boolean },
  ): Promise<DesktopAppState> {
    return composer.submitComposer(this, textInput, options);
  }

  async editQueuedComposerMessage(messageId: string, currentDraft?: string): Promise<DesktopAppState> {
    return composer.editQueuedComposerMessage(this, messageId, currentDraft);
  }

  async cancelQueuedComposerEdit(): Promise<DesktopAppState> {
    return composer.cancelQueuedComposerEdit(this);
  }

  async removeQueuedComposerMessage(messageId: string): Promise<DesktopAppState> {
    return composer.removeQueuedComposerMessage(this, messageId);
  }

  async steerQueuedComposerMessage(messageId: string): Promise<DesktopAppState> {
    return composer.steerQueuedComposerMessage(this, messageId);
  }

  async cancelCurrentRun(): Promise<DesktopAppState> {
    return composer.cancelCurrentRun(this);
  }

  async setExternalTerminalApp(externalTerminalApp: string): Promise<DesktopAppState> {
    await this.initialize();
    const next = reduce(this.state, {
      type: "settings/setExternalTerminalApp",
      externalTerminalApp: externalTerminalApp.trim(),
    });
    if (next === this.state) {
      return this.emit();
    }
    this.state = next;
    await this.persistUiState();
    return this.emit();
  }

  async openSessionInDefaultTerminal(
    promptForTerminalApp: () => Promise<string | undefined>,
  ): Promise<DesktopAppState> {
    await this.initialize();
    const sessionRef = this.selectedSessionRef();
    if (!sessionRef) {
      return this.emit();
    }
    const session = this.sessionFromState(sessionRef);
    if (session?.status === "running") {
      return this.withError("Stop the running model before opening this session in a terminal.");
    }
    const cwd = this.getWorkspacePath(sessionRef.workspaceId);
    if (!cwd) {
      return this.withError("Cannot resolve the workspace folder for this session.");
    }

    let terminalApp = this.state.externalTerminalApp.trim();
    if (!terminalApp) {
      const picked = (await promptForTerminalApp())?.trim();
      if (!picked) {
        // User cancelled the picker; abort without error.
        return this.emit();
      }
      await this.setExternalTerminalApp(picked);
      terminalApp = picked;
    }

    return this.withErrorHandling(async () => {
      const catalog = await this.driver.listSessions(sessionRef.workspaceId);
      const sessionFilePath = catalog.sessions.find(
        (entry) => entry.sessionRef.sessionId === sessionRef.sessionId,
      )?.sessionFilePath;
      if (!sessionFilePath) {
        return this.withError("This session has no saved file to resume.");
      }
      await launchSessionInDefaultTerminal({ cwd, sessionFilePath, terminalApp });
      // Hand off ownership: drop the in-memory runtime so the external pi
      // process is the sole writer of the session file.
      await this.driver.closeSession(sessionRef);
      await this.reloadSessionsForWorkspace(sessionRef.workspaceId);
      return this.refreshState({ clearLastError: true });
    });
  }

  async getSessionTree(target: WorkspaceSessionTarget): Promise<SessionTreeSnapshot> {
    await this.initialize();
    const sessionRef = toSessionRef(target);
    await this.ensureSessionReady(sessionRef);
    return this.driver.getSessionTree(sessionRef);
  }

  async navigateSessionTree(
    target: WorkspaceSessionTarget,
    targetId: string,
    options?: NavigateSessionTreeOptions,
  ): Promise<{ readonly state: DesktopAppState; readonly result: NavigateSessionTreeResult }> {
    await this.initialize();
    const sessionRef = toSessionRef(target);
    await this.ensureSessionReady(sessionRef);

    const result = await this.driver.navigateSessionTree(sessionRef, targetId, options);
    if (!result.cancelled && !result.aborted) {
      await this.reloadTranscriptFromDriver(sessionRef);
      await this.refreshSessionCommandsFor(sessionRef);
      const state = await this.refreshState({
        selectedWorkspaceId: target.workspaceId,
        selectedSessionId: target.sessionId,
        clearLastError: true,
        markSelectedSessionViewed: false,
      });
      return { state, result };
    }

    return {
      state: structuredClone(this.state),
      result,
    };
  }

  /* ── Session / thread methods (delegated) ───────────────── */

  async startThread(input: StartThreadInput): Promise<DesktopAppState> {
    return worktree.startThread(this, input);
  }

  async startAutomationThread(input: StartAutomationThreadInput): Promise<string | undefined> {
    return worktree.startAutomationThread(this, input);
  }

  async createSession(input: CreateSessionInput): Promise<DesktopAppState> {
    return workspace.createSession(this, input);
  }

  /**
   * Create a new session seeded with an initial message (e.g. handoff payload).
   * Returns the new session ID without navigating to it.
   */
  async createSeededSession(
    input: import("./handoff-core").CreateSeededSessionInput,
  ): Promise<{ readonly sessionId: string }> {
    await this.initialize();
    const ws = this.workspaceRefFromState(input.workspaceId);
    if (!ws) {
      throw new Error(`Unknown workspace: ${input.workspaceId}`);
    }

    const createOptions = await this.buildCreateSessionOptions(input.workspaceId);
    const snapshot = await this.driver.createSession(ws, {
      ...createOptions,
      title: input.title || "Advisor",
    });
    const key = sessionKey(snapshot.ref);
    this.sessionState.transcriptCache.set(key, []);
    this.sessionState.loadedTranscriptKeys.add(key);
    this.updateSessionConfig(snapshot.ref, snapshot.config);

    // Seed the session with the handoff payload as the first user message.
    await this.driver.sendUserMessage(snapshot.ref, {
      text: input.seedText,
      deliverAs: "steer",
    });

    // Refresh session list to pick up the new session.
    await this.refreshState({});

    return { sessionId: snapshot.ref.sessionId };
  }

  /* ── GitHub issue runner ────────────────────────────────── */

  async listGhMilestones(workspaceId?: string): Promise<DesktopAppState> {
    await this.initialize();
    const wsId = workspaceId ?? this.state.selectedWorkspaceId;
    if (!wsId) return this.emit();
    return ghRunner.refreshMilestones(this, wsId);
  }

  async runGhMilestone(workspaceId: string, milestoneNumber: number): Promise<DesktopAppState> {
    await this.initialize();
    void ghRunner.runMilestone(this, workspaceId, milestoneNumber);
    return this.emit();
  }

  async cancelGhRun(): Promise<DesktopAppState> {
    await this.initialize();
    ghRunner.cancelRun(this);
    return this.emit();
  }

  /* ── View / UI state ───────────────────────────────────── */

  async setActiveView(activeView: AppView): Promise<DesktopAppState> {
    await this.initialize();
    if (this.state.activeView === "threads" && activeView !== "threads") {
      const sessionRef = this.selectedSessionRef();
      if (sessionRef) {
        await this.cancelPendingDialogsForSession(sessionRef);
      }
    }
    this.state = reduce(this.state, { type: "view/setActiveView", activeView });
    if (activeView === "threads") {
      this.markSelectedSessionViewedIfVisible();
    }
    await this.persistUiState();
    return this.emit();
  }

  async setSidebarCollapsed(sidebarCollapsed: boolean): Promise<DesktopAppState> {
    await this.initialize();
    const next = reduce(this.state, { type: "settings/setSidebarCollapsed", sidebarCollapsed });
    if (next === this.state) {
      return structuredClone(this.state);
    }
    this.state = next;
    await this.persistUiState();
    return this.emit();
  }

  async setZoomFactor(zoomFactor: number): Promise<DesktopAppState> {
    await this.initialize();
    const next = reduce(this.state, { type: "settings/setZoomFactor", zoomFactor });
    if (next === this.state) {
      return structuredClone(this.state);
    }
    this.state = next;
    await this.persistUiState();
    return this.emit();
  }

  async setQueueMode(enabled: boolean): Promise<DesktopAppState> {
    await this.initialize();
    const next = reduce(this.state, { type: "settings/setQueueMode", queueMode: enabled });
    if (next === this.state) {
      return structuredClone(this.state);
    }
    this.state = next;

    // When enabling queue mode, select the oldest session with hasUnseenUpdate
    if (enabled) {
      const queuedSession = findNextQueuedSession(this.state);
      if (queuedSession) {
        await this.selectSessionFast(queuedSession);
      }
    }

    await this.persistUiState();
    return this.emit();
  }

  /** Find the next queued session (oldest hasUnseenUpdate). */
  findNextQueuedSession(excludeWorkspaceId?: string, excludeSessionId?: string): { workspaceId: string; sessionId: string } | undefined {
    return findNextQueuedSession(this.state, excludeWorkspaceId, excludeSessionId);
  }

  async setNotificationPreferences(preferences: Partial<NotificationPreferences>): Promise<DesktopAppState> {
    await this.initialize();
    this.state = reduce(this.state, { type: "settings/mergeNotificationPreferences", preferences });
    await this.persistUiState();
    return this.emit();
  }

  async setIntegratedTerminalShell(integratedTerminalShell: string): Promise<DesktopAppState> {
    await this.initialize();
    const next = reduce(this.state, {
      type: "settings/setIntegratedTerminalShell",
      integratedTerminalShell: integratedTerminalShell.trim(),
    });
    if (next === this.state) {
      return this.emit();
    }
    this.state = next;
    await this.persistUiState();
    return this.emit();
  }

  async setSubagentSettings(settings: Partial<SubagentSettingsRecord>): Promise<DesktopAppState> {
    return subagent.setSubagentSettings(this, settings);
  }

  async refreshSubagentAgents(workspaceId: string): Promise<DesktopAppState> {
    return subagent.refreshSubagentAgents(this, workspaceId);
  }

  async saveSubagentAgent(workspaceId: string, input: { readonly name: string; readonly raw: string; readonly scope?: "project" | "global" }): Promise<DesktopAppState> {
    return subagent.saveSubagentAgent(this, workspaceId, input);
  }

  async deleteSubagentAgent(workspaceId: string, name: string, scope: "project" | "global" = "project"): Promise<DesktopAppState> {
    return subagent.deleteSubagentAgent(this, workspaceId, name, scope);
  }

  async setCommitPushModel(workspaceId: string, model: string): Promise<DesktopAppState> {
    const next = reduce(this.state, { type: "settings/setCommitPushModel", commitPushModel: model });
    if (next === this.state) {
      return this.emit();
    }
    this.state = next;
    await this.persistUiState();
    return this.emit();
  }

  private agentSettingsPath(): string {
    return join(homedir(), ".pi", "agent", "settings.json");
  }

  async getSmartCompactSettings(): Promise<Record<string, unknown>> {
    try {
      const raw = await readFile(this.agentSettingsPath(), "utf8");
      const parsed = JSON.parse(raw);
      return (typeof parsed === "object" && parsed !== null ? parsed : {}).smartCompact ?? {};
    } catch {
      return {};
    }
  }

  async setSmartCompactSettings(settings: Record<string, unknown>): Promise<Record<string, unknown>> {
    const filePath = this.agentSettingsPath();
    let raw: Record<string, unknown> = {};
    try {
      const content = await readFile(filePath, "utf8");
      raw = JSON.parse(content);
      if (typeof raw !== "object" || raw === null) raw = {};
    } catch {
      // file doesn't exist yet
    }
    const current = (raw.smartCompact ?? {}) as Record<string, unknown>;
    const next = { ...current, ...settings };
    // Remove undefined/null values
    for (const key of Object.keys(next)) {
      if (next[key] === undefined || next[key] === null) delete next[key];
    }
    raw.smartCompact = next;
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
    return next;
  }

  private extensionConfigDir(): string {
    return join(homedir(), ".pi", "agent", "extension-configs");
  }

  private extensionConfigPath(extensionPath: string): string {
    // Create a safe filename from the extension path
    const safeName = extensionPath
      .replace(/[^a-zA-Z0-9]/g, "_")
      .replace(/_+/g, "_")
      .toLowerCase();
    return join(this.extensionConfigDir(), `${safeName}.json`);
  }

  async getExtensionConfig(extensionPath: string): Promise<import("../src/ipc").ExtensionConfigSchema | null> {
    try {
      const configPath = this.extensionConfigPath(extensionPath);
      const raw = await readFile(configPath, "utf8");
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  async setExtensionConfig(extensionPath: string, values: readonly { key: string; value: string | number | boolean }[]): Promise<void> {
    const existing = await this.getExtensionConfig(extensionPath);
    if (!existing) return;

    // Update field values
    const updatedFields = existing.fields.map((field) => {
      const override = values.find((v) => v.key === field.key);
      if (override) {
        return { ...field, currentValue: override.value };
      }
      return field;
    });

    const updated: import("../src/ipc").ExtensionConfigSchema = {
      ...existing,
      fields: updatedFields,
    };

    const configPath = this.extensionConfigPath(extensionPath);
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(configPath, `${JSON.stringify(updated, null, 2)}\n`, "utf8");

    // Also write env vars to a .env file if any
    const envFields = updatedFields.filter((f) => f.source === "env" && f.currentValue !== undefined);
    if (envFields.length > 0) {
      const envPath = join(this.extensionConfigDir(), ".env");
      let envContent = "";
      try {
        envContent = await readFile(envPath, "utf8");
      } catch {}
      for (const field of envFields) {
        const regex = new RegExp(`^${field.key}=.*$`, "m");
        const line = `${field.key}=${field.currentValue}`;
        if (regex.test(envContent)) {
          envContent = envContent.replace(regex, line);
        } else {
          envContent += `\n${line}`;
        }
      }
      await writeFile(envPath, envContent.trim() + "\n", "utf8");
    }
  }

  async analyzeExtensionConfig(extensionPath: string, model?: string): Promise<import("../src/ipc").ExtensionConfigSchema> {
    // Read the extension source code
    let sourceCode = "";
    try {
      sourceCode = await readFile(extensionPath, "utf8");
    } catch {
      throw new Error(`Cannot read extension file: ${extensionPath}`);
    }

    // Try to read README if exists
    let readme = "";
    const dir = dirname(extensionPath);
    for (const readmeName of ["README.md", "readme.md", "README.txt", "readme.txt"]) {
      try {
        readme = await readFile(join(dir, readmeName), "utf8");
        break;
      } catch {}
    }

    // Try LLM-based analysis first
    const llmResult = await this.analyzeExtensionConfigWithLLM(extensionPath, sourceCode, readme, model);
    if (llmResult) {
      return llmResult;
    }

    // Fallback to regex-based analysis
    const fields: import("../src/ipc").ExtensionConfigField[] = [];

    // Find environment variables: process.env.VARIABLE_NAME
    const envRegex = /process\.env\.([A-Z_][A-Z0-9_]*)/g;
    let envMatch;
    while ((envMatch = envRegex.exec(sourceCode)) !== null) {
      const varName = envMatch[1];
      if (varName && !fields.some((f) => f.key === varName)) {
        fields.push({
          key: varName,
          label: varName.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()),
          type: "string",
          source: "env",
          description: `Environment variable: ${varName}`,
        });
      }
    }

    const schema: import("../src/ipc").ExtensionConfigSchema = {
      extensionPath,
      displayName: basename(extensionPath, ".ts"),
      fields,
      analyzedAt: new Date().toISOString(),
    };

    // Save the schema
    const configPath = this.extensionConfigPath(extensionPath);
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(configPath, `${JSON.stringify(schema, null, 2)}\n`, "utf8");

    return schema;
  }

  private async analyzeExtensionConfigWithLLM(
    extensionPath: string,
    sourceCode: string,
    readme: string,
    model?: string,
  ): Promise<import("../src/ipc").ExtensionConfigSchema | null> {
    try {
      const { PROVIDER_CONFIGS, parseProviderAndModel } = await import("./llm-helpers.js");

      // Use provided model, smart-compact model, or fallback to deepseek
      let modelString = model;
      if (!modelString) {
        const settings = await this.getSmartCompactSettings();
        modelString = (typeof settings.summaryModel === "string" ? settings.summaryModel : null) ?? "deepseek:deepseek-chat";
      }
      const { providerId, modelId } = parseProviderAndModel(modelString);
      const config = PROVIDER_CONFIGS[providerId];
      if (!config) return null;

      // Get API key from store
      const apiKey = await this.getProviderApiKey(providerId);
      if (!apiKey) return null;

      // Truncate source if too long
      const maxSourceLen = 15000;
      const truncatedSource = sourceCode.length > maxSourceLen
        ? sourceCode.slice(0, maxSourceLen) + "\n... (truncated)"
        : sourceCode;

      const truncatedReadme = readme.length > 5000
        ? readme.slice(0, 5000) + "\n... (truncated)"
        : readme;

      const systemPrompt = `You are analyzing a pi coding agent extension to extract its configuration options.

An extension can have these types of configuration:
1. Environment variables (process.env.VAR_NAME) - credentials, API keys, feature flags
2. JSON config files (settings.json, config.json) - structured settings
3. CLI flags (registerFlag) - command-line options
4. Hardcoded constants that should be configurable - URLs, timeouts, limits

For each configuration option found, extract:
- key: the identifier (env var name, config key, flag name)
- label: human-readable name
- type: "string" | "number" | "boolean" | "select"
- description: what this option controls
- defaultValue: if found in the code
- options: for select type, the allowed values
- source: "env" | "file" | "flag" | "constant"
- sourcePath: for file type, the config file path

Return a JSON array of configuration fields. Only include ACTUAL configuration options, not internal constants.`;

      const userMessage = `Analyze this extension and extract all configuration options.

Extension path: ${extensionPath}

Source code:
\`\`\`
${truncatedSource}
\`\`\`
${truncatedReadme ? `\nREADME:\n\`\`\`\n${truncatedReadme}\n\`\`\`` : ""}

Return ONLY a JSON array of configuration fields, no explanation.`;

      const response = await fetch(`${config.apiBase}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: modelId,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userMessage },
          ],
          max_tokens: 2000,
          temperature: 0.1,
        }),
      });

      if (!response.ok) return null;

      const data = await response.json() as any;
      const content = data.choices?.[0]?.message?.content;
      if (!content) return null;

      // Extract JSON from response (handle markdown code blocks)
      let jsonStr = content;
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1];
      }
      // Also try to find raw JSON array
      const arrayMatch = jsonStr.match(/\[\s*\{[\s\S]*\}\s*\]/);
      if (arrayMatch) {
        jsonStr = arrayMatch[0];
      }

      const parsed = JSON.parse(jsonStr);
      if (!Array.isArray(parsed)) return null;

      const fields: import("../src/ipc").ExtensionConfigField[] = parsed.map((item: any) => ({
        key: String(item.key || ""),
        label: String(item.label || item.key || ""),
        type: ["string", "number", "boolean", "select"].includes(item.type) ? item.type : "string",
        description: item.description ? String(item.description) : undefined,
        defaultValue: item.defaultValue,
        currentValue: item.defaultValue,
        options: Array.isArray(item.options) ? item.options.map(String) : undefined,
        source: ["env", "file", "flag", "constant"].includes(item.source) ? item.source : "constant",
        sourcePath: item.sourcePath ? String(item.sourcePath) : undefined,
      }));

      const schema: import("../src/ipc").ExtensionConfigSchema = {
        extensionPath,
        displayName: basename(extensionPath, ".ts"),
        fields,
        analyzedAt: new Date().toISOString(),
        analyzedBy: modelString,
      };

      // Save the schema
      const configPath = this.extensionConfigPath(extensionPath);
      await mkdir(dirname(configPath), { recursive: true });
      await writeFile(configPath, `${JSON.stringify(schema, null, 2)}\n`, "utf8");

      return schema;
    } catch (err) {
      console.error("LLM analysis failed, falling back to regex:", err);
      return null;
    }
  }

  async installExtension(source: string, local?: boolean): Promise<{ success: boolean; message: string }> {
    try {
      const args = ["install", source];
      if (local) args.push("-l");
      const { stdout, stderr } = await execAsync(`pi ${args.join(" ")}`);
      return {
        success: true,
        message: stdout || stderr || `Installed ${source}`,
      };
    } catch (err: any) {
      return {
        success: false,
        message: err.stderr || err.stdout || err.message || "Installation failed",
      };
    }
  }

  async uninstallExtension(source: string, local?: boolean): Promise<{ success: boolean; message: string }> {
    try {
      const args = ["uninstall", source];
      if (local) args.push("-l");
      const { stdout, stderr } = await execAsync(`pi ${args.join(" ")}`);
      return {
        success: true,
        message: stdout || stderr || `Uninstalled ${source}`,
      };
    } catch (err: any) {
      return {
        success: false,
        message: err.stderr || err.stdout || err.message || "Uninstallation failed",
      };
    }
  }

  async checkExtensionUpdates(): Promise<{ source: string; current: string; latest: string }[]> {
    try {
      const _stdout = await execAsync("pi list --updates");
      // Parse the output - this is a simplified parser
      // In reality, you'd want to parse the actual format of pi list --updates
      const updates: { source: string; current: string; latest: string }[] = [];
      return updates;
    } catch {
      return [];
    }
  }

  async setTranscriptVerbose(enabled: boolean): Promise<DesktopAppState> {
    await this.initialize();
    const next = reduce(this.state, { type: "settings/setTranscriptVerbose", transcriptVerbose: enabled });
    if (next === this.state) {
      return structuredClone(this.state);
    }
    this.state = next;
    await this.persistUiState();
    return this.emit();
  }

  async setComposerDeviceMode(mode: ComposerDeviceMode): Promise<DesktopAppState> {
    await this.initialize();
    const next = reduce(this.state, { type: "settings/setComposerDeviceMode", composerDeviceMode: mode });
    if (next === this.state) {
      return structuredClone(this.state);
    }
    this.state = next;
    await this.persistUiState();
    return this.emit();
  }

  async setStreamReveal(mode: StreamRevealMode): Promise<DesktopAppState> {
    await this.initialize();
    const next = reduce(this.state, { type: "settings/setStreamReveal", streamReveal: mode });
    if (next === this.state) {
      return structuredClone(this.state);
    }
    this.state = next;
    await this.persistUiState();
    return this.emit();
  }

  async setStreamRevealSpeed(speed: StreamRevealSpeed): Promise<DesktopAppState> {
    await this.initialize();
    const next = reduce(this.state, { type: "settings/setStreamRevealSpeed", streamRevealSpeed: speed });
    if (next === this.state) {
      return structuredClone(this.state);
    }
    this.state = next;
    await this.persistUiState();
    return this.emit();
  }

  async setPlanModeIdeology(ideology: PlanModeIdeologySetting): Promise<DesktopAppState> {
    await this.initialize();
    const next = reduce(this.state, { type: "settings/setPlanModeIdeology", planModeIdeology: ideology });
    if (next === this.state) {
      return structuredClone(this.state);
    }
    this.state = next;
    await this.persistUiState();
    return this.emit();
  }

  async setThreadTransition(preferences: Partial<ThreadTransitionSettings>): Promise<DesktopAppState> {
    await this.initialize();
    this.state = reduce(this.state, { type: "settings/mergeThreadTransition", preferences });
    await this.persistUiState();
    return this.emit();
  }

  async setThemeMode(mode: ThemeMode): Promise<DesktopAppState> {
    await this.initialize();
    const next = reduce(this.state, { type: "settings/setThemeMode", themeMode: mode });
    if (next === this.state) {
      return structuredClone(this.state);
    }
    this.state = next;
    await this.persistUiState();
    return this.emit();
  }

  async setModelSettingsScopeMode(modelSettingsScopeMode: ModelSettingsScopeMode): Promise<DesktopAppState> {
    await this.initialize();
    const next = reduce(this.state, { type: "settings/setModelSettingsScopeMode", modelSettingsScopeMode });
    if (next === this.state) {
      return this.emit();
    }
    // Side effect runs BEFORE the state write so it still sees the
    // outgoing globalModelSettings (mirrors the original ordering).
    if (modelSettingsScopeMode === "app-global") {
      await this.restoreGlobalModelSettings(this.state.globalModelSettings);
    }
    this.state = next;
    await this.persistUiState();
    return this.refreshState({ clearLastError: true });
  }

  /* ── Runtime / model / provider settings ───────────────── */

  async refreshRuntime(workspaceId?: string): Promise<DesktopAppState> {
    await this.initialize();
    const resolvedWorkspaceId = workspaceId || this.state.selectedWorkspaceId;
    const ws = this.workspaceRefFromState(resolvedWorkspaceId);
    if (!ws) {
      return this.emit();
    }

    return this.withErrorHandling(async () => {
      const snapshot = await this.driver.runtimeSupervisor.refreshRuntime(ws);
      this.runtimeByWorkspace.set(ws.workspaceId, snapshot);
      this.clearExtensionUiForWorkspace(ws.workspaceId);
      await this.reloadSessionsForWorkspace(ws.workspaceId);
      await this.refreshSessionCommandsForWorkspace(ws.workspaceId);
      return this.refreshState({ clearLastError: true });
    });
  }

  async setSessionModel(target: WorkspaceSessionTarget, provider: string, modelId: string): Promise<DesktopAppState> {
    return composer.setSessionModel(this, target, provider, modelId);
  }

  async setDefaultModel(workspaceId: string, provider: string, modelId: string): Promise<DesktopAppState> {
    const targetWorkspaceId = this.resolveModelSettingsWorkspaceId(workspaceId);
    if (this.state.modelSettingsScopeMode !== "per-repo") {
      return this.withRuntimeUpdate(targetWorkspaceId, (ws) =>
        this.driver.runtimeSupervisor.setDefaultModel(ws, { provider, modelId }),
      );
    }
    await this.initialize();
    const ws = this.workspaceRefFromState(targetWorkspaceId);
    if (!ws) {
      return this.withError(`Unknown workspace: ${targetWorkspaceId}`);
    }
    return this.withErrorHandling(async () => {
      await updateProjectModelSettingsFile(ws.path, (settings) => ({
        ...settings,
        defaultProvider: provider,
        defaultModel: modelId,
      }));
      return this.refreshState({ clearLastError: true });
    });
  }

  async setDefaultThinkingLevel(
    workspaceId: string,
    thinkingLevel: RuntimeSettingsSnapshot["defaultThinkingLevel"],
  ): Promise<DesktopAppState> {
    const targetWorkspaceId = this.resolveModelSettingsWorkspaceId(workspaceId);
    if (this.state.modelSettingsScopeMode !== "per-repo") {
      return this.withRuntimeUpdate(targetWorkspaceId, (ws) =>
        this.driver.runtimeSupervisor.setDefaultThinkingLevel(ws, thinkingLevel),
      );
    }
    await this.initialize();
    const ws = this.workspaceRefFromState(targetWorkspaceId);
    if (!ws) {
      return this.withError(`Unknown workspace: ${targetWorkspaceId}`);
    }
    return this.withErrorHandling(async () => {
      await updateProjectModelSettingsFile(ws.path, (settings) => ({
        ...settings,
        ...(thinkingLevel ? { defaultThinkingLevel: thinkingLevel } : {}),
      }));
      return this.refreshState({ clearLastError: true });
    });
  }

  async setSessionThinkingLevel(
    sessionRef: SessionRef,
    thinkingLevel: NonNullable<RuntimeSettingsSnapshot["defaultThinkingLevel"]>,
  ): Promise<DesktopAppState> {
    return composer.setSessionThinkingLevel(this, sessionRef, thinkingLevel);
  }

  async loginProvider(workspaceId: string, providerId: string, callbacks: RuntimeLoginCallbacks): Promise<DesktopAppState> {
    await this.initialize();
    const targetWorkspaceId = this.resolveModelSettingsWorkspaceId(workspaceId);
    const ws = this.workspaceRefFromState(workspaceId);
    if (!ws) {
      return this.withError(`Unknown workspace: ${workspaceId}`);
    }

    return this.withErrorHandling(async () => {
      const snapshot = await this.driver.runtimeSupervisor.login(ws, providerId, callbacks);
      this.runtimeByWorkspace.set(workspaceId, snapshot);
      await this.autoEnableModelsForConnectedProvider(targetWorkspaceId, providerId, snapshot);
      await this.refreshSessionCommandsForWorkspace(workspaceId);
      return this.refreshState({ clearLastError: true });
    });
  }

  async logoutProvider(workspaceId: string, providerId: string): Promise<DesktopAppState> {
    return this.withRuntimeUpdate(workspaceId, (ws) =>
      this.driver.runtimeSupervisor.logout(ws, providerId),
    );
  }

  async setProviderApiKey(workspaceId: string, providerId: string, apiKey: string): Promise<DesktopAppState> {
    return this.withRuntimeUpdate(workspaceId, (ws) =>
      this.driver.runtimeSupervisor.setProviderApiKey(ws, providerId, apiKey),
    );
  }

  async addCustomProvider(
    workspaceId: string,
    config: {
      readonly providerId: string;
      readonly displayName: string;
      readonly baseUrl: string;
      readonly api: "openai-completions" | "openai-responses" | "anthropic-messages";
      readonly apiKey: string;
      readonly models: ReadonlyArray<{
        readonly id: string;
        readonly name: string;
        readonly reasoning: boolean;
        readonly input: readonly ("text" | "image")[];
        readonly contextWindow: number;
        readonly maxTokens: number;
      }>;
    },
  ): Promise<DesktopAppState> {
    return this.withRuntimeUpdate(workspaceId, (ws) =>
      this.driver.runtimeSupervisor.addCustomProvider(ws, config),
    );
  }

  async removeCustomProvider(workspaceId: string, providerId: string): Promise<DesktopAppState> {
    return this.withRuntimeUpdate(workspaceId, (ws) =>
      this.driver.runtimeSupervisor.removeCustomProvider(ws, providerId),
    );
  }

  async setEnableSkillCommands(workspaceId: string, enabled: boolean): Promise<DesktopAppState> {
    return this.withRuntimeUpdate(workspaceId, (ws) =>
      this.driver.runtimeSupervisor.setEnableSkillCommands(ws, enabled),
      { reloadSessions: true },
    );
  }

  async setRetrySettings(
    workspaceId: string,
    settings: { enabled: boolean; maxRetries: number; baseDelayMs: number },
  ): Promise<DesktopAppState> {
    return this.withRuntimeUpdate(workspaceId, (ws) =>
      this.driver.runtimeSupervisor.setRetrySettings(ws, settings),
    );
  }

  async getRetrySettings(
    workspaceId: string,
  ): Promise<{ enabled: boolean; maxRetries: number; baseDelayMs: number }> {
    const ws = this.workspaceRefFromState(workspaceId);
    if (!ws) {
      return { enabled: true, maxRetries: 3, baseDelayMs: 2000 };
    }
    return this.driver.runtimeSupervisor.getRetrySettings(ws);
  }

  async setScopedModelPatterns(workspaceId: string, patterns: readonly string[]): Promise<DesktopAppState> {
    const targetWorkspaceId = this.resolveModelSettingsWorkspaceId(workspaceId);
    if (this.state.modelSettingsScopeMode !== "per-repo") {
      return this.withRuntimeUpdate(targetWorkspaceId, (ws) =>
        this.driver.runtimeSupervisor.setScopedModelPatterns(ws, patterns),
      );
    }
    await this.initialize();
    const ws = this.workspaceRefFromState(targetWorkspaceId);
    if (!ws) {
      return this.withError(`Unknown workspace: ${targetWorkspaceId}`);
    }
    return this.withErrorHandling(async () => {
      await updateProjectModelSettingsFile(ws.path, (settings) => ({
        ...settings,
        enabledModels: patterns.length > 0 ? [...patterns] : undefined,
      }));
      return this.refreshState({ clearLastError: true });
    });
  }

  private async autoEnableModelsForConnectedProvider(
    workspaceId: string,
    providerId: string,
    snapshot: RuntimeSnapshot,
  ): Promise<void> {
    const providerModelPatterns = [...new Set(
      snapshot.models
        .filter((model) => model.available && model.providerId === providerId)
        .map((model) => `${model.providerId}/${model.modelId}`),
    )];
    if (providerModelPatterns.length === 0) {
      return;
    }

    const currentPatterns = snapshot.settings.enabledModelPatterns;
    if (currentPatterns.length === 0) {
      return;
    }

    const nextPatterns = mergeEnabledModelPatterns(currentPatterns, providerModelPatterns);
    if (nextPatterns.length === currentPatterns.length) {
      return;
    }

    if (this.state.modelSettingsScopeMode !== "per-repo") {
      const ownerWorkspace = this.workspaceRefFromState(workspaceId);
      if (!ownerWorkspace) {
        return;
      }
      const updatedSnapshot = await this.driver.runtimeSupervisor.setScopedModelPatterns(ownerWorkspace, nextPatterns);
      this.runtimeByWorkspace.set(workspaceId, updatedSnapshot);
      return;
    }

    const ownerWorkspace = this.workspaceRefFromState(workspaceId);
    if (!ownerWorkspace) {
      return;
    }
    await updateProjectModelSettingsFile(ownerWorkspace.path, (settings) => ({
      ...settings,
      enabledModels: nextPatterns,
    }));
  }

  async setSkillEnabled(workspaceId: string, filePath: string, enabled: boolean): Promise<DesktopAppState> {
    return this.withRuntimeUpdate(workspaceId, (ws) =>
      this.driver.runtimeSupervisor.setSkillEnabled(ws, filePath, enabled),
      { reloadSessions: true },
    );
  }

  async setExtensionEnabled(workspaceId: string, filePath: string, enabled: boolean): Promise<DesktopAppState> {
    return this.withRuntimeUpdate(workspaceId, (ws) =>
      this.driver.runtimeSupervisor.setExtensionEnabled(ws, filePath, enabled),
      { reloadSessions: true },
    );
  }

  async deleteExtension(workspaceId: string, filePath: string): Promise<DesktopAppState> {
    return this.withRuntimeUpdate(workspaceId, (ws) =>
      this.driver.runtimeSupervisor.deleteExtension(ws, filePath),
      { reloadSessions: true },
    );
  }

  private async withRuntimeUpdate(
    workspaceId: string,
    action: (ws: WorkspaceRef) => Promise<RuntimeSnapshot>,
    options?: {
      readonly reloadSessions?: boolean;
    },
  ): Promise<DesktopAppState> {
    await this.initialize();
    const ws = this.workspaceRefFromState(workspaceId);
    if (!ws) {
      return this.withError(`Unknown workspace: ${workspaceId}`);
    }

    return this.withErrorHandling(async () => {
      const snapshot = await action(ws);
      this.runtimeByWorkspace.set(workspaceId, snapshot);
      if (options?.reloadSessions) {
        this.clearExtensionUiForWorkspace(workspaceId);
        await this.reloadSessionsForWorkspace(workspaceId);
      }
      await this.refreshSessionCommandsForWorkspace(workspaceId);
      return this.refreshState({ clearLastError: true });
    });
  }

  /* ── Internal infrastructure (AppStoreInternals) ───────── */

  /** Merge persisted UI preferences into the current state. ~pure. */
  private mergePersistedState(persisted: PersistedUiState): DesktopAppState {
    return {
      ...this.state,
      activeView: persisted.activeView ?? this.state.activeView,
      modelSettingsScopeMode: persisted.modelSettingsScopeMode ?? this.state.modelSettingsScopeMode,
      globalModelSettings: persisted.appGlobalModelSettings ?? this.state.globalModelSettings,
      notificationPreferences: {
        ...this.state.notificationPreferences,
        ...persisted.notificationPreferences,
      },
      subagentSettings: {
        ...this.state.subagentSettings,
        ...persisted.subagentSettings,
      },
      integratedTerminalShell: persisted.integratedTerminalShell ?? this.state.integratedTerminalShell,
      externalTerminalApp: persisted.externalTerminalApp ?? this.state.externalTerminalApp,
      retrySettings: persisted.retrySettings ?? this.state.retrySettings,
      lastViewedAtBySession: persisted.lastViewedAtBySession ?? {},
      threadTypeBySession: persisted.threadTypeBySession ?? {},
      workspaceOrder: persisted.workspaceOrder ?? [],
      sidebarCollapsed: persisted.sidebarCollapsed ?? this.state.sidebarCollapsed,
      zoomFactor: persisted.zoomFactor ?? this.state.zoomFactor,
      transcriptVerbose: persisted.transcriptVerbose ?? this.state.transcriptVerbose,
      composerDeviceMode: persisted.composerDeviceMode ?? this.state.composerDeviceMode,
      streamReveal: persisted.streamReveal ?? this.state.streamReveal,
      streamRevealSpeed: persisted.streamRevealSpeed ?? this.state.streamRevealSpeed,
      threadTransition: persisted.threadTransition
        ? { ...this.state.threadTransition, ...persisted.threadTransition }
        : this.state.threadTransition,
      themeMode: persisted.themeMode ?? this.state.themeMode,
      commitPushModel: persisted.commitPushModel ?? this.state.commitPushModel,
      chats: persisted.chats ?? [],
      selectedChatId: persisted.selectedChatId ?? "",
    };
  }

  /** Copy persisted per-session maps into the in-memory session state. */
  private restorePersistedSessionMaps(persisted: PersistedUiState): void {
    this.sessionState.lastViewedAtBySession.clear();
    for (const [key, viewedAt] of Object.entries(persisted.lastViewedAtBySession ?? {})) {
      if (viewedAt) {
        this.sessionState.lastViewedAtBySession.set(key, viewedAt);
      }
    }
    this.sessionState.composerDraftsBySession.clear();
    for (const [key, draft] of Object.entries(persisted.composerDraftsBySession ?? {})) {
      if (draft) {
        this.sessionState.composerDraftsBySession.set(key, draft);
      }
    }
    this.extensionCommandCompatibilityByWorkspace.clear();
    for (const [workspaceId, records] of restoreCompatibilityByWorkspace(
      persisted.extensionCommandCompatibilityByWorkspace,
    )) {
      this.extensionCommandCompatibilityByWorkspace.set(workspaceId, records);
    }
  }

  /** Build a fallback state when initializeInternal fails. */
  private buildInitFallbackState(persisted: PersistedUiState, error: unknown): DesktopAppState {
    return {
      ...createEmptyDesktopAppState(),
      zoomFactor: persisted.zoomFactor ?? ZOOM_BASELINE,
      transcriptVerbose: persisted.transcriptVerbose ?? false,
      composerDeviceMode: persisted.composerDeviceMode ?? "modular-cream",
      streamReveal: persisted.streamReveal ?? "blur",
      streamRevealSpeed: persisted.streamRevealSpeed ?? "medium",
      themeMode: persisted.themeMode ?? "system",
      lastError: error instanceof Error ? error.message : String(error),
      commitPushModel: persisted.commitPushModel,
      chats: persisted.chats ?? [],
      selectedChatId: persisted.selectedChatId ?? "",
      revision: 1,
    };
  }

  private async initializeInternal(): Promise<void> {
    const persisted = await this.readUiState();
    try {
      this.state = this.mergePersistedState(persisted);
      applySubagentEnvironment(this.state.subagentSettings);
      await this.migrateLegacyPersistence(persisted);
      this.restorePersistedSessionMaps(persisted);

      const initialWorkspacePaths = this.initialWorkspacePaths.map((path) => path.trim()).filter(Boolean);
      const knownWorkspaces = await this.driver.listWorkspaces();
      const workspacesToSync = new Map<string, string | undefined>();
      for (const workspacePath of initialWorkspacePaths) {
        workspacesToSync.set(workspacePath, undefined);
      }
      for (const ws of knownWorkspaces.workspaces) {
        workspacesToSync.set(ws.path, ws.displayName);
      }
      await Promise.all(
        [...workspacesToSync.entries()].map(([workspacePath, displayName]) =>
          this.driver.syncWorkspace(workspacePath, displayName),
        ),
      );

      await this.refreshState({
        selectedWorkspaceId: persisted.selectedWorkspaceId,
        selectedSessionId: persisted.selectedSessionId,
        composerDraft: persisted.composerDraft,
        clearLastError: true,
        refreshWorktrees: true,
        hydrateSelectedSession: false,
        markSelectedSessionViewed: false,
      });
      const restoredSessionRef = this.selectedSessionRef();
      if (restoredSessionRef && persisted.selectedWorkspaceId && persisted.selectedSessionId) {
        this.restoredSelectedSessionKeysAwaitingSelection.add(sessionKey(restoredSessionRef));
      }
      this.startSelectedSessionHydration(restoredSessionRef, { markViewed: false });
    } catch (error) {
      this.state = this.buildInitFallbackState(persisted, error);
      await this.persistUiState();
      this.emit();
    }
  }

  private async migrateLegacyPersistence(persisted: LegacyPersistedUiState): Promise<void> {
    const transcriptEntries = Object.entries(persisted.transcripts ?? {});
    await Promise.all(
      transcriptEntries.map(async ([key, transcript]) => {
        const clonedTranscript = transcript.map((item) => cloneTranscriptMessage(item as TranscriptMessage));
        if (clonedTranscript.length > 0) {
          if (this.isPossiblyTrimmedLegacyTranscript(clonedTranscript)) {
            return;
          }
          this.sessionState.transcriptCache.set(key, clonedTranscript);
          this.sessionState.loadedTranscriptKeys.add(key);
          await this.writePersistedTranscript(key, clonedTranscript);
        }
      }),
    );

    const attachmentEntries = Object.entries(persisted.composerAttachmentsBySession ?? {});
    await Promise.all(
      attachmentEntries.map(async ([key, attachments]) => {
        const cloned = cloneComposerAttachments(attachments as readonly ComposerAttachment[]);
        if (cloned.length > 0) {
          this.sessionState.composerAttachmentsBySession.set(key, cloned);
          await this.attachmentStore.write(key, cloned);
        }
      }),
    );
  }

  /** Remove runtime + compatibility entries for workspaces no longer in the catalog. */
  private pruneStaleMaps(liveWorkspaceIds: ReadonlySet<string>): void {
    for (const wsId of this.runtimeByWorkspace.keys()) {
      if (!liveWorkspaceIds.has(wsId)) {
        this.runtimeByWorkspace.delete(wsId);
      }
    }
    for (const workspaceId of this.extensionCommandCompatibilityByWorkspace.keys()) {
      if (!liveWorkspaceIds.has(workspaceId)) {
        this.extensionCommandCompatibilityByWorkspace.delete(workspaceId);
      }
    }
  }

  /** Load runtimes for all non-selected workspaces + prune stale compat entries. */
  private async preloadSecondaryRuntimes(
    selectedWorkspaceId: string,
    rawWorkspaces: readonly WorkspaceCatalogEntry[],
  ): Promise<void> {
    if (selectedWorkspaceId && !this.runtimeByWorkspace.has(selectedWorkspaceId)) {
      await this.ensureRuntimeLoaded(selectedWorkspaceId, rawWorkspaces);
    }
    const secondaryWorkspacesToLoad = rawWorkspaces
      .filter((workspace) => workspace.workspaceId !== selectedWorkspaceId)
      .filter((workspace) => !this.runtimeByWorkspace.has(workspace.workspaceId));
    const secondaryRuntimeLoads = await Promise.allSettled(
      secondaryWorkspacesToLoad.map((workspace) => this.ensureRuntimeLoaded(workspace.workspaceId, rawWorkspaces)),
    );
    secondaryRuntimeLoads.forEach((result, index) => {
      if (result.status === "fulfilled") {
        return;
      }
      const failedWorkspace = secondaryWorkspacesToLoad[index];
      console.warn(
        `[pi-gui] Failed to preload runtime for ${failedWorkspace?.path ?? "unknown workspace"}: ${
          result.reason instanceof Error ? result.reason.message : String(result.reason)
        }`,
      );
    });
    for (const runtime of this.runtimeByWorkspace.values()) {
      pruneCompatibilityForRuntimeSnapshot(this.extensionCommandCompatibilityByWorkspace, runtime);
    }
  }

  /** Resolve global + per-repo model settings and restore if stale. */
  private async resolveRefreshModelSettings(
    workspaces: readonly WorkspaceRecord[],
    rawWorkspaces: readonly WorkspaceCatalogEntry[],
    selectedWorkspaceId: string,
  ): Promise<{ globalModelSettings: ModelSettingsSnapshot; scopedModelSettingsByWorkspace: Record<string, ModelSettingsSnapshot> | undefined }> {
    const liveGlobalModelSettings = await this.loadLiveGlobalModelSettings(
      rawWorkspaces,
      selectedWorkspaceId || rawWorkspaces[0]?.workspaceId,
    );
    const globalModelSettings =
      this.state.modelSettingsScopeMode === "per-repo" && hasStoredModelSettings(this.state.globalModelSettings)
        ? this.state.globalModelSettings
        : liveGlobalModelSettings;
    if (
      this.state.modelSettingsScopeMode === "per-repo" &&
      hasStoredModelSettings(globalModelSettings) &&
      !modelSettingsEqual(globalModelSettings, liveGlobalModelSettings)
    ) {
      await this.restoreGlobalModelSettings(globalModelSettings, rawWorkspaces, selectedWorkspaceId);
    }
    const scopedModelSettingsByWorkspace =
      this.state.modelSettingsScopeMode === "per-repo"
        ? await this.loadScopedModelSettingsByWorkspace(workspaces, rawWorkspaces, globalModelSettings)
        : undefined;
    return { globalModelSettings, scopedModelSettingsByWorkspace };
  }

  async refreshState(options: RefreshStateOptions = {}): Promise<DesktopAppState> {
    this.refreshStateDepth += 1;
    try {
      const previousSelectedKey = this.currentSelectedSessionKey();
      const [workspacesSnapshot, sessionsSnapshot] = await Promise.all([
        this.driver.listWorkspaces(),
        this.driver.listSessions(),
      ]);
      const worktreeEntries = options.refreshWorktrees
        ? await worktree.syncAndListWorktrees(this, workspacesSnapshot.workspaces)
        : (await this.catalogStore.worktrees.listWorktrees()).worktrees;

      await this.pruneStaleSessionSubscriptions(sessionsSnapshot.sessions);
      await this.ensureSubscriptionsForSessions(sessionsSnapshot.sessions);

      const selectedWorkspaceId = resolveSelectedWorkspaceIdFromCatalog(
        options.selectedWorkspaceId ?? this.state.selectedWorkspaceId,
        workspacesSnapshot.workspaces,
      );
      const selectedSessionId = resolveSelectedSessionIdFromCatalog(
        selectedWorkspaceId,
        options.selectedSessionId ?? this.state.selectedSessionId,
        sessionsSnapshot.sessions,
      );

      if (selectedWorkspaceId && selectedSessionId && options.hydrateSelectedSession !== false) {
        const sessionRef = {
          workspaceId: selectedWorkspaceId,
          sessionId: selectedSessionId,
        };
        await this.ensureSessionReady(sessionRef);
        await this.ensureComposerAttachmentsLoaded(sessionRef);
      }

      const workspaces = buildWorkspaceRecords(
        workspacesSnapshot.workspaces,
        worktreeEntries,
        sessionsSnapshot.sessions,
        this.sessionState.transcriptCache,
        this.sessionState.runningSinceBySession,
        this.sessionState.sessionConfigBySession,
        this.sessionState.lastViewedAtBySession,
        this.sessionState.contextUsageBySession,
      );
      const worktreesByWorkspace = buildWorktreeRecords(workspacesSnapshot.workspaces, worktreeEntries);
      this.pruneStaleMaps(new Set(workspaces.map((w) => w.id)));
      await this.preloadSecondaryRuntimes(selectedWorkspaceId, workspacesSnapshot.workspaces);

      const { globalModelSettings, scopedModelSettingsByWorkspace } = await this.resolveRefreshModelSettings(
        workspaces,
        workspacesSnapshot.workspaces,
        selectedWorkspaceId,
      );
      const runtimeByWorkspace = this.serializeEffectiveRuntimeState(workspaces, scopedModelSettingsByWorkspace);
      for (const workspace of workspaces) {
        await this.reloadSubagentAgentsForWorkspace(workspace.id, workspace.path);
      }

      const activeView = options.activeView ?? this.state.activeView;
      const composerDraftSync = this.resolveComposerDraftSync(selectedWorkspaceId, selectedSessionId, options);
      this.state = {
        ...this.state,
        workspaces,
        worktreesByWorkspace,
        selectedWorkspaceId,
        selectedSessionId,
        activeView,
        runtimeByWorkspace,
        sessionCommandsBySession: mapToRecord(this.sessionState.sessionCommandsBySession),
        sessionExtensionUiBySession: this.serializeSessionExtensionUiState(),
        extensionCommandCompatibilityByWorkspace: serializeCompatibilityByWorkspace(this.extensionCommandCompatibilityByWorkspace),
        lastViewedAtBySession: mapToRecord(this.sessionState.lastViewedAtBySession),
        workspaceOrder: this.state.workspaceOrder,
        modelSettingsScopeMode: this.state.modelSettingsScopeMode,
        globalModelSettings,
        composerDraft: this.resolveComposerDraft(selectedWorkspaceId, selectedSessionId, options.composerDraft),
        composerDraftSyncSource: composerDraftSync.source,
        composerDraftSyncNonce: composerDraftSync.nonce,
        composerAttachments: this.resolveComposerAttachments(selectedWorkspaceId, selectedSessionId),
        queuedComposerMessages: this.resolveQueuedComposerMessages(selectedWorkspaceId, selectedSessionId),
        editingQueuedMessageId: this.resolveEditingQueuedMessageId(selectedWorkspaceId, selectedSessionId),
        lastError: this.resolveSelectedSessionError(selectedWorkspaceId, selectedSessionId, options.clearLastError),
        automations: this.automationStoreRef ? this.automationStoreRef.getAll() : this.state.automations,
        revision: this.state.revision + 1,
      };

      if (options.markSelectedSessionViewed ?? true) {
        this.markSelectedSessionViewedIfVisible();
      }

      await this.persistUiState();
      const snapshot = this.emit();
      // Only publish a transcript once it is actually loaded. Publishing here
      // when hydrateSelectedSession === false (e.g. session restore on launch)
      // pushes an EMPTY transcript and pins the renderer's coalescing key to
      // the selected session, so the later hydration publish gets coalesced
      // behind a requestAnimationFrame that can starve while the window is
      // backgrounded — leaving the thread stuck blank until the user switches
      // away and back.
      if (this.currentSelectedSessionKey() !== previousSelectedKey) {
        const selectedRef = this.selectedSessionRef();
        if (selectedRef && this.sessionState.loadedTranscriptKeys.has(sessionKey(selectedRef))) {
          this.publishSelectedTranscript();
        }
      }
      return snapshot;
    } finally {
      this.refreshStateDepth = Math.max(0, this.refreshStateDepth - 1);
    }
  }

  private async pruneStaleSessionSubscriptions(sessions: readonly SessionCatalogEntry[]): Promise<void> {
    const activeKeys = new Set(sessions.map((session) => sessionKey(session.sessionRef)));
    this.sessionState.prune(activeKeys);
  }

  private async ensureSubscriptionsForSessions(sessions: readonly SessionCatalogEntry[]): Promise<void> {
    for (const session of sessions) {
      if (session.status !== "running") {
        continue;
      }
      await this.ensureSessionSubscription(session.sessionRef);
    }
  }

  async ensureSessionReady(sessionRef: SessionRef): Promise<SessionSnapshot | undefined> {
    await this.ensureTranscriptLoaded(sessionRef);
    // Always open the session to get a fresh snapshot (including contextUsage).
    // openSession is idempotent for already-subscribed sessions.
    const snapshot = await this.driver.openSession(sessionRef);
    this.updateSessionConfig(sessionRef, snapshot.config);
    if (snapshot.contextUsage) {
      this.sessionState.contextUsageBySession.set(sessionKey(sessionRef), snapshot.contextUsage);
    }
    await this.ensureSessionSubscribed(sessionRef);
    await this.refreshSessionCommands(sessionRef);
    return snapshot;
  }

  async ensureSessionSubscription(sessionRef: SessionRef): Promise<void> {
    if (!this.sessionState.sessionSubscriptions.has(sessionKey(sessionRef))) {
      const snapshot = await this.driver.openSession(sessionRef);
      this.updateSessionConfig(sessionRef, snapshot.config);
      if (snapshot.contextUsage) {
        this.sessionState.contextUsageBySession.set(sessionKey(sessionRef), snapshot.contextUsage);
      }
      this.updateQueuedComposerMessages(sessionRef, snapshot.queuedMessages);
    }
    await this.ensureSessionSubscribed(sessionRef);
  }



  private async ensureTranscriptLoaded(sessionRef: SessionRef): Promise<void> {
    const key = sessionKey(sessionRef);
    if (this.sessionState.loadedTranscriptKeys.has(key)) {
      return;
    }

    const cachedTranscript = await this.readPersistedTranscript(key);
    const transcript = cachedTranscript
      ? await this.resolveLoadedTranscript(sessionRef, cachedTranscript)
      : await this.driver.getTranscript(sessionRef);

    if (!cachedTranscript || cachedTranscript.format === "legacy") {
      await this.writePersistedTranscript(key, transcript);
    }

    this.sessionState.loadedTranscriptKeys.add(key);
    this.sessionState.transcriptCache.set(key, transcript);
  }

  async reloadTranscriptFromDriver(sessionRef: SessionRef): Promise<void> {
    const key = sessionKey(sessionRef);
    const transcript =
      await this.driver.getTranscript(sessionRef);
    this.sessionState.loadedTranscriptKeys.add(key);
    this.sessionState.transcriptCache.set(key, transcript);
    void this.writePersistedTranscript(key, transcript);
    this.publishSelectedTranscriptFor(sessionRef);
  }

  private async ensureComposerAttachmentsLoaded(sessionRef: SessionRef): Promise<void> {
    const key = sessionKey(sessionRef);
    if (this.sessionState.composerAttachmentsBySession.has(key)) {
      return;
    }

    const attachments = await this.attachmentStore.read(key);
    if (attachments?.length) {
      this.sessionState.composerAttachmentsBySession.set(key, cloneComposerAttachments(attachments));
    }
  }

  private async ensureRuntimeLoaded(
    workspaceId: string,
    workspaces?: readonly { workspaceId: string; path: string; displayName: string }[],
  ): Promise<void> {
    if (this.runtimeByWorkspace.has(workspaceId)) {
      return;
    }

    const ws =
      this.workspaceRefFromState(workspaceId) ??
      workspaces?.find((entry) => entry.workspaceId === workspaceId);
    if (!ws) {
      return;
    }

    const snapshot = await this.driver.runtimeSupervisor.getRuntimeSnapshot({
      workspaceId: ws.workspaceId,
      path: ws.path,
      displayName: ws.displayName,
    });
    this.runtimeByWorkspace.set(workspaceId, snapshot);
  }

  async ensureSessionSubscribed(sessionRef: SessionRef): Promise<void> {
    const key = sessionKey(sessionRef);
    if (this.sessionState.sessionSubscriptions.has(key)) {
      return;
    }

    const unsubscribe = this.driver.subscribe(sessionRef, (event) => {
      void this.handleSessionEvent(event, key);
    });
    this.sessionState.sessionSubscriptions.set(key, unsubscribe);
  }

  private migrateSessionSubscriptionKey(sourceKey: string, targetKey: string): void {
    if (sourceKey === targetKey) {
      return;
    }

    const unsubscribe = this.sessionState.sessionSubscriptions.get(sourceKey);
    if (!unsubscribe) {
      return;
    }

    if (this.sessionState.sessionSubscriptions.has(targetKey)) {
      unsubscribe();
      this.sessionState.sessionSubscriptions.delete(sourceKey);
      return;
    }

    this.sessionState.sessionSubscriptions.delete(sourceKey);
    this.sessionState.sessionSubscriptions.set(targetKey, unsubscribe);
  }

  async cancelPendingDialogsForSession(sessionRef: SessionRef): Promise<void> {
    const key = sessionKey(sessionRef);
    const uiState = this.sessionState.extensionUiBySession.get(key);
    if (!uiState || uiState.pendingDialogs.length === 0) {
      return;
    }

    const pendingDialogs = [...uiState.pendingDialogs];
    uiState.pendingDialogs = [];
    await Promise.all(
      pendingDialogs.map((dialog) =>
        this.driver.respondToHostUiRequest(sessionRef, {
          requestId: dialog.requestId,
          cancelled: true,
        } satisfies HostUiResponse),
      ),
    );
  }

  async respondToHostUiRequest(
    sessionRef: SessionRef,
    response: HostUiResponse,
  ): Promise<DesktopAppState> {
    const key = sessionKey(sessionRef);
    const uiState = this.sessionState.extensionUiBySession.get(key);
    if (uiState) {
      uiState.pendingDialogs = uiState.pendingDialogs.filter((dialog) => dialog.requestId !== response.requestId);
    }

    return this.withErrorHandling(async () => {
      await this.driver.respondToHostUiRequest(sessionRef, response);
      return this.refreshState({ clearLastError: true });
    });
  }

  private async refreshSessionCommands(sessionRef: SessionRef): Promise<void> {
    const key = sessionKey(sessionRef);
    const commands = await this.driver.getSessionCommands(sessionRef);
    this.sessionState.sessionCommandsBySession.set(key, [...commands]);
  }

  async refreshSessionCommandsFor(sessionRef: SessionRef): Promise<void> {
    await this.refreshSessionCommands(sessionRef);
  }

  getLearnedRuntimeCommandCompatibility(
    workspaceId: string,
    command: RuntimeCommandRecord,
  ): ExtensionCommandCompatibilityRecord | undefined {
    return getLearnedCommandCompatibility(this.extensionCommandCompatibilityByWorkspace, workspaceId, command);
  }

  beginRuntimeCommandExecution(sessionRef: SessionRef, command: RuntimeCommandRecord): void {
    this.pendingRuntimeCommandsBySession.set(sessionKey(sessionRef), { command });
  }

  finishRuntimeCommandExecution(
    sessionRef: SessionRef,
    timestamp = new Date().toISOString(),
  ): PendingRuntimeCommandExecution | undefined {
    const key = sessionKey(sessionRef);
    const pending = this.pendingRuntimeCommandsBySession.get(key);
    if (!pending) {
      return undefined;
    }

    this.pendingRuntimeCommandsBySession.delete(key);
    if (!pending.blockedMessage) {
      recordLearnedCommandCompatibility(this.extensionCommandCompatibilityByWorkspace, sessionRef.workspaceId, {
        commandName: pending.command.name,
        extensionPath: pending.command.sourceInfo.path,
        status: "supported",
        message: "Observed working in pi-gui.",
        capability: "gui-safe",
        updatedAt: timestamp,
      });
    }

    return pending;
  }

  clearExtensionUiForSession(sessionRef: SessionRef): void {
    const key = sessionKey(sessionRef);
    if (!this.sessionState.extensionUiBySession.has(key)) {
      return;
    }

    this.sessionState.extensionUiBySession.delete(key);
    this.state = this.syncDerivedSessionState(this.state, sessionRef);
  }

  private async refreshSessionCommandsForWorkspace(workspaceId: string): Promise<void> {
    const sessionRefs = this.sessionRefsForWorkspace(workspaceId);
    await Promise.all(sessionRefs.map((sessionRef) => this.refreshSessionCommands(sessionRef)));
  }

  private async reloadSessionsForWorkspace(workspaceId: string): Promise<void> {
    const sessionRefs = this.sessionRefsForWorkspace(workspaceId);
    await Promise.all(sessionRefs.map((sessionRef) => this.driver.reloadSession(sessionRef)));
  }

  private async reloadSubagentAgentsForWorkspace(workspaceId: string, workspacePath?: string): Promise<void> {
    return subagent.reloadSubagentAgentsForWorkspace(this, workspaceId, workspacePath);
  }

  private clearExtensionUiForWorkspace(workspaceId: string): void {
    for (const sessionRef of this.sessionRefsForWorkspace(workspaceId)) {
      this.clearExtensionUiForSession(sessionRef);
    }
  }

  private reportExtensionCompatibilityIssue(
    sessionRef: SessionRef,
    issue: Extract<SessionDriverEvent, { type: "extensionCompatibilityIssue" }>["issue"],
    timestamp: string,
  ): void {
    const key = sessionKey(sessionRef);
    const pending = this.pendingRuntimeCommandsBySession.get(key);
    if (pending) {
      const message = `/${pending.command.name} requires terminal-only ${formatCapabilityLabel(issue.capability)} and is not supported in pi-gui yet. Use pi in the terminal for this command.`;
      pending.blockedMessage = message;
      recordLearnedCommandCompatibility(this.extensionCommandCompatibilityByWorkspace, sessionRef.workspaceId, {
        commandName: pending.command.name,
        extensionPath: pending.command.sourceInfo.path,
        status: "terminal-only",
        message,
        capability: issue.capability,
        updatedAt: timestamp,
      });
      this.sessionState.sessionErrorsBySession.set(key, message);
      return;
    }

    const fingerprint = `${issue.extensionPath ?? "<unknown>"}:${issue.eventName ?? "<unknown>"}:${issue.capability}`;
    const seen = this.reportedCompatibilityIssuesBySession.get(key) ?? new Set<string>();
    if (seen.has(fingerprint)) {
      return;
    }

    seen.add(fingerprint);
    this.reportedCompatibilityIssuesBySession.set(key, seen);
    this.sessionState.sessionErrorsBySession.set(key, issue.message);
  }

  private sessionRefsForWorkspace(workspaceId: string): SessionRef[] {
    const workspace = this.state.workspaces.find((entry) => entry.id === workspaceId);
    if (!workspace) {
      return [];
    }

    return workspace.sessions
      .map((session) => ({
        workspaceId,
        sessionId: session.id,
      }))
      .filter((sessionRef) => {
        const key = sessionKey(sessionRef);
        return (
          (this.state.selectedWorkspaceId === workspaceId && this.state.selectedSessionId === sessionRef.sessionId) ||
          this.sessionState.sessionCommandsBySession.has(key) ||
          this.sessionState.sessionSubscriptions.has(key)
        );
      });
  }

  /** Apply the event-specific side effects (update config, errors, cleanup). */
  private async applySessionEventActions(event: SessionDriverEvent, key: string): Promise<void> {
    switch (event.type) {
      case "sessionOpened":
      case "runCompleted":
        this.updateSessionConfig(event.sessionRef, event.snapshot.config);
        this.updateQueuedComposerMessages(event.sessionRef, event.snapshot.queuedMessages);
        await this.refreshSessionCommands(event.sessionRef);
        break;
      case "sessionUpdated":
        this.updateSessionConfig(event.sessionRef, event.snapshot.config);
        this.updateQueuedComposerMessages(event.sessionRef, event.snapshot.queuedMessages);
        if (event.snapshot.status !== "running") {
          await this.refreshSessionCommands(event.sessionRef);
        }
        break;
      case "runFailed":
        await this.refreshSessionCommands(event.sessionRef);
        this.sessionState.sessionErrorsBySession.set(key, event.error.message);
        break;
      case "extensionCompatibilityIssue":
        this.reportExtensionCompatibilityIssue(event.sessionRef, event.issue, event.timestamp);
        break;
      case "sessionClosed":
        this.clearPendingAutoTitle(event.sessionRef);
        this.pendingRuntimeCommandsBySession.delete(key);
        this.reportedCompatibilityIssuesBySession.delete(key);
        this.sessionState.sessionSubscriptions.get(key)?.();
        this.sessionState.sessionSubscriptions.delete(key);
        this.sessionState.sessionErrorsBySession.delete(key);
        break;
      default:
        break;
    }
    if (event.type === "runCompleted") {
      this.sessionState.sessionErrorsBySession.delete(key);
      await this.maybeAutoCompact(event.sessionRef, event.snapshot);
    }
  }

  /**
   * Auto-trigger smart compaction after a run completes when context usage
   * crosses the configured threshold. Reads settings from ~/.pi/agent/settings.json
   * (smartCompact). Percent OR token threshold — whichever is hit first.
   */
  private async maybeAutoCompact(sessionRef: SessionRef, snapshot: SessionSnapshot): Promise<void> {
    const usage = snapshot.contextUsage;
    if (!usage || usage.contextWindow <= 0) {
      return;
    }
    const settings = await this.getSmartCompactSettings();
    // Default on; only disabled when explicitly set to false.
    if (settings.autoTrigger === false) {
      return;
    }
    const minContextPercent = typeof settings.minContextPercent === "number" ? settings.minContextPercent : 60;
    const minTokenThreshold = typeof settings.minTokenThreshold === "number" ? settings.minTokenThreshold : 0;
    const percent = (usage.usedTokens / usage.contextWindow) * 100;
    const hitPercent = percent >= minContextPercent;
    const hitTokens = minTokenThreshold > 0 && usage.usedTokens >= minTokenThreshold;
    if (!hitPercent && !hitTokens) {
      return;
    }
    const key = sessionKey(sessionRef);
    if (this.autoCompactInFlight.has(key)) {
      return;
    }
    this.autoCompactInFlight.add(key);
    try {
      await this.driver.compactSession(sessionRef);
    } catch (error) {
      console.error(`[smart-compact] auto-compact failed for ${key}:`, error);
    } finally {
      this.autoCompactInFlight.delete(key);
    }
  }

  /** Hydrate the state patch, persist, and publish all relevant channels. */
  private async publishSessionEventResults(
    event: SessionDriverEvent,
    patch: DesktopSessionStatePatch,
    shouldFollowSessionMutation: boolean,
    refreshedFollowedSession: boolean,
  ): Promise<DesktopAppState> {
    this.state = {
      ...patch.state,
      extensionCommandCompatibilityByWorkspace: serializeCompatibilityByWorkspace(this.extensionCommandCompatibilityByWorkspace),
    };
    if (shouldFollowSessionMutation && event.type !== "sessionClosed") {
      this.applyFastSessionSelection(event.sessionRef);
      if (!refreshedFollowedSession) {
        this.startSelectedSessionHydration(event.sessionRef);
      }
    }
    if (patch.shouldPersistTranscript) {
      this.persistTranscriptCacheForSession(event.sessionRef);
    }
    if (patch.shouldPersistUiImmediately) {
      await this.persistUiState();
    } else if (patch.shouldSchedulePersistUi) {
      this.schedulePersistUiState();
    }
    const shouldPublishFullState = !isStreamingSessionEvent(event);
    const snapshot = shouldPublishFullState ? this.emit() : this.state;
    this.publishStatePatchFor(event.sessionRef);
    this.publishTranscriptDeltaFor(event.sessionRef, { coalesce: isStreamingSessionEvent(event) });
    if (shouldPublishFullState) {
      this.publishSelectedTranscriptFor(event.sessionRef);
    }
    await this.emitSessionEvent(event, snapshot);
    return snapshot;
  }

  /** For events from unknown sessions, trigger a full catalog refresh. */
  private async refreshForUnknownSession(
    event: SessionDriverEvent,
    shouldFollowSessionMutation: boolean,
  ): Promise<boolean> {
    if (
      this.sessionFromState(event.sessionRef) ||
      this.refreshStateDepth !== 0 ||
      (event.type !== "sessionOpened" &&
        event.type !== "sessionUpdated" &&
        event.type !== "runCompleted" &&
        event.type !== "runFailed" &&
        event.type !== "hostUiRequest")
    ) {
      return false;
    }
    await this.refreshState({
      selectedWorkspaceId:
        this.state.selectedWorkspaceId === event.sessionRef.workspaceId
          ? event.sessionRef.workspaceId
          : this.state.selectedWorkspaceId,
      selectedSessionId: shouldFollowSessionMutation ? event.sessionRef.sessionId : this.state.selectedSessionId,
      clearLastError: true,
    });
    return shouldFollowSessionMutation;
  }

  private async handleSessionEvent(event: SessionDriverEvent, subscriptionKey = sessionKey(event.sessionRef)): Promise<void> {
    const key = sessionKey(event.sessionRef);
    if (subscriptionKey !== key) {
      this.migrateSessionSubscriptionKey(subscriptionKey, key);
    }

    // Live edit stats: start/stop file watching for write tool calls
    this.handleEditWatcherEvent(event);

    const shouldFollowSessionMutation = subscriptionKey !== key && this.currentSelectedSessionKey() === subscriptionKey;
    const refreshedFollowedSession = await this.refreshForUnknownSession(event, shouldFollowSessionMutation);
    await this.applySessionEventActions(event, key);
    const patch = this.desktopSessionState.consumeSessionDriverEvent(this.state, event, {
      sessionActivelyViewed: isSessionActivelyViewed(this.state, event.sessionRef, this.getWindow()),
    });
    await this.publishSessionEventResults(event, patch, shouldFollowSessionMutation, refreshedFollowedSession);
  }

  private handleEditWatcherEvent(event: SessionDriverEvent): void {
    if (event.type === "toolStarted") {
      if (/write|edit|patch|apply/i.test(event.toolName)) {
        const filePath = extractFilePathFromInput(event.input);
        if (filePath) {
          const workspaceRoot = this.getWorkspacePath(event.sessionRef.workspaceId);
          if (workspaceRoot) {
            this.editWatcher.start(event.callId, filePath, workspaceRoot);
          }
        }
      }
    } else if (event.type === "toolFinished") {
      this.editWatcher.stop(event.callId);
    }
  }

  workspaceRefFromState(workspaceId: string): WorkspaceRef | undefined {
    const ws = this.state.workspaces.find((entry) => entry.id === workspaceId);
    if (!ws) {
      return undefined;
    }

    return {
      workspaceId: ws.id,
      path: ws.path,
      displayName: ws.name,
    };
  }

  private resolveModelSettingsWorkspaceId(workspaceId: string): string {
    if (this.state.modelSettingsScopeMode !== "per-repo") {
      return workspaceId;
    }
    return resolveRepoWorkspaceId(this.state.workspaces, workspaceId) ?? workspaceId;
  }

  private async loadLiveGlobalModelSettings(
    workspaces: readonly { workspaceId: string; path: string; displayName: string }[],
    preferredWorkspaceId?: string,
  ): Promise<ModelSettingsSnapshot> {
    const fallbackWorkspace =
      (preferredWorkspaceId ? workspaces.find((entry) => entry.workspaceId === preferredWorkspaceId) : undefined) ?? workspaces[0];
    if (!fallbackWorkspace) {
      return this.state.globalModelSettings;
    }
    return this.driver.runtimeSupervisor.getGlobalModelSettings({
      workspaceId: fallbackWorkspace.workspaceId,
      path: fallbackWorkspace.path,
      displayName: fallbackWorkspace.displayName,
    });
  }

  async buildCreateSessionOptions(workspaceId: string): Promise<CreateSessionOptions | undefined> {
    if (this.state.modelSettingsScopeMode !== "per-repo") {
      return undefined;
    }
    const effectiveSettings = await this.loadEffectiveModelSettingsForWorkspace(workspaceId);
    if (!effectiveSettings) {
      return undefined;
    }
    return {
      ...(effectiveSettings.defaultProvider && effectiveSettings.defaultModelId
        ? { initialModel: { provider: effectiveSettings.defaultProvider, modelId: effectiveSettings.defaultModelId } }
        : {}),
      ...(effectiveSettings.defaultThinkingLevel ? { initialThinkingLevel: effectiveSettings.defaultThinkingLevel } : {}),
    };
  }

  private serializeRuntimeState(): Record<string, RuntimeSnapshot> {
    return mapToRecord(this.runtimeByWorkspace);
  }

  private async serializeRuntimeStateForCurrentWorkspaces(): Promise<Record<string, RuntimeSnapshot>> {
    const runtimeByWorkspace = this.serializeRuntimeState();
    if (this.state.modelSettingsScopeMode !== "per-repo") {
      return runtimeByWorkspace;
    }

    const workspaceRefs = this.state.workspaces.map((workspace) => ({
      workspaceId: workspace.id,
      path: workspace.path,
      displayName: workspace.name,
    }));
    const scopedModelSettingsByWorkspace = await this.loadScopedModelSettingsByWorkspace(
      this.state.workspaces,
      workspaceRefs,
      this.state.globalModelSettings,
    );
    return this.serializeEffectiveRuntimeState(this.state.workspaces, scopedModelSettingsByWorkspace);
  }

  private async loadScopedModelSettingsByWorkspace(
    workspaces: DesktopAppState["workspaces"],
    workspaceRefs: readonly { workspaceId: string; path: string; displayName: string }[],
    globalModelSettings: ModelSettingsSnapshot,
  ): Promise<Record<string, ModelSettingsSnapshot>> {
    const uniqueOwnerIds = [...new Set(workspaces.map((workspace) => resolveRepoWorkspaceId(workspaces, workspace.id) ?? workspace.id))];
    const refsByWorkspaceId = new Map(workspaceRefs.map((workspace) => [workspace.workspaceId, workspace] as const));
    const ownerSettings = await Promise.all(
      uniqueOwnerIds.map(async (workspaceId) => {
        const workspace = refsByWorkspaceId.get(workspaceId);
        if (!workspace) {
          return undefined;
        }
        return [
          workspaceId,
          mergeModelSettingsSnapshot(globalModelSettings, await readProjectModelSettingsFile(workspace.path)),
        ] as const;
      }),
    );

    return Object.fromEntries(ownerSettings.filter((entry): entry is readonly [string, ModelSettingsSnapshot] => Boolean(entry)));
  }

  private serializeEffectiveRuntimeState(
    workspaces: DesktopAppState["workspaces"],
    scopedModelSettingsByWorkspace?: Record<string, ModelSettingsSnapshot>,
  ): Record<string, RuntimeSnapshot> {
    const runtimeByWorkspace = this.serializeRuntimeState();
    if (this.state.modelSettingsScopeMode !== "per-repo") {
      return runtimeByWorkspace;
    }

    for (const workspace of workspaces) {
      const ownerWorkspaceId = resolveRepoWorkspaceId(workspaces, workspace.id);
      const workspaceRuntime = runtimeByWorkspace[workspace.id];
      const modelSettings = ownerWorkspaceId ? scopedModelSettingsByWorkspace?.[ownerWorkspaceId] : undefined;
      if (!workspaceRuntime || !modelSettings) {
        continue;
      }
      runtimeByWorkspace[workspace.id] = applyModelSettingsSnapshot(workspaceRuntime, modelSettings);
    }

    return runtimeByWorkspace;
  }

  private serializeSessionExtensionUiState() {
    return Object.fromEntries(
      [...this.sessionState.extensionUiBySession.entries()].map(([key, value]) => [key, serializeExtensionUiState(value)] as const),
    );
  }

  private syncDerivedSessionState(state: DesktopAppState, sessionRef: SessionRef): DesktopAppState {
    const key = sessionKey(sessionRef);
    const serializedExtensionUi = this.sessionState.extensionUiBySession.get(key);

    return {
      ...state,
      sessionCommandsBySession: updateRecordValue(
        state.sessionCommandsBySession,
        key,
        this.sessionState.sessionCommandsBySession.get(key),
      ),
      sessionExtensionUiBySession: updateRecordValue(
        state.sessionExtensionUiBySession,
        key,
        serializedExtensionUi ? serializeExtensionUiState(serializedExtensionUi) : undefined,
      ),
      extensionCommandCompatibilityByWorkspace: serializeCompatibilityByWorkspace(this.extensionCommandCompatibilityByWorkspace),
      lastViewedAtBySession: updateRecordValue(
        state.lastViewedAtBySession,
        key,
        this.sessionState.lastViewedAtBySession.get(key),
      ),
      queuedComposerMessages: this.resolveQueuedComposerMessages(state.selectedWorkspaceId, state.selectedSessionId),
      editingQueuedMessageId: this.resolveEditingQueuedMessageId(state.selectedWorkspaceId, state.selectedSessionId),
      lastError: this.resolveSelectedSessionError(state.selectedWorkspaceId, state.selectedSessionId, false),
    };
  }

  selectedSessionRef(): SessionRef | undefined {
    if (!this.state.selectedWorkspaceId || !this.state.selectedSessionId) {
      return undefined;
    }

    return toSessionRef({
      workspaceId: this.state.selectedWorkspaceId,
      sessionId: this.state.selectedSessionId,
    });
  }

  sessionFromState(sessionRef: SessionRef) {
    return this.state.workspaces
      .find((w) => w.id === sessionRef.workspaceId)
      ?.sessions.find((s) => s.id === sessionRef.sessionId);
  }

  private async loadEffectiveModelSettingsForWorkspace(workspaceId: string): Promise<ModelSettingsSnapshot | undefined> {
    const ownerWorkspaceId = this.resolveModelSettingsWorkspaceId(workspaceId);
    const ownerWorkspace = this.workspaceRefFromState(ownerWorkspaceId);
    if (!ownerWorkspace) {
      return undefined;
    }
    const globalModelSettings =
      this.state.modelSettingsScopeMode === "per-repo" && hasStoredModelSettings(this.state.globalModelSettings)
        ? this.state.globalModelSettings
        : await this.loadLiveGlobalModelSettings(
            this.state.workspaces.map((workspace) => ({
              workspaceId: workspace.id,
              path: workspace.path,
              displayName: workspace.name,
            })),
            ownerWorkspaceId,
          );
    return mergeModelSettingsSnapshot(globalModelSettings, await readProjectModelSettingsFile(ownerWorkspace.path));
  }

  private async restoreGlobalModelSettings(
    settings: ModelSettingsSnapshot,
    workspaces?: readonly { workspaceId: string; path: string; displayName: string }[],
    preferredWorkspaceId?: string,
  ): Promise<void> {
    if (!hasStoredModelSettings(settings)) {
      return;
    }
    const workspaceRefs =
      workspaces ??
      this.state.workspaces.map((workspace) => ({
        workspaceId: workspace.id,
        path: workspace.path,
        displayName: workspace.name,
      }));
    const fallbackWorkspace =
      (preferredWorkspaceId ? workspaceRefs.find((entry) => entry.workspaceId === preferredWorkspaceId) : undefined) ??
      workspaceRefs[0];
    if (!fallbackWorkspace) {
      return;
    }
    const workspaceRef = {
      workspaceId: fallbackWorkspace.workspaceId,
      path: fallbackWorkspace.path,
      displayName: fallbackWorkspace.displayName,
    };
    await this.driver.runtimeSupervisor.setScopedModelPatterns(workspaceRef, settings.enabledModelPatterns);
    if (settings.defaultThinkingLevel) {
      await this.driver.runtimeSupervisor.setDefaultThinkingLevel(workspaceRef, settings.defaultThinkingLevel);
    }
    if (settings.defaultProvider && settings.defaultModelId) {
      await this.driver.runtimeSupervisor.setDefaultModel(workspaceRef, {
        provider: settings.defaultProvider,
        modelId: settings.defaultModelId,
      });
    }
    if (this.runtimeByWorkspace.has(workspaceRef.workspaceId)) {
      this.runtimeByWorkspace.set(workspaceRef.workspaceId, await this.driver.runtimeSupervisor.refreshRuntime(workspaceRef));
    }
  }

  async startChat(input: StartChatInput): Promise<DesktopAppState> {
    return worktree.startChat(this, input);
  }

  // ── Plan orchestrator ─────────────────────────────────

  async selectChat(chatId: string): Promise<DesktopAppState> {
    await this.initialize();
    const chat = this.state.chats.find((c) => c.id === chatId);
    if (!chat) {
      return this.emit();
    }
    this.state = reduce(this.state, { type: "chats/select", chatId });

    return this.withErrorHandling(async () => {
      const workspace = await this.ensureChatWorkspace(chat);
      const synced = await this.driver.syncWorkspace(workspace.path, chat.title);
      let sessionId = synced.sessions[0]?.sessionRef.sessionId ?? "";
      if (!sessionId) {
        const createOptions = await this.buildCreateSessionOptions(workspace.workspaceId);
        const snapshot = await this.driver.createSession(synced.workspace, {
          ...createOptions,
          title: chat.title,
        });
        const key = sessionKey(snapshot.ref);
        this.sessionState.transcriptCache.set(key, []);
        this.sessionState.loadedTranscriptKeys.add(key);
        this.updateSessionConfig(snapshot.ref, snapshot.config);
        sessionId = snapshot.ref.sessionId;
      }
      return this.refreshState({
        selectedWorkspaceId: workspace.workspaceId,
        selectedSessionId: sessionId,
        composerDraft: "",
        clearLastError: true,
        activeView: "threads",
      });
    });
  }

  // A chat is a normal session rooted in its own directory. Ensure the chat
  // directory exists with our AGENTS.md and is synced as a driver workspace.
  // Stores the resolved workspace id on the chat record so it converges with
  // older chat records that predate this shape.
  async ensureChatWorkspace(chat: ChatRecord): Promise<WorkspaceRef> {
    const chatDir = this.getChatDir(chat.id);
    await this.ensureChatTemplateAgentsMd();
    await mkdir(chatDir, { recursive: true });
    try {
      await readFile(join(chatDir, "AGENTS.md"), "utf8");
    } catch {
      try {
        const template = await readFile(join(this.getChatsRootDir(), "_template", "AGENTS.md"), "utf8");
        await writeFile(join(chatDir, "AGENTS.md"), template, "utf8");
      } catch {
        await writeFile(join(chatDir, "AGENTS.md"), DEFAULT_CHAT_AGENTS_MD, "utf8");
      }
    }
    const synced = await this.driver.syncWorkspace(chatDir, chat.title);
    const workspaceId = synced.workspace.workspaceId;
    if (workspaceId !== chat.chatWorkspaceId) {
      this.state = {
        ...this.state,
        chats: this.state.chats.map((c) => (c.id === chat.id ? { ...c, chatWorkspaceId: workspaceId } : c)),
      };
    }
    return synced.workspace;
  }

  async archiveChat(chatId: string): Promise<DesktopAppState> {
    await this.initialize();
    this.state = reduce(this.state, {
      type: "chats/archive",
      chatId,
      archivedAt: new Date().toISOString(),
    });
    await this.persistUiState();
    this.emit();
    return this.getState();
  }

  async unarchiveChat(chatId: string): Promise<DesktopAppState> {
    await this.initialize();
    this.state = reduce(this.state, { type: "chats/unarchive", chatId });
    await this.persistUiState();
    this.emit();
    return this.getState();
  }

  async removeChat(chatId: string): Promise<DesktopAppState> {
    await this.initialize();
    const chat = this.state.chats.find((c) => c.id === chatId);
    if (chat?.chatWorkspaceId) {
      try {
        await this.driver.removeWorkspace(chat.chatWorkspaceId);
      } catch {
        // Best-effort: continue removing the chat record even if the driver
        // no longer knows about the workspace.
      }
    }
    this.state = reduce(this.state, { type: "chats/remove", chatId });
    await this.persistUiState();
    return this.refreshState({
      selectedWorkspaceId: this.state.selectedWorkspaceId,
      selectedSessionId: this.state.selectedSessionId,
      clearLastError: true,
    });
  }

  async renameChat(chatId: string, title: string): Promise<DesktopAppState> {
    await this.initialize();
    this.state = reduce(this.state, { type: "chats/rename", chatId, title });
    await this.persistUiState();
    this.emit();
    return this.getState();
  }

  private getChatsRootDir(): string {
    return join(dirname(this.uiStateFilePath), "chats");
  }

  private getChatDir(chatId: string): string {
    return join(this.getChatsRootDir(), chatId);
  }

  private async ensureChatTemplateAgentsMd(): Promise<void> {
    const templateDir = join(this.getChatsRootDir(), "_template");
    const templatePath = join(templateDir, "AGENTS.md");
    try {
      await readFile(templatePath, "utf8");
    } catch {
      await mkdir(templateDir, { recursive: true });
      await writeFile(templatePath, DEFAULT_CHAT_AGENTS_MD, "utf8");
    }
  }

  async getChatAgentsMd(chatId: string): Promise<string> {
    try {
      return await readFile(join(this.getChatDir(chatId), "AGENTS.md"), "utf8");
    } catch {
      return "";
    }
  }

  async writeChatAgentsMd(chatId: string, content: string): Promise<void> {
    const chatDir = this.getChatDir(chatId);
    await mkdir(chatDir, { recursive: true });
    await writeFile(join(chatDir, "AGENTS.md"), content, "utf8");
  }

  private async readUiState(): Promise<LegacyPersistedUiState> {
    return readPersistedUiState(this.uiStateFilePath);
  }

  async persistUiState(): Promise<void> {
    if (this.persistUiStateTimer) {
      clearTimeout(this.persistUiStateTimer);
      this.persistUiStateTimer = undefined;
    }
    const payload: PersistedUiState = {
      selectedWorkspaceId: this.state.selectedWorkspaceId || undefined,
      selectedSessionId: this.state.selectedSessionId || undefined,
      activeView: this.state.activeView,
      composerDraft: this.state.composerDraft || undefined,
      composerDraftsBySession: mapToRecord(this.sessionState.composerDraftsBySession),
      extensionCommandCompatibilityByWorkspace: serializeCompatibilityByWorkspace(this.extensionCommandCompatibilityByWorkspace),
      notificationPreferences: this.state.notificationPreferences,
      subagentSettings: this.state.subagentSettings,
      integratedTerminalShell: this.state.integratedTerminalShell || undefined,
      externalTerminalApp: this.state.externalTerminalApp || undefined,
      retrySettings: this.state.retrySettings,
      lastViewedAtBySession: mapToRecord(this.sessionState.lastViewedAtBySession),
      threadTypeBySession: Object.keys(this.state.threadTypeBySession).length > 0 ? this.state.threadTypeBySession : undefined,
      workspaceOrder: this.state.workspaceOrder.length > 0 ? this.state.workspaceOrder : undefined,
      modelSettingsScopeMode: this.state.modelSettingsScopeMode,
      appGlobalModelSettings: hasStoredModelSettings(this.state.globalModelSettings) ? this.state.globalModelSettings : undefined,
      sidebarCollapsed: this.state.sidebarCollapsed || undefined,
      zoomFactor: this.state.zoomFactor,
      transcriptVerbose: this.state.transcriptVerbose,
      composerDeviceMode: this.state.composerDeviceMode,
      streamReveal: this.state.streamReveal,
      streamRevealSpeed: this.state.streamRevealSpeed,
      threadTransition: this.state.threadTransition,
      themeMode: this.state.themeMode,
      chats: this.state.chats.length > 0 ? this.state.chats : undefined,
      selectedChatId: this.state.selectedChatId || undefined,
    };

    await writePersistedUiState(this.uiStateFilePath, payload);
  }

  async persistComposerAttachments(
    key: string,
    attachments: readonly ComposerAttachment[],
  ): Promise<void> {
    await this.attachmentStore.write(key, cloneComposerAttachments(attachments));
    await this.persistUiState();
  }

  persistTranscriptCacheForSession(sessionRef: SessionRef): void {
    const key = sessionKey(sessionRef);
    const existing = this.transcriptPersistTimers.get(key);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      this.transcriptPersistTimers.delete(key);
      // writePersistedTranscript clones internally before serializing.
      const transcript = this.sessionState.transcriptCache.get(key) ?? [];
      void this.writePersistedTranscript(key, transcript);
    }, 250);

    this.transcriptPersistTimers.set(key, timer);
  }

  private async readPersistedTranscript(
    key: string,
  ): Promise<
    | {
        readonly format: "versioned" | "legacy";
        readonly transcript: TranscriptMessage[];
      }
    | null
  > {
    const persisted = await this.transcriptStore.read(key);
    if (!persisted) {
      return null;
    }

    if (isPersistedTranscriptRecord(persisted)) {
      return {
        format: "versioned",
        transcript: persisted.transcript.map((item) => cloneTranscriptMessage(item as TranscriptMessage)),
      };
    }

    if (Array.isArray(persisted)) {
      return {
        format: "legacy",
        transcript: persisted.map((item) => cloneTranscriptMessage(item as TranscriptMessage)),
      };
    }

    return null;
  }

  private async resolveLoadedTranscript(
    sessionRef: SessionRef,
    persisted: {
      readonly format: "versioned" | "legacy";
      readonly transcript: TranscriptMessage[];
    },
  ): Promise<TranscriptMessage[]> {
    if (persisted.format !== "legacy" || !this.isPossiblyTrimmedLegacyTranscript(persisted.transcript)) {
      return persisted.transcript;
    }

    const driverTranscript = await this.driver.getTranscript(sessionRef);
    return shouldReplaceLegacyTranscript(persisted.transcript, driverTranscript) ? driverTranscript : persisted.transcript;
  }

  private isPossiblyTrimmedLegacyTranscript(transcript: readonly TranscriptMessage[]): boolean {
    return transcript.length === LEGACY_TRANSCRIPT_HISTORY_LIMIT;
  }

  private async writePersistedTranscript(key: string, transcript: readonly TranscriptMessage[]): Promise<void> {
    await this.transcriptStore.write(key, {
      version: 1,
      transcript: transcript.map(cloneTranscriptMessage),
    });
  }

  schedulePersistUiState(): void {
    if (this.persistUiStateTimer) {
      clearTimeout(this.persistUiStateTimer);
    }

    this.persistUiStateTimer = setTimeout(() => {
      this.persistUiStateTimer = undefined;
      void this.persistUiState();
    }, 250);
  }

  private currentSelectedSessionKey(): string {
    return this.state.selectedWorkspaceId && this.state.selectedSessionId
      ? sessionKey({
          workspaceId: this.state.selectedWorkspaceId,
          sessionId: this.state.selectedSessionId,
        })
      : "";
  }

  private isSelectedSession(sessionRef: SessionRef): boolean {
    const selected = this.selectedSessionRef();
    return Boolean(
      selected &&
      selected.workspaceId === sessionRef.workspaceId &&
      selected.sessionId === sessionRef.sessionId,
    );
  }

  private buildSelectedTranscriptRecord(sessionRef: SessionRef): SelectedTranscriptRecord {
    // No manual clone: Electron IPC structured-clones the payload when sending
    // to the renderer, so an extra in-process copy is pure waste. Listeners on
    // the main side treat the array as read-only.
    return this.desktopSessionState.buildSelectedTranscriptRecord(sessionRef);
  }

  emit(): DesktopAppState {
    const snapshot = this.state;
    for (const listener of this.listeners) {
      listener(snapshot);
    }
    return snapshot;
  }

  subscribeToTranscriptDelta(listener: TranscriptDeltaListener): () => void {
    this.transcriptDeltaListeners.add(listener);
    return () => {
      this.transcriptDeltaListeners.delete(listener);
    };
  }

  private publishTranscriptDeltaFor(sessionRef: SessionRef, options: { readonly coalesce?: boolean } = {}): void {
    if (!this.isSelectedSession(sessionRef)) {
      return;
    }
    const key = sessionKey(sessionRef);
    const fullTranscript = this.desktopSessionState.buildSelectedTranscriptRecord(sessionRef).transcript;
    const lastSent = this.transcriptLastSentCount.get(key) ?? 0;
    const isInitial = lastSent === 0;
    const newMessages = fullTranscript.slice(lastSent);
    const changedMessages = newMessages.length > 0 ? newMessages : fullTranscript.slice(-1);
    this.transcriptLastSentCount.set(key, fullTranscript.length);
    if (changedMessages.length === 0 && !isInitial) {
      return;
    }
    const delta = {
      sessionId: sessionRef.sessionId,
      workspaceId: sessionRef.workspaceId,
      initial: isInitial,
      messages: changedMessages,
    };
    this.publishTranscriptDelta(key, delta, options);
  }

  private publishTranscriptDelta(
    key: string,
    delta: TranscriptDeltaPayload,
    options: { readonly coalesce?: boolean } = {},
  ): void {
    if (!options.coalesce) {
      this.pendingTranscriptDeltaBySession.delete(key);
      this.sendTranscriptDelta(delta);
      return;
    }
    this.pendingTranscriptDeltaBySession.set(key, delta);
    if (this.transcriptDeltaFlushTimer) {
      return;
    }
    this.transcriptDeltaFlushTimer = setTimeout(() => {
      this.transcriptDeltaFlushTimer = undefined;
      const pending = [...this.pendingTranscriptDeltaBySession.values()];
      this.pendingTranscriptDeltaBySession.clear();
      for (const item of pending) {
        this.sendTranscriptDelta(item);
      }
    }, 250);
  }

  private sendTranscriptDelta(delta: TranscriptDeltaPayload): void {
    for (const listener of this.transcriptDeltaListeners) {
      listener(delta);
    }
  }

  publishStatePatchFor(sessionRef: SessionRef): void {
    const session = this.sessionFromState(sessionRef);
    const patch = {
      workspaceId: sessionRef.workspaceId,
      session: session ?? null,
    };
    for (const listener of this.statePatchListeners) {
      listener(patch);
    }
  }

  publishSelectedTranscript(): void {
    const sessionRef = this.selectedSessionRef();
    const payload = sessionRef ? this.buildSelectedTranscriptRecord(sessionRef) : null;
    for (const listener of this.selectedTranscriptListeners) {
      listener(payload);
    }
  }

  publishSelectedTranscriptFor(sessionRef: SessionRef): void {
    if (!this.isSelectedSession(sessionRef)) {
      return;
    }
    this.publishSelectedTranscript();
  }

  handleWindowActivation(): void {
    if (!this.markSelectedSessionViewedIfVisible()) {
      return;
    }

    this.schedulePersistUiState();
    this.emit();
  }

  private async emitSessionEvent(event: SessionDriverEvent, snapshot: DesktopAppState): Promise<void> {
    for (const listener of this.sessionEventListeners) {
      await listener(event, snapshot);
    }
  }

  async withError(error: unknown): Promise<DesktopAppState> {
    const message = error instanceof Error ? error.message : String(error);
    const sessionRef = this.selectedSessionRef();
    if (sessionRef) {
      this.sessionState.sessionErrorsBySession.set(sessionKey(sessionRef), message);
    }
    this.state = {
      ...this.state,
      lastError: message,
      revision: this.state.revision + 1,
    };
    await this.persistUiState();
    return this.emit();
  }

  async withErrorHandling(fn: () => Promise<DesktopAppState>): Promise<DesktopAppState> {
    try {
      return await fn();
    } catch (error) {
      return this.withError(error);
    }
  }

  private applyFastSessionSelection(sessionRef: SessionRef): DesktopAppState {
    this.restoredSelectedSessionKeysAwaitingSelection.delete(sessionKey(sessionRef));
    // Only clear transcriptLastSentCount when the transcript is NOT already
    // loaded. If it is loaded, hydration publishes via the selectedTranscript
    // channel and we must not reset the counter — otherwise the next
    // publishTranscriptDeltaFor sees lastSent=0 and re-sends every message as
    // an initial delta, which causes the renderer to re-type all thinking
    // blocks via the typewriter effect.
    if (!this.sessionState.loadedTranscriptKeys.has(sessionKey(sessionRef))) {
      this.transcriptLastSentCount.delete(sessionKey(sessionRef));
    }
    const nextState = reduce(this.state, {
      type: "selection/selectSession",
      workspaceId: sessionRef.workspaceId,
      sessionId: sessionRef.sessionId,
      composerDraft: this.resolveComposerDraft(sessionRef.workspaceId, sessionRef.sessionId),
      composerAttachments: this.resolveComposerAttachments(sessionRef.workspaceId, sessionRef.sessionId),
    });
    if (nextState === this.state) {
      return structuredClone(this.state);
    }
    this.state = nextState;
    this.markSessionViewed(sessionRef);
    this.schedulePersistUiState();
    const snapshot = this.emit();
    if (this.sessionState.loadedTranscriptKeys.has(sessionKey(sessionRef))) {
      this.publishSelectedTranscript();
    }
    return snapshot;
  }

  private async hydrateSelectedSessionAfterSelection(
    sessionRef: SessionRef,
    selectionEpoch: number,
    options: { readonly markViewed?: boolean } = {},
  ): Promise<void> {
    const runtimeMissing = !this.runtimeByWorkspace.has(sessionRef.workspaceId);
    const [snapshot] = await Promise.all([
      this.ensureSessionReady(sessionRef),
      this.ensureComposerAttachmentsLoaded(sessionRef),
      runtimeMissing ? this.ensureRuntimeLoaded(sessionRef.workspaceId) : Promise.resolve(),
    ]);

    if (!this.isCurrentSelectionEpoch(sessionRef, selectionEpoch)) {
      return;
    }

    const runtimeByWorkspace = runtimeMissing ? await this.serializeRuntimeStateForCurrentWorkspaces() : undefined;
    if (!this.isCurrentSelectionEpoch(sessionRef, selectionEpoch)) {
      return;
    }

    this.clearSessionError(sessionRef);
    this.state = this.syncSelectedSessionHydrationState(this.state, sessionRef, snapshot, runtimeByWorkspace);
    if (options.markViewed ?? true) {
      this.markSessionViewed(sessionRef);
    }
    this.schedulePersistUiState();
    this.emit();
    this.publishSelectedTranscriptFor(sessionRef);
  }

  private startSelectedSessionHydration(
    sessionRef: SessionRef | undefined,
    options: { readonly markViewed?: boolean } = {},
  ): void {
    if (!sessionRef) {
      return;
    }

    const selectionEpoch = ++this.selectionEpoch;
    void this.hydrateSelectedSessionAfterSelection(sessionRef, selectionEpoch, options).catch((error: unknown) => {
      void this.handleSelectedSessionHydrationError(sessionRef, selectionEpoch, error);
    });
  }

  private async handleSelectedSessionHydrationError(
    sessionRef: SessionRef,
    selectionEpoch: number,
    error: unknown,
  ): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    this.sessionState.sessionErrorsBySession.set(sessionKey(sessionRef), message);
    if (this.isCurrentSelectionEpoch(sessionRef, selectionEpoch)) {
      await this.withError(error);
      return;
    }

    this.schedulePersistUiState();
  }

  private isCurrentSelectionEpoch(sessionRef: SessionRef, selectionEpoch: number): boolean {
    return (
      selectionEpoch === this.selectionEpoch &&
      this.state.selectedWorkspaceId === sessionRef.workspaceId &&
      this.state.selectedSessionId === sessionRef.sessionId
    );
  }

  private markSelectedSessionViewedIfVisible(): boolean {
    if (this.state.activeView !== "threads" || !this.state.selectedWorkspaceId || !this.state.selectedSessionId) {
      return false;
    }

    const sessionRef = {
      workspaceId: this.state.selectedWorkspaceId,
      sessionId: this.state.selectedSessionId,
    } satisfies SessionRef;
    if (!isSessionActivelyViewed(this.state, sessionRef, this.getWindow())) {
      return false;
    }
    if (this.restoredSelectedSessionKeysAwaitingSelection.has(sessionKey(sessionRef))) {
      return false;
    }

    return this.markSessionViewed(sessionRef);
  }

  private markSessionViewedIfActivelyViewed(sessionRef: SessionRef): boolean {
    const active = isSessionActivelyViewed(this.state, sessionRef, this.getWindow());
    if (!active) {
      return false;
    }

    return this.markSessionViewed(sessionRef);
  }

  private markSessionViewed(sessionRef: SessionRef, fallbackViewedAt = new Date().toISOString()): boolean {
    const key = sessionKey(sessionRef);
    const viewedAt = this.resolveViewedAt(sessionRef, fallbackViewedAt);
    const current = this.sessionState.lastViewedAtBySession.get(key);
    if (current && current >= viewedAt) {
      return false;
    }

    this.sessionState.lastViewedAtBySession.set(key, viewedAt);
    this.state = {
      ...this.state,
      workspaces: this.state.workspaces.map((w) =>
        w.id === sessionRef.workspaceId
          ? {
              ...w,
              sessions: w.sessions.map((s) =>
                s.id === sessionRef.sessionId
                  ? {
                      ...s,
                      lastViewedAt: viewedAt,
                      hasUnseenUpdate: false,
                    }
                  : s,
              ),
            }
          : w,
      ),
      lastViewedAtBySession: mapToRecord(this.sessionState.lastViewedAtBySession),
    };
    return true;
  }

  private resolveViewedAt(sessionRef: SessionRef, fallbackViewedAt: string): string {
    const session = this.findSessionRecord(sessionRef);
    if (!session) {
      return fallbackViewedAt;
    }

    const activityAt = latestSessionActivityAt(
      session.updatedAt,
      this.sessionState.transcriptCache.get(sessionKey(sessionRef)) ?? [],
    );
    return activityAt > fallbackViewedAt ? activityAt : fallbackViewedAt;
  }

  private findSessionRecord(sessionRef: SessionRef) {
    return this.state.workspaces
      .find((workspace) => workspace.id === sessionRef.workspaceId)
      ?.sessions.find((session) => session.id === sessionRef.sessionId);
  }

  private clearSessionError(sessionRef: SessionRef): void {
    this.sessionState.sessionErrorsBySession.delete(sessionKey(sessionRef));
  }

  private resolveComposerDraft(
    selectedWorkspaceId: string,
    selectedSessionId: string,
    explicitDraft?: string,
  ): string {
    if (explicitDraft !== undefined) {
      if (selectedWorkspaceId && selectedSessionId) {
        const key = sessionKey({ workspaceId: selectedWorkspaceId, sessionId: selectedSessionId });
        if (explicitDraft) {
          this.sessionState.composerDraftsBySession.set(key, explicitDraft);
        } else {
          this.sessionState.composerDraftsBySession.delete(key);
        }
      }
      return explicitDraft;
    }

    if (!selectedWorkspaceId || !selectedSessionId) {
      return "";
    }

    return this.sessionState.composerDraftsBySession.get(sessionKey({ workspaceId: selectedWorkspaceId, sessionId: selectedSessionId })) ?? "";
  }

  private resolveComposerDraftSync(
    selectedWorkspaceId: string,
    selectedSessionId: string,
    options: RefreshStateOptions,
  ): {
    readonly source: ComposerDraftSyncSource;
    readonly nonce: number;
  } {
    if (options.composerDraftSyncSource) {
      return {
        source: options.composerDraftSyncSource,
        nonce: this.state.composerDraftSyncNonce + 1,
      };
    }

    if (
      selectedWorkspaceId !== this.state.selectedWorkspaceId ||
      selectedSessionId !== this.state.selectedSessionId
    ) {
      return {
        source: "selection",
        nonce: this.state.composerDraftSyncNonce + 1,
      };
    }

    return {
      source: this.state.composerDraftSyncSource,
      nonce: this.state.composerDraftSyncNonce,
    };
  }

  private resolveComposerAttachments(
    selectedWorkspaceId: string,
    selectedSessionId: string,
  ): readonly ComposerAttachment[] {
    if (!selectedWorkspaceId || !selectedSessionId) {
      return [];
    }

    return this.sessionState.composerAttachmentsBySession.get(
      sessionKey({ workspaceId: selectedWorkspaceId, sessionId: selectedSessionId }),
    )?.map(cloneComposerAttachment) ?? [];
  }

  private resolveQueuedComposerMessages(
    selectedWorkspaceId: string,
    selectedSessionId: string,
  ): readonly QueuedComposerMessage[] {
    if (!selectedWorkspaceId || !selectedSessionId) {
      return [];
    }

    return this.sessionState.queuedComposerMessagesBySession.get(
      sessionKey({ workspaceId: selectedWorkspaceId, sessionId: selectedSessionId }),
    )?.filter((message) => message.mode === "followUp")
      .map((message) => ({
        ...message,
        attachments: cloneComposerAttachments(message.attachments),
      })) ?? [];
  }

  private resolveEditingQueuedMessageId(
    selectedWorkspaceId: string,
    selectedSessionId: string,
  ): string | undefined {
    if (!selectedWorkspaceId || !selectedSessionId) {
      return undefined;
    }

    return this.sessionState.queuedComposerEditsBySession.get(
      sessionKey({ workspaceId: selectedWorkspaceId, sessionId: selectedSessionId }),
    )?.messageId;
  }

  private resolveSelectedSessionError(
    selectedWorkspaceId: string,
    selectedSessionId: string,
    clearLastError?: boolean,
  ): string | undefined {
    if (!selectedWorkspaceId || !selectedSessionId) {
      return undefined;
    }

    const key = sessionKey({ workspaceId: selectedWorkspaceId, sessionId: selectedSessionId });
    if (clearLastError) {
      this.sessionState.sessionErrorsBySession.delete(key);
      return undefined;
    }

    return this.sessionState.sessionErrorsBySession.get(key);
  }

  updateSessionConfig(sessionRef: SessionRef, config: SessionConfig | undefined): void {
    const key = sessionKey(sessionRef);
    if (config && Object.keys(config).length > 0) {
      this.sessionState.sessionConfigBySession.set(key, config);
    } else {
      this.sessionState.sessionConfigBySession.delete(key);
    }
  }

  updateQueuedComposerMessages(sessionRef: SessionRef, queuedMessages: readonly SessionQueuedMessage[] | undefined): void {
    const key = sessionKey(sessionRef);
    const next = mergeQueuedComposerMessages(this.sessionState.queuedComposerMessagesBySession.get(key), queuedMessages);
    if (next.length > 0) {
      this.sessionState.queuedComposerMessagesBySession.set(key, next);
    } else {
      this.sessionState.queuedComposerMessagesBySession.delete(key);
    }

    const editState = this.sessionState.queuedComposerEditsBySession.get(key);
    if (editState && !next.some((message) => message.id === editState.messageId)) {
      this.sessionState.queuedComposerEditsBySession.delete(key);
    }
  }

  getQueuedComposerMessages(sessionRef: SessionRef): readonly QueuedComposerMessage[] {
    return this.sessionState.queuedComposerMessagesBySession.get(sessionKey(sessionRef)) ?? [];
  }

  setQueuedComposerEditState(sessionRef: SessionRef, editState: QueuedComposerEditState | undefined): void {
    const key = sessionKey(sessionRef);
    if (editState) {
      this.sessionState.queuedComposerEditsBySession.set(key, editState);
    } else {
      this.sessionState.queuedComposerEditsBySession.delete(key);
    }
  }

  getQueuedComposerEditState(sessionRef: SessionRef): QueuedComposerEditState | undefined {
    return this.sessionState.queuedComposerEditsBySession.get(sessionKey(sessionRef));
  }

  private syncSelectedSessionHydrationState(
    state: DesktopAppState,
    sessionRef: SessionRef,
    snapshot?: SessionSnapshot,
    runtimeByWorkspace?: Record<string, RuntimeSnapshot>,
  ): DesktopAppState {
    const key = sessionKey(sessionRef);
    // Only used to compute a preview; no need to clone.
    const transcript = this.sessionState.transcriptCache.get(key) ?? [];
    const preview = previewFromTranscript(transcript);
    const lastViewedAt = this.sessionState.lastViewedAtBySession.get(key);
    const nextState = {
      ...state,
      ...(runtimeByWorkspace ? { runtimeByWorkspace } : {}),
      workspaces: state.workspaces.map((workspace) =>
        workspace.id === sessionRef.workspaceId
          ? {
              ...workspace,
              sessions: workspace.sessions.map((session) => {
                if (session.id !== sessionRef.sessionId) {
                  return session;
                }

                return updateSessionRecord(session, {
                  snapshot:
                    snapshot || this.sessionState.sessionConfigBySession.has(key)
                      ? {
                          ...snapshot,
                          config: this.sessionState.sessionConfigBySession.get(key) ?? snapshot?.config,
                        }
                      : undefined,
                  transcript,
                  preview,
                  runningSince: this.sessionState.runningSinceBySession.get(key),
                  lastViewedAt,
                });
              }),
            }
          : workspace,
      ),
      composerAttachments: this.resolveComposerAttachments(state.selectedWorkspaceId, state.selectedSessionId),
      lastError: undefined,
      revision: state.revision + 1,
    };

    return this.syncDerivedSessionState(nextState, sessionRef);
  }
  setPendingAutoTitle(sessionRef: SessionRef, pending: import("./session-state-map").PendingAutoTitle): void {
    this.clearPendingAutoTitle(sessionRef);
    this.sessionState.pendingAutoTitleBySession.set(sessionKey(sessionRef), pending);
  }

  getPendingAutoTitle(sessionRef: SessionRef): import("./session-state-map").PendingAutoTitle | undefined {
    return this.sessionState.pendingAutoTitleBySession.get(sessionKey(sessionRef));
  }

  clearPendingAutoTitle(sessionRef: SessionRef): void {
    const key = sessionKey(sessionRef);
    const pendingAutoTitle = this.sessionState.pendingAutoTitleBySession.get(key);
    if (!pendingAutoTitle) {
      return;
    }
    this.sessionState.pendingAutoTitleBySession.delete(key);
    pendingAutoTitle.cancel();
  }

  setThreadType(sessionId: string, type: string): void {
    console.log("[setThreadType] called", { sessionId, type, currentKeys: Object.keys(this.state.threadTypeBySession) });
    this.state = {
      ...this.state,
      threadTypeBySession: { ...this.state.threadTypeBySession, [sessionId]: type },
    };
    void this.persistUiState();
    void this.emit();
  }
}

/* ── Module-private free functions ───────────────────────── */

function updateRecordValue<T>(
  record: Readonly<Record<string, T>>,
  key: string,
  value: T | undefined,
): Readonly<Record<string, T>> {
  if (value === undefined) {
    if (!(key in record)) {
      return record;
    }

    const { [key]: _removed, ...rest } = record;
    return rest;
  }

  if (record[key] === value) {
    return record;
  }

  return {
    ...record,
    [key]: value,
  };
}

function applyModelSettingsSnapshot(
  runtime: RuntimeSnapshot,
  settings: ModelSettingsSnapshot,
): RuntimeSnapshot {
  return {
    ...runtime,
    settings: {
      ...runtime.settings,
      ...(settings.defaultProvider ? { defaultProvider: settings.defaultProvider } : { defaultProvider: undefined }),
      ...(settings.defaultModelId ? { defaultModelId: settings.defaultModelId } : { defaultModelId: undefined }),
      ...(settings.defaultThinkingLevel
        ? { defaultThinkingLevel: settings.defaultThinkingLevel }
        : { defaultThinkingLevel: undefined }),
      enabledModelPatterns: [...settings.enabledModelPatterns],
    },
  };
}

async function readProjectModelSettingsFile(workspacePath: string): Promise<Record<string, unknown>> {
  try {
    const raw = await readFile(join(workspacePath, ".pi", "settings.json"), "utf8");
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

async function updateProjectModelSettingsFile(
  workspacePath: string,
  updater: (settings: Record<string, unknown>) => Record<string, unknown>,
): Promise<void> {
  const current = await readProjectModelSettingsFile(workspacePath);
  const next = updater({ ...current });
  const configDir = join(workspacePath, ".pi");
  await mkdir(configDir, { recursive: true });
  await writeFile(join(configDir, "settings.json"), `${JSON.stringify(next, null, 2)}\n`, "utf8");
}

function mergeModelSettingsSnapshot(
  globalSettings: ModelSettingsSnapshot,
  projectSettings: Record<string, unknown>,
): ModelSettingsSnapshot {
  const defaultProvider =
    typeof projectSettings.defaultProvider === "string"
      ? projectSettings.defaultProvider
      : globalSettings.defaultProvider;
  const defaultModelId =
    typeof projectSettings.defaultModel === "string"
      ? projectSettings.defaultModel
      : globalSettings.defaultModelId;
  const defaultThinkingLevel =
    typeof projectSettings.defaultThinkingLevel === "string"
      ? (projectSettings.defaultThinkingLevel as RuntimeSettingsSnapshot["defaultThinkingLevel"])
      : globalSettings.defaultThinkingLevel;

  return {
    enabledModelPatterns: Array.isArray(projectSettings.enabledModels)
      ? projectSettings.enabledModels.filter((value): value is string => typeof value === "string")
      : [...globalSettings.enabledModelPatterns],
    ...(defaultProvider ? { defaultProvider } : {}),
    ...(defaultModelId ? { defaultModelId } : {}),
    ...(defaultThinkingLevel ? { defaultThinkingLevel } : {}),
  };
}

function hasStoredModelSettings(settings: ModelSettingsSnapshot | undefined): settings is ModelSettingsSnapshot {
  return Boolean(
    settings &&
      (settings.enabledModelPatterns.length > 0 ||
        settings.defaultProvider ||
        settings.defaultModelId ||
        settings.defaultThinkingLevel),
  );
}

function modelSettingsEqual(left: ModelSettingsSnapshot, right: ModelSettingsSnapshot): boolean {
  return (
    left.defaultProvider === right.defaultProvider &&
    left.defaultModelId === right.defaultModelId &&
    left.defaultThinkingLevel === right.defaultThinkingLevel &&
    left.enabledModelPatterns.length === right.enabledModelPatterns.length &&
    left.enabledModelPatterns.every((pattern, index) => pattern === right.enabledModelPatterns[index])
  );
}

function mergeEnabledModelPatterns(
  existingPatterns: readonly string[],
  providerPatterns: readonly string[],
): readonly string[] {
  const merged = [...existingPatterns];
  const seen = new Set(existingPatterns);
  for (const pattern of providerPatterns) {
    if (seen.has(pattern)) {
      continue;
    }
    seen.add(pattern);
    merged.push(pattern);
  }
  return merged;
}

function formatCapabilityLabel(capability: string): string {
  switch (capability) {
    case "custom":
      return "custom UI";
    case "onTerminalInput":
      return "terminal input";
    case "setEditorComponent":
      return "custom editor UI";
    case "setFooter":
      return "footer UI";
    case "setHeader":
      return "header UI";
    default:
      return capability.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  }
}

function resolveSelectedWorkspaceIdFromCatalog(
  preferredWorkspaceId: string,
  workspaces: readonly { workspaceId: string }[],
): string {
  if (preferredWorkspaceId && workspaces.some((w) => w.workspaceId === preferredWorkspaceId)) {
    return preferredWorkspaceId;
  }
  return workspaces[0]?.workspaceId ?? "";
}

function shouldReplaceLegacyTranscript(
  legacyTranscript: readonly TranscriptMessage[],
  driverTranscript: readonly TranscriptMessageRow[],
): boolean {
  if (driverTranscript.length === 0) {
    return false;
  }

  const legacyMessages = legacyTranscript.filter(isTranscriptMessageRow);
  if (driverTranscript.length > legacyMessages.length) {
    return true;
  }
  if (driverTranscript.length < legacyMessages.length) {
    return false;
  }

  return !sameTranscriptMessage(legacyMessages[0], driverTranscript[0]) ||
    !sameTranscriptMessage(legacyMessages.at(-1), driverTranscript.at(-1));
}

function isTranscriptMessageRow(item: TranscriptMessage): item is TranscriptMessageRow {
  return item.kind === "message";
}

function extractSearchableText(msg: TranscriptMessage): string {
  switch (msg.kind) {
    case "message":
      return msg.text ?? "";
    case "activity":
      return [msg.label, msg.detail].filter(Boolean).join(" ");
    case "tool":
      return [msg.label, msg.detail].filter(Boolean).join(" ");
    case "summary":
      return msg.label ?? "";
    case "reasoning":
      return msg.text ?? "";
    default:
      return "";
  }
}

function sameTranscriptMessage(
  left: TranscriptMessageRow | undefined,
  right: TranscriptMessageRow | undefined,
): boolean {
  if (!left || !right) {
    return left === right;
  }

  return left.id === right.id &&
    left.role === right.role &&
    left.text === right.text &&
    left.createdAt === right.createdAt;
}

function resolveSelectedSessionIdFromCatalog(
  workspaceId: string,
  preferredSessionId: string,
  sessions: readonly SessionCatalogEntry[],
): string {
  const workspaceSessions = sessions.filter((session) => session.workspaceId === workspaceId);
  if (!workspaceSessions.length) {
    return "";
  }
  if (
    preferredSessionId &&
    workspaceSessions.some((session) => session.sessionRef.sessionId === preferredSessionId)
  ) {
    return preferredSessionId;
  }
  return workspaceSessions[0]?.sessionRef.sessionId ?? "";
}

/**
 * Find the next queued session: the oldest (by updatedAt) session with
 * hasUnseenUpdate that is not archived. Optionally exclude a specific
 * session (e.g. the one just submitted).
 */
function findNextQueuedSession(
  state: DesktopAppState,
  excludeWorkspaceId?: string,
  excludeSessionId?: string,
): { readonly workspaceId: string; readonly sessionId: string } | undefined {
  const candidates: { workspaceId: string; session: SessionRecord }[] = [];
  for (const workspace of state.workspaces) {
    for (const session of workspace.sessions) {
      if (session.archivedAt || !session.hasUnseenUpdate) {
        continue;
      }
      if (workspace.id === excludeWorkspaceId && session.id === excludeSessionId) {
        continue;
      }
      candidates.push({ workspaceId: workspace.id, session });
    }
  }
  // Sort by updatedAt ascending (oldest first)
  candidates.sort((a, b) => a.session.updatedAt.localeCompare(b.session.updatedAt));
  const next = candidates[0];
  return next ? { workspaceId: next.workspaceId, sessionId: next.session.id } : undefined;
}

function extractFilePathFromInput(input: unknown): string | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const record = input as Record<string, unknown>;
  const path = record.file_path ?? record.filePath ?? record.path ?? record.filename;
  return typeof path === "string" ? path : undefined;
}

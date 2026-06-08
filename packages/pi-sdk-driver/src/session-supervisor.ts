import { access, readFile, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import {
  DefaultResourceLoader,
  getAgentDir,
  ModelRegistry,
  SessionManager,
  type AgentSessionRuntime,
  type AgentSession,
  type AgentSessionEvent,
  type CreateAgentSessionOptions,
  type ExtensionCommandContextActions,
  type ExtensionUIDialogOptions,
  type ExtensionUIContext,
  type ExtensionWidgetOptions,
  type SessionInfo,
} from "@earendil-works/pi-coding-agent";
import type { SessionCatalogSnapshot, WorkspaceCatalogSnapshot } from "@pi-gui/catalogs";
import type {
  NavigateSessionTreeOptions,
  NavigateSessionTreeResult,
  SessionMessageInput,
  SessionQueuedMessage,
  SessionTreeNodeSnapshot,
  SessionTreeSnapshot,
} from "@pi-gui/session-driver/types";
import type {
  CreateSessionOptions,
  HostUiRequest,
  HostUiResponse,
  HostUiQuestionnaireQuestion,
  SessionDriverEvent,
  SessionEventListener,
  SessionModelSelection,
  SessionRef,
  SessionSnapshot,
  Unsubscribe,
  WorkspaceId,
  WorkspaceRef,
} from "@pi-gui/session-driver";
import type { RuntimeCommandRecord } from "@pi-gui/session-driver/runtime-types";
import { JsonCatalogStore, type SessionFileCatalogStorage } from "./json-catalog-store.js";
import {
  applyHostUiRequestToExtensionUiState,
} from "./extension-ui-state.js";
import {
  createUnsupportedHostUiError,
  parseUnsupportedHostUiErrorMessage,
} from "./unsupported-host-ui.js";
import { normalizeRuntimeCommandName, skillCommandName } from "./runtime-command-utils.js";
import {
  buildSnapshot,
  collectLoopIterations,
  entriesEditedRalphPlan,
  createWorkspaceRef,
  deriveSessionConfig,
  deriveWorkspaceTitle,
  determineRunOutcome,
  extractPreview,
  forcePersistSession,
  nowIso,
  previewFromSessionInfo,
  sessionKey,
  titleFromSessionInfo,
  toSessionErrorInfo,
  transcriptFromMessages,
  truncate,
} from "./session-supervisor-utils.js";
import type { LoopIterationTranscript, SessionTranscriptMessage } from "./transcript.js";
import { createAgentSessionRuntimeWithNpmFallback } from "./npm-package-fallback.js";
import {
  cloneQueuedMessage,
  deliverQueuedMessage,
  deliverQueuedPrompt,
  promptTextForQueuedDelivery,
  queuedMessageFromInput,
  queuedPromptImagesFromAttachments,
  reconcileQueuedMessagesForStartedUserMessage as reconcileQueuedMessagesForStartedUserMessageCore,
} from "./queued-message-delivery.js";
import {
  SessionRuntimeRegistry,
  type ManagedSessionRecord,
} from "./session-runtime-registry.js";
import { createQuestionnaireTool } from "./questionnaire-tool.js";

export interface PiSdkDriverOptions {
  readonly catalogFilePath?: string;
  readonly createAgentSessionRuntimeImpl?: (options?: CreateAgentSessionOptions) => Promise<AgentSessionRuntime>;
  readonly modelRegistry?: ModelRegistry;
  readonly generateThreadTitleOverride?: (
    workspace: WorkspaceRef,
    options: import("./thread-title-generator.js").GenerateThreadTitleOptions,
  ) => Promise<string | null | undefined>;
}

async function buildGraphifyAppendSystemPrompt(workspacePath: string): Promise<string | undefined> {
  const graphPath = resolve(workspacePath, "graphify-out", "graph.json");
  const reportPath = resolve(workspacePath, "graphify-out", "GRAPH_REPORT.md");
  try {
    await access(graphPath);
  } catch {
    return undefined;
  }

  const report = await readFile(reportPath, "utf8").catch(() => "");
  const builtCommit = report.match(/Built from commit:\s*`?([a-f0-9]{7,40})`?/i)?.[1];
  const communities = extractGraphifyCommunityNames(report).slice(0, 8);
  return [
    "# Graphify Project Map",
    "",
    "This workspace has `graphify-out/graph.json`. For natural-language questions about architecture, ownership, file relationships, codebase concepts, or where something fits, use Graphify before grep/search.",
    "",
    "Preferred routing:",
    "- Use `graphify_query` for broad architecture/codebase questions.",
    "- Use `graphify_explain` for a named concept or community.",
    "- Use `graphify_path` to trace connections between two concepts.",
    "- Use Cymbal for exact symbols, refs, impact, implementations, and targeted source reads.",
    "- Use grep/rg for exact strings, config values, logs, or non-code text.",
    "",
    "Fast path: if the user asks how the codebase works and does not explicitly ask to rebuild/update, query the existing graph first. Do not redetect or rebuild before answering.",
    "",
    builtCommit ? `Graph built from commit: ${builtCommit}` : undefined,
    communities.length ? `Top graph communities: ${communities.join(", ")}` : undefined,
    "If current source changes matter, check graph freshness and run `graphify_update` before relying on the graph.",
  ].filter(Boolean).join("\n");
}

function extractGraphifyCommunityNames(report: string): string[] {
  const names: string[] = [];
  for (const line of report.split(/\r?\n/)) {
    const match = line.match(/^- \[\[_COMMUNITY_([^\]|]+)(?:\|([^\]]+))?\]\]/);
    if (match?.[1]) {
      names.push((match[2] || match[1]).trim());
    }
  }
  return names;
}

export interface SyncWorkspaceResult {
  readonly workspace: WorkspaceRef;
  readonly sessions: SessionCatalogSnapshot["sessions"];
}

interface RegisteredCommandAdapter {
  readonly name: string;
  readonly invocationName?: string;
  readonly description?: string;
  readonly sourceInfo?: RuntimeCommandRecord["sourceInfo"];
  readonly extensionPath?: string;
}

interface PromptTemplateAdapter {
  readonly name: string;
  readonly description?: string;
  readonly sourceInfo?: RuntimeCommandRecord["sourceInfo"];
  readonly filePath?: string;
}

const NEW_THREAD_PLACEHOLDER_TITLE = "New thread";

interface SkillAdapter {
  readonly name: string;
  readonly description: string;
  readonly sourceInfo?: RuntimeCommandRecord["sourceInfo"];
  readonly filePath?: string;
  readonly source?: string;
}

export class SessionSupervisor {
  private readonly catalogs: SessionFileCatalogStorage;
  private readonly createAgentSessionRuntimeImpl: (options?: CreateAgentSessionOptions) => Promise<AgentSessionRuntime>;
  private readonly modelRegistry: ModelRegistry | undefined;
  private readonly registry: SessionRuntimeRegistry;
  constructor(options: PiSdkDriverOptions = {}) {
    this.catalogs = options.catalogFilePath
      ? new JsonCatalogStore({ catalogFilePath: options.catalogFilePath })
      : new JsonCatalogStore();
    this.createAgentSessionRuntimeImpl =
      options.createAgentSessionRuntimeImpl ?? ((createOptions) => createAgentSessionRuntimeWithNpmFallback(createOptions));
    this.modelRegistry = options.modelRegistry;
    this.registry = new SessionRuntimeRegistry({
      runtimeFactory: this.createAgentSessionRuntimeImpl,
      modelRegistry: options.modelRegistry,
      catalogs: this.catalogs,
    });
  }

  listWorkspaces(): Promise<WorkspaceCatalogSnapshot> {
    return this.catalogs.workspaces.listWorkspaces();
  }

  listSessions(workspaceId?: WorkspaceId): Promise<SessionCatalogSnapshot> {
    return this.catalogs.sessions.listSessions(workspaceId);
  }

  async registerWorkspace(path: string, displayName?: string): Promise<WorkspaceRef> {
    const workspace = await createCanonicalWorkspaceRef(path, displayName);
    await this.touchWorkspace(workspace);
    return workspace;
  }

  async syncWorkspace(path: string, displayName?: string): Promise<SyncWorkspaceResult> {
    const workspace = await this.registerWorkspace(path, displayName);
    const infos = (await Promise.all(
      (await SessionManager.list(path)).map(async (info) =>
        (await isSubagentChildSession(info.path)) ? undefined : info,
      ),
    )).filter((info): info is SessionInfo => Boolean(info));
    const existingSessions = (await this.catalogs.sessions.listSessions(workspace.workspaceId)).sessions;
    const existingByKey = new Map(existingSessions.map((session) => [sessionKey(session.sessionRef), session]));
    const nextEntries = infos.map((info) =>
      this.sessionEntryFromInfo(
        workspace,
        info,
        this.registry.getRecord({ workspaceId: workspace.workspaceId, sessionId: info.id }),
        existingByKey.get(sessionKey({ workspaceId: workspace.workspaceId, sessionId: info.id })),
      ),
    );
    const discoveredKeys = new Set(nextEntries.map((entry) => sessionKey(entry.sessionRef)));
    const preservedEntries = (
      await Promise.all(
        existingSessions.map(async (session) => {
          const key = sessionKey(session.sessionRef);
          if (discoveredKeys.has(key) || !session.sessionFilePath) {
            return undefined;
          }

          try {
            if (await isSubagentChildSession(session.sessionFilePath)) {
              return undefined;
            }
            await access(session.sessionFilePath);
            return session;
          } catch {
            return undefined;
          }
        }),
      )
    ).filter((session): session is (typeof existingSessions)[number] => Boolean(session));
    const preservedKeys = new Set(preservedEntries.map((entry) => sessionKey(entry.sessionRef)));
    const mergedEntries = [...nextEntries, ...preservedEntries];
    const nextSessionFiles = Object.fromEntries([
      ...nextEntries.map((entry, index) => [sessionKey(entry.sessionRef), infos[index]?.path ?? ""]),
      ...preservedEntries.map((entry) => [sessionKey(entry.sessionRef), entry.sessionFilePath ?? ""]),
    ]);

    await this.catalogs.replaceWorkspaceSessions(workspace.workspaceId, mergedEntries, nextSessionFiles);
    for (const session of existingSessions) {
      const key = sessionKey(session.sessionRef);
      if (discoveredKeys.has(key) || preservedKeys.has(key)) {
        continue;
      }

      await this.catalogs.sessions.deleteSession(session.sessionRef);
      await this.cleanupRecord(session.sessionRef);
    }

    return {
      workspace,
      sessions: (await this.catalogs.sessions.listSessions(workspace.workspaceId)).sessions,
    };
  }

  async renameWorkspace(workspaceId: WorkspaceId, displayName: string): Promise<void> {
    const existing = await this.catalogs.workspaces.getWorkspace(workspaceId);
    if (!existing) {
      throw new Error(`Unknown workspace: ${workspaceId}`);
    }

    const nextWorkspace = await createCanonicalWorkspaceRef(existing.path, displayName.trim() || undefined);
    await this.touchWorkspace(nextWorkspace);

    for (const record of this.registry.getRecordsForWorkspace(workspaceId)) {
      record.workspace = nextWorkspace;
    }
  }

  async removeWorkspace(workspaceId: WorkspaceId): Promise<void> {
    const sessions = (await this.catalogs.sessions.listSessions(workspaceId)).sessions;
    await this.catalogs.workspaces.deleteWorkspace(workspaceId);

    for (const session of sessions) {
      await this.cleanupRecord(session.sessionRef);
    }
  }

  async getTranscript(sessionRef: SessionRef): Promise<SessionTranscriptMessage[]> {
    const record = await this.ensureRecord(sessionRef);
    return transcriptFromMessages(record.session?.messages ?? [], record.updatedAt);
  }

  /**
   * Read raw session entries from an arbitrary `.jsonl` file on disk. Used by
   * the desktop subagent panel to render a read-only timeline for a child
   * subagent session that this supervisor does not manage as a runtime.
   */
  readSessionFileEntries(sessionFilePath: string): unknown[] {
    return SessionManager.open(sessionFilePath).getEntries() as unknown[];
  }

  /**
   * Reconstruct a loop's iterations from the active session's `parentSession`
   * ancestry chain. Returns `null` when the active session is not a loop
   * iteration (no `ralph_loop` marker), so callers can fall back to a plain
   * transcript. Otherwise returns the iterations root-first, with the live
   * session last. Each prior iteration is read from its persisted session file;
   * the live iteration uses in-memory messages so streaming stays current.
   */
  async getLoopIterations(sessionRef: SessionRef): Promise<LoopIterationTranscript[] | null> {
    const record = await this.ensureRecord(sessionRef);
    const session = record.session;
    if (!session) {
      return null;
    }
    const infos = await SessionManager.list(record.workspace.path);
    return collectLoopIterations({
      leafEntries: session.sessionManager.getEntries(),
      leafSessionId: session.sessionId,
      leafMessages: session.messages ?? [],
      leafUpdatedAt: record.updatedAt,
      leafSessionFile: record.sessionFile,
      sessions: infos.map((info) => ({
        path: info.path,
        id: info.id,
        parentSessionPath: info.parentSessionPath,
        modifiedIso: info.modified.toISOString(),
      })),
      readEntries: (path) => SessionManager.open(path).getEntries(),
    });
  }

  /**
   * Whether this session is the chat where a Ralph plan was written, i.e. its
   * entries contain a tool call touching the `.ralph/` bundle. Used to scope
   * the "Begin Ralph loop" banner to the creating chat rather than every chat
   * in a workspace that happens to have a `.ralph/` plan on disk.
   */
  async sessionEditedRalphPlan(sessionRef: SessionRef): Promise<boolean> {
    const record = await this.ensureRecord(sessionRef);
    const entries = record.session
      ? record.session.sessionManager.getEntries()
      : record.sessionFile
        ? SessionManager.open(record.sessionFile).getEntries()
        : [];
    return entriesEditedRalphPlan(entries);
  }

  async getSessionCommands(sessionRef: SessionRef): Promise<readonly RuntimeCommandRecord[]> {
    const record = await this.ensureRecord(sessionRef);
    return record.sessionCommands;
  }

  async respondToHostUiRequest(sessionRef: SessionRef, response: HostUiResponse): Promise<void> {
    const record = await this.ensureRecord(sessionRef);
    const pending = record.pendingHostUiRequests.get(response.requestId);
    if (!pending) {
      return;
    }

    record.pendingHostUiRequests.delete(response.requestId);
    pending.resolve(response);
  }

  async createSession(workspace: WorkspaceRef, options?: CreateSessionOptions): Promise<SessionSnapshot> {
    await this.touchWorkspace(workspace);

    const initialModel = options?.initialModel
      ? this.resolveModel(options.initialModel.provider, options.initialModel.modelId)
      : undefined;
    const graphifyPrompt = await buildGraphifyAppendSystemPrompt(workspace.path);
    const resourceLoader = graphifyPrompt
      ? new DefaultResourceLoader({
          cwd: workspace.path,
          agentDir: getAgentDir(),
          appendSystemPrompt: [graphifyPrompt],
        })
      : undefined;
    if (resourceLoader) {
      await resourceLoader.reload();
    }
    const createOptions: CreateAgentSessionOptions = {
      cwd: workspace.path,
      sessionManager: SessionManager.create(workspace.path),
      customTools: [createQuestionnaireTool()],
      ...(resourceLoader ? { resourceLoader } : {}),
      ...(this.modelRegistry ? { modelRegistry: this.modelRegistry } : {}),
    };
    if (initialModel) {
      createOptions.model = initialModel;
    }
    if (options?.initialThinkingLevel) {
      createOptions.thinkingLevel = options.initialThinkingLevel as NonNullable<CreateAgentSessionOptions["thinkingLevel"]>;
    }

    const runtime = await this.createAgentSessionRuntimeImpl(createOptions);
    const session = runtime.session;

    const record = this.registry.createRecord(workspace, runtime, options?.title ?? deriveWorkspaceTitle(workspace));
    session.sessionManager.appendSessionInfo(record.title);
    forcePersistSession(session.sessionManager);
    record.config = deriveSessionConfig(session.sessionManager);
    const sessionFile = record.sessionFile ?? session.sessionManager.getSessionFile();
    if (sessionFile) {
      record.sessionFile = sessionFile;
      await this.catalogs.setSessionFile(record.ref, sessionFile);
    }

    this.registry.registerRecord(record);
    await this.bindSessionRuntime(record);
    await this.persistSnapshot(record);
    const snapshot = this.registry.snapshotForRecord(record);
    await this.emit(record, {
      type: "sessionOpened",
      sessionRef: record.ref,
      timestamp: nowIso(),
      snapshot,
    });
    return snapshot;
  }

  async openSession(sessionRef: SessionRef): Promise<SessionSnapshot> {
    const record = await this.ensureRecord(sessionRef);
    await this.touchWorkspace(record.workspace);
    const snapshot = this.registry.snapshotForRecord(record);
    await this.emit(record, {
      type: "sessionOpened",
      sessionRef: record.ref,
      timestamp: nowIso(),
      snapshot,
    });
    return snapshot;
  }

  async archiveSession(sessionRef: SessionRef): Promise<void> {
    await this.updateArchivedState(sessionRef, nowIso());
  }

  async unarchiveSession(sessionRef: SessionRef): Promise<void> {
    await this.updateArchivedState(sessionRef, undefined);
  }

  async sendUserMessage(sessionRef: SessionRef, input: SessionMessageInput): Promise<void> {
    const record = await this.ensureRecord(sessionRef);
    const session = this.requireSession(record);
    const isExtensionCommand = this.isExtensionCommand(session, input.text);
    if (session.isStreaming && !isExtensionCommand && !input.deliverAs) {
      throw new Error("Session is already streaming. Specify deliverAs ('steer' or 'followUp') to queue the message.");
    }

    const isQueuedMessage = session.isStreaming && !isExtensionCommand && Boolean(input.deliverAs);
    const runId = isQueuedMessage || isExtensionCommand ? undefined : crypto.randomUUID();
    record.runningRunId = runId ?? record.runningRunId;
    record.status = isQueuedMessage || isExtensionCommand ? record.status : "running";
    record.updatedAt = nowIso();
    record.config = deriveSessionConfig(session.sessionManager);
    record.preview = truncate(input.text);
    if (isQueuedMessage) {
      record.queuedMessages = [
        ...record.queuedMessages,
        queuedMessageFromInput(input, record.updatedAt),
      ];
    }
    await this.persistSnapshot(record);
    await this.emit(record, sessionUpdatedEvent(record, this.registry));

    try {
      const images = queuedPromptImagesFromAttachments(input.attachments);
      const promptText = promptTextForQueuedDelivery(input.text, input.attachments);
      if (isQueuedMessage) {
        await deliverQueuedPrompt(session, promptText, input.deliverAs!, images);
      } else {
        const previousTools = input.mode === "plan" ? session.getActiveToolNames() : undefined;
        if (input.mode === "plan") {
          session.setActiveToolsByName(["read", "grep", "find", "ls", "questionnaire"]);
        }
        try {
          await session.prompt(promptText, {
            ...(images && images.length > 0 ? { images } : {}),
            source: "interactive",
          });
        } finally {
          if (previousTools) {
            session.setActiveToolsByName(previousTools);
          }
        }
      }

      if (!isQueuedMessage) {
        await this.syncRecordAfterSessionMutation(record, { emitUpdate: true });
      }
    } catch (error) {
      if (isQueuedMessage) {
        record.queuedMessages = record.queuedMessages.slice(0, -1);
      }
      if (!isQueuedMessage) {
        record.runningRunId = undefined;
      }
      record.status = isQueuedMessage ? "running" : isExtensionCommand ? "idle" : "failed";
      record.updatedAt = nowIso();
      record.preview = error instanceof Error ? error.message : String(error);
      await this.persistSnapshot(record);
      await this.emit(record, {
        type: "runFailed",
        sessionRef: record.ref,
        timestamp: nowIso(),
        error: toSessionErrorInfo(error, "SEND_FAILED"),
        ...(runId ? { runId } : {}),
      });
      await this.emit(record, sessionUpdatedEvent(record, this.registry));
      throw error;
    }
  }

  async replaceQueuedMessages(sessionRef: SessionRef, messages: readonly SessionQueuedMessage[]): Promise<void> {
    const record = await this.ensureRecord(sessionRef);
    const session = this.requireSession(record);
    session.clearQueue();

    record.queuedMessages = messages.map((message) => cloneQueuedMessage(message));
    for (const message of record.queuedMessages) {
      await deliverQueuedMessage(session, message);
    }

    record.updatedAt = nowIso();
    await this.persistSnapshot(record);
    await this.emit(record, sessionUpdatedEvent(record, this.registry));
  }

  async cancelCurrentRun(sessionRef: SessionRef): Promise<void> {
    const record = this.registry.getRecord(sessionRef);
    if (!record?.session) {
      return;
    }

    await record.session.abort();
    record.runningRunId = undefined;
    record.status = "idle";
    await this.persistSnapshot(record);
    await this.emit(record, sessionUpdatedEvent(record, this.registry));
  }

  async setSessionModel(sessionRef: SessionRef, selection: SessionModelSelection): Promise<void> {
    const record = await this.ensureRecord(sessionRef);
    const session = record.session;
    if (!session) {
      throw new Error(`Session ${sessionKey(record.ref)} is not active.`);
    }

    const model = this.resolveModel(selection.provider, selection.modelId);
    const auth = await session.modelRegistry.getApiKeyAndHeaders(model);
    if (!auth.ok) {
      throw new Error(auth.error);
    }

    const previousModel = session.model;
    const previousThinkingLevel = session.supportsThinking()
      ? session.thinkingLevel
      : (session.settingsManager.getDefaultThinkingLevel() ?? DEFAULT_SESSION_THINKING_LEVEL);

    session.agent.state.model = model;
    session.sessionManager.appendModelChange(model.provider, model.id);
    this.applySessionThinkingLevel(session, previousThinkingLevel);
    await this.emitModelSelection(session, model, previousModel);
    forcePersistSession(session.sessionManager);
    record.config = deriveSessionConfig(session.sessionManager);
    await this.persistSnapshot(record);
    await this.emit(record, sessionUpdatedEvent(record, this.registry));
  }

  async setSessionThinkingLevel(sessionRef: SessionRef, thinkingLevel: string): Promise<void> {
    const record = await this.ensureRecord(sessionRef);
    const session = this.requireSession(record);
    this.applySessionThinkingLevel(session, thinkingLevel);
    forcePersistSession(session.sessionManager);
    record.config = deriveSessionConfig(session.sessionManager);
    await this.persistSnapshot(record);
    await this.emit(record, sessionUpdatedEvent(record, this.registry));
  }

  async renameSession(sessionRef: SessionRef, title: string): Promise<void> {
    const record = await this.ensureRecord(sessionRef);
    const nextTitle = title.trim();
    if (!nextTitle) {
      throw new Error("Session title cannot be empty.");
    }

    const sessionManager = this.getWritableSessionManager(record);
    sessionManager.appendSessionInfo(nextTitle);
    forcePersistSession(sessionManager);
    record.title = nextTitle;
    await this.persistSnapshot(record);
    await this.emit(record, sessionUpdatedEvent(record, this.registry));
  }

  async compactSession(sessionRef: SessionRef, customInstructions?: string): Promise<void> {
    const record = await this.ensureRecord(sessionRef);
    if (!record.session) {
      throw new Error(`Session ${sessionKey(sessionRef)} is not active.`);
    }

    await record.session.compact(customInstructions);
    record.runningRunId = undefined;
    record.status = "idle";
    record.config = deriveSessionConfig(record.session.sessionManager);
    record.preview = extractPreview(record.session.messages) ?? record.preview;
    await this.persistSnapshot(record);
    await this.emit(record, sessionUpdatedEvent(record, this.registry));
  }

  async reloadSession(sessionRef: SessionRef): Promise<void> {
    const record = await this.ensureRecord(sessionRef);
    const session = this.requireSession(record);

    this.resetExtensionUi(record);
    // reload() re-emits `session_start`; suppress blocking host-UI dialogs for
    // its duration so lifecycle prompts (e.g. computer-use permissions) cannot
    // wedge startup. Mirrors the guard around bindExtensions().
    record.bindingExtensions = true;
    try {
      await session.reload();
    } finally {
      record.bindingExtensions = false;
    }
    await this.syncRecordAfterSessionMutation(record, { emitUpdate: true });
  }

  async getSessionTree(sessionRef: SessionRef): Promise<SessionTreeSnapshot> {
    const record = await this.ensureRecord(sessionRef);
    const session = this.requireSession(record);
    return {
      roots: session.sessionManager.getTree().map((node) => toSessionTreeNodeSnapshot(node)),
      leafId: session.sessionManager.getLeafId(),
    };
  }

  async navigateSessionTree(
    sessionRef: SessionRef,
    targetId: string,
    options: NavigateSessionTreeOptions = {},
  ): Promise<NavigateSessionTreeResult> {
    const record = await this.ensureRecord(sessionRef);
    const session = this.requireSession(record);
    const result = await session.navigateTree(targetId, options);
    if (result.cancelled || result.aborted) {
      return {
        cancelled: result.cancelled,
        ...(result.aborted ? { aborted: true } : {}),
        ...(result.editorText ? { editorText: result.editorText } : {}),
        ...(result.summaryEntry ? { summaryCreated: true } : {}),
      };
    }

    record.updatedAt = nowIso();
    await this.syncRecordAfterSessionMutation(record, { emitUpdate: true });
    return {
      cancelled: false,
      ...(result.editorText ? { editorText: result.editorText } : {}),
      ...(result.summaryEntry ? { summaryCreated: true } : {}),
    };
  }

  subscribe(sessionRef: SessionRef, listener: SessionEventListener): Unsubscribe {
    const record = this.registry.getRecord(sessionRef);
    if (!record) {
      throw new Error(`Unknown session ${sessionKey(sessionRef)}.`);
    }

    const unsubscribe = this.registry.subscribe(record, listener);
    void Promise.resolve(listener(sessionUpdatedEvent(record, this.registry))).catch(() => {});
    this.replayExtensionUiState(record, listener);

    return unsubscribe;
  }

  async closeSession(sessionRef: SessionRef): Promise<void> {
    const record = this.registry.getRecord(sessionRef);
    if (!record) {
      return;
    }

    this.clearExtensionUiState(record);
    this.registry.cancelPendingHostUiRequests(record);
    await this.registry.closeSession(sessionRef);

    await this.persistSnapshot(record);
    await this.emit(record, {
      type: "sessionClosed",
      sessionRef: record.ref,
      timestamp: nowIso(),
      reason: "manual",
    });
  }

  private async ensureRecord(sessionRef: SessionRef): Promise<ManagedSessionRecord> {
    const record = await this.registry.ensureRecord(sessionRef);
    await this.touchWorkspace(record.workspace);
    await this.bindSessionRuntime(record);
    return record;
  }



  private getWritableSessionManager(record: ManagedSessionRecord): SessionManager {
    const sessionManager = record.session?.sessionManager;
    if (!sessionManager) {
      throw new Error(`Session ${sessionKey(record.ref)} is not active.`);
    }
    return sessionManager;
  }

  private requireSession(record: ManagedSessionRecord): AgentSession {
    if (!record.session) {
      throw new Error(`Session ${sessionKey(record.ref)} is not active.`);
    }
    return record.session;
  }

  private requireRuntime(record: ManagedSessionRecord): AgentSessionRuntime {
    if (!record.runtime) {
      throw new Error(`Session ${sessionKey(record.ref)} runtime is not active.`);
    }
    return record.runtime;
  }

  private async rebindRuntimeSession(record: ManagedSessionRecord, session: AgentSession): Promise<void> {
    this.registry.rebind(record, session);
    record.unsubscribeAgent?.();
    record.unsubscribeAgent = session.subscribe((event) => {
      void this.handleAgentEvent(record, event);
    });
    record.bindingExtensions = true;
    try {
      await session.bindExtensions({
        uiContext: this.createExtensionUiContext(record),
        commandContextActions: this.createCommandContextActions(record),
        onError: (error) => {
          const unsupportedIssue = parseUnsupportedHostUiErrorMessage(error.error);
          if (unsupportedIssue) {
            this.emitExtensionCompatibilityIssue(record, {
              ...unsupportedIssue,
              ...(error.extensionPath ? { extensionPath: error.extensionPath } : {}),
              ...(error.event ? { eventName: error.event } : {}),
            });
            return;
          }
          void this.emitExtensionError(record, error.extensionPath, error.event, error.error);
        },
      });
    } finally {
      record.bindingExtensions = false;
    }
    record.sessionCommands = this.collectSessionCommands(session);
  }

  private async bindSessionRuntime(record: ManagedSessionRecord): Promise<void> {
    const runtime = this.requireRuntime(record);
    runtime.setRebindSession(async (session) => {
      this.clearExtensionUiState(record);
      this.registry.cancelPendingHostUiRequests(record);
      await this.rebindRuntimeSession(record, session);
    });
    await this.rebindRuntimeSession(record, runtime.session);
  }

  private createCommandContextActions(record: ManagedSessionRecord): ExtensionCommandContextActions {
    return {
      waitForIdle: () => this.requireSession(record).agent.waitForIdle(),
      newSession: async (options) => {
        const { cancelled } = await this.requireRuntime(record).newSession(options);
        await this.syncRecordAfterSessionMutation(record, { emitUpdate: true });
        return { cancelled };
      },
      fork: async (entryId, options) => {
        const result = await this.requireRuntime(record).fork(entryId, options);
        await this.syncRecordAfterSessionMutation(record, { emitUpdate: true });
        return { cancelled: result.cancelled };
      },
      navigateTree: async (targetId, options) => {
        const result = await this.requireSession(record).navigateTree(targetId, options);
        await this.syncRecordAfterSessionMutation(record, { emitUpdate: true });
        return { cancelled: result.cancelled };
      },
      switchSession: async (sessionPath, options) => {
        const { cancelled } = await this.requireRuntime(record).switchSession(sessionPath, options);
        await this.syncRecordAfterSessionMutation(record, { emitUpdate: true });
        return { cancelled };
      },
      reload: async () => {
        this.resetExtensionUi(record);
        // See reloadSession(): guard the session_start re-emit from reload().
        record.bindingExtensions = true;
        try {
          await this.requireSession(record).reload();
        } finally {
          record.bindingExtensions = false;
        }
        await this.syncRecordAfterSessionMutation(record, { emitUpdate: true });
      },
    };
  }

  private createExtensionUiContext(record: ManagedSessionRecord): ExtensionUIContext {
    const ctx = this.buildExtensionUiContextObject(record);
    return ctx as ExtensionUIContext;
  }

  private buildExtensionUiContextObject(record: ManagedSessionRecord) {
    const noOpTheme = extensionUiThemeStub;

    const createDialogPromise = <T>(
      opts: ExtensionUIDialogOptions | undefined,
      defaultValue: T,
      createRequest: (requestId: string) => HostUiRequest,
      parseResponse: (response: HostUiResponse) => T,
    ): Promise<T> => {
      if (opts?.signal?.aborted) {
        return Promise.resolve(defaultValue);
      }
      if (record.bindingExtensions && opts?.timeout === undefined) {
        return Promise.resolve(defaultValue);
      }

      const requestId = crypto.randomUUID();
      return new Promise((resolve, reject) => {
        let timeoutId: ReturnType<typeof setTimeout> | undefined;

        const cleanup = () => {
          if (timeoutId) {
            clearTimeout(timeoutId);
          }
          opts?.signal?.removeEventListener("abort", onAbort);
          record.pendingHostUiRequests.delete(requestId);
        };

        const onAbort = () => {
          cleanup();
          resolve(defaultValue);
        };

        opts?.signal?.addEventListener("abort", onAbort, { once: true });

        const timeoutMs = opts?.timeout;
        if (timeoutMs !== undefined) {
          timeoutId = setTimeout(() => {
            cleanup();
            resolve(defaultValue);
          }, timeoutMs);
        }

        record.pendingHostUiRequests.set(requestId, {
          resolve: (response) => {
            cleanup();
            resolve(parseResponse(response));
          },
          reject,
        });

        this.emitHostUiRequest(record, createRequest(requestId));
      });
    };

    return {
      select: (title: string, options: readonly string[], opts?: ExtensionUIDialogOptions) =>
        createDialogPromise(
          opts,
          undefined,
          (requestId) => ({
            kind: "select",
            requestId,
            title,
            options,
            ...(opts?.timeout ? { timeoutMs: opts.timeout } : {}),
          }),
          (response) => ("cancelled" in response && response.cancelled ? undefined : "value" in response ? response.value : undefined),
        ),
      confirm: (title: string, message: string, opts?: ExtensionUIDialogOptions) =>
        createDialogPromise(
          opts,
          false,
          (requestId) => ({
            kind: "confirm",
            requestId,
            title,
            message,
            ...(opts?.timeout ? { timeoutMs: opts.timeout } : {}),
          }),
          (response) =>
            "cancelled" in response && response.cancelled ? false : "confirmed" in response ? response.confirmed : false,
        ),
      input: (title: string, placeholder: string | undefined, opts?: ExtensionUIDialogOptions) =>
        createDialogPromise(
          opts,
          undefined,
          (requestId) => ({
            kind: "input",
            requestId,
            title,
            ...(placeholder ? { placeholder } : {}),
            ...(opts?.timeout ? { timeoutMs: opts.timeout } : {}),
          }),
          (response) => ("cancelled" in response && response.cancelled ? undefined : "value" in response ? response.value : undefined),
        ),
      notify: (message: string, level?: "info" | "warning" | "error") => {
        this.emitHostUiRequest(record, {
          kind: "notify",
          requestId: crypto.randomUUID(),
          message,
          ...(level ? { level } : {}),
        });
      },
      onTerminalInput: () => () => {},
      setStatus: (key: string, text: string | undefined) => {
        this.emitHostUiRequest(record, {
          kind: "status",
          requestId: crypto.randomUUID(),
          key,
          ...(text ? { text } : {}),
        });
      },
      setWorkingMessage: () => {},
      setWorkingVisible: () => {},
      setWorkingIndicator: () => {},
      setHiddenThinkingLabel: () => {},
      setWidget: (key: string, content: unknown, options?: ExtensionWidgetOptions) => {
        if (content === undefined || Array.isArray(content)) {
          const lines = content as readonly string[] | undefined;
          this.emitHostUiRequest(record, {
            kind: "widget",
            requestId: crypto.randomUUID(),
            key,
            ...(lines ? { lines } : {}),
            placement: options?.placement === "belowEditor" ? "belowComposer" : "aboveComposer",
          });
        }
      },
      setFooter: () => {},
      setHeader: () => {},
      setTitle: (title: string) => {
        this.emitHostUiRequest(record, {
          kind: "title",
          requestId: crypto.randomUUID(),
          title,
        });
      },
      // pi-gui does not render arbitrary TUI custom components. Throwing a
      // typed unsupported-host error allows extensions to catch and degrade,
      // while uncaught command paths fail fast and are surfaced cleanly by
      // the desktop host. Extensions that need a structured question flow
      // should call `ctx.ui.questionnaire(...)` (pi-gui extension) instead.
      custom: async (_component: unknown, props: unknown) => {
        // Heuristic bridge: if an extension passes a questionnaire-shaped
        // payload via the generic `custom` channel, route it through the
        // native questionnaire host UI instead of failing. This lets the
        // upstream questionnaire example work in pi-gui unchanged when its
        // props match our schema.
        const maybe = props as { readonly questions?: unknown; readonly title?: unknown; readonly intro?: unknown } | undefined;
        if (maybe && Array.isArray(maybe.questions)) {
          return createDialogPromise(
            undefined,
            undefined,
            (requestId) => ({
              kind: "questionnaire",
              requestId,
              ...(typeof maybe.title === "string" ? { title: maybe.title } : {}),
              ...(typeof maybe.intro === "string" ? { intro: maybe.intro } : {}),
              questions: maybe.questions as readonly HostUiQuestionnaireQuestion[],
            }),
            (response) =>
              "cancelled" in response && response.cancelled
                ? undefined
                : "answers" in response
                  ? response.answers
                  : undefined,
          );
        }
        throw createUnsupportedHostUiError("custom");
      },
      questionnaire: (input: {
        readonly title?: string;
        readonly intro?: string;
        readonly questions: readonly unknown[];
        readonly timeout?: number;
        readonly signal?: AbortSignal;
      }) =>
        createDialogPromise(
          { ...(input.timeout !== undefined ? { timeout: input.timeout } : {}), ...(input.signal ? { signal: input.signal } : {}) },
          undefined,
          (requestId) => ({
            kind: "questionnaire",
            requestId,
            ...(input.title ? { title: input.title } : {}),
            ...(input.intro ? { intro: input.intro } : {}),
            questions: input.questions as readonly HostUiQuestionnaireQuestion[],
            ...(input.timeout !== undefined ? { timeoutMs: input.timeout } : {}),
          }),
          (response) =>
            "cancelled" in response && response.cancelled
              ? undefined
              : "answers" in response
                ? response.answers
                : undefined,
        ),
      pasteToEditor: (text: string) => {
        this.emitHostUiRequest(record, {
          kind: "editorText",
          requestId: crypto.randomUUID(),
          text,
        });
      },
      setEditorText: (text: string) => {
        this.emitHostUiRequest(record, {
          kind: "editorText",
          requestId: crypto.randomUUID(),
          text,
        });
      },
      getEditorText: () => record.extensionUiState.editorText ?? "",
      editor: (title: string, initialValue: string | undefined) =>
        createDialogPromise(
          undefined,
          undefined,
          (requestId) => ({
            kind: "editor",
            requestId,
            title,
            ...(initialValue ? { initialValue } : {}),
          }),
          (response) => ("cancelled" in response && response.cancelled ? undefined : "value" in response ? response.value : undefined),
        ),
      setEditorComponent: () => {},
      getEditorComponent: () => undefined,
      addAutocompleteProvider: () => {},
      get theme() {
        return noOpTheme;
      },
      getAllThemes: () => [],
      getTheme: () => undefined,
      setTheme: () => ({ success: false, error: "Theme switching not supported in pi-gui host UI" }),
      getToolsExpanded: () => false,
      setToolsExpanded: () => {},
    };
  }

  private isExtensionCommand(session: AgentSession, text: string): boolean {
    if (!text.trimStart().startsWith("/")) {
      return false;
    }
    const trimmed = text.trimStart();
    const spaceIndex = trimmed.indexOf(" ");
    const commandName = spaceIndex === -1 ? trimmed.slice(1) : trimmed.slice(1, spaceIndex);
    return Boolean(session.extensionRunner?.getCommand(commandName));
  }

  private resolveModel(provider: string, modelId: string) {
    const model = this.modelRegistry?.find(provider, modelId);
    if (!model) {
      throw new Error(`Unknown model ${provider}:${modelId}`);
    }
    return model;
  }

  private applySessionThinkingLevel(session: AgentSession, thinkingLevel: string): void {
    const availableLevels = session.getAvailableThinkingLevels();
    const effectiveLevel = clampThinkingLevel(thinkingLevel, availableLevels) as AgentSession["thinkingLevel"];
    if (effectiveLevel !== session.agent.state.thinkingLevel) {
      session.agent.state.thinkingLevel = effectiveLevel;
      session.sessionManager.appendThinkingLevelChange(effectiveLevel);
      return;
    }
    session.agent.state.thinkingLevel = effectiveLevel;
  }

  private async emitModelSelection(
    session: AgentSession,
    model: ReturnType<SessionSupervisor["resolveModel"]>,
    previousModel: AgentSession["model"],
  ): Promise<void> {
    const emitModelSelect = (session as unknown as {
      _emitModelSelect?: (nextModel: unknown, previousModel: unknown, source: string) => Promise<void>;
    })._emitModelSelect;
    if (!emitModelSelect) {
      return;
    }
    await emitModelSelect.call(session, model, previousModel, "set");
  }

  private emitHostUiRequest(
    record: ManagedSessionRecord,
    request: Extract<SessionDriverEvent, { type: "hostUiRequest" }>["request"],
  ): void {
    this.applyExtensionUiRequest(record, request);
    this.queueDriverEvents(record, [
      {
        type: "hostUiRequest",
        sessionRef: record.ref,
        timestamp: nowIso(),
        request,
      },
    ], { persistSnapshot: false });
  }

  private async emitExtensionError(
    record: ManagedSessionRecord,
    extensionPath: string,
    eventName: string,
    error: string,
  ): Promise<void> {
    this.emitHostUiRequest(record, {
      kind: "notify",
      requestId: crypto.randomUUID(),
      level: "error",
      message: `[${extensionPath}] ${eventName}: ${error}`,
    });
  }

  private emitExtensionCompatibilityIssue(
    record: ManagedSessionRecord,
    issue: Extract<SessionDriverEvent, { type: "extensionCompatibilityIssue" }>["issue"],
  ): void {
    this.queueDriverEvents(
      record,
      [
        {
          type: "extensionCompatibilityIssue",
          sessionRef: record.ref,
          timestamp: nowIso(),
          issue,
        },
      ],
      { persistSnapshot: false },
    );
  }

  private applyExtensionUiRequest(
    record: ManagedSessionRecord,
    request: Extract<SessionDriverEvent, { type: "hostUiRequest" }>["request"],
  ): void {
    applyHostUiRequestToExtensionUiState(record.extensionUiState, request);
  }

  private clearExtensionUiState(record: ManagedSessionRecord): void {
    record.extensionUiState.statuses.clear();
    record.extensionUiState.widgets.clear();
    record.extensionUiState.title = undefined;
    record.extensionUiState.editorText = undefined;
  }

  private resetExtensionUi(record: ManagedSessionRecord): void {
    this.emitHostUiRequest(record, {
      kind: "reset",
      requestId: crypto.randomUUID(),
    });
    this.clearExtensionUiState(record);
    this.registry.cancelPendingHostUiRequests(record);
  }



  private replayExtensionUiState(record: ManagedSessionRecord, listener: SessionEventListener): void {
    const timestamp = nowIso();

    for (const [key, text] of record.extensionUiState.statuses) {
      void Promise.resolve(
        listener({
          type: "hostUiRequest",
          sessionRef: record.ref,
          timestamp,
          request: {
            kind: "status",
            requestId: `replay:status:${key}`,
            key,
            text,
          },
        }),
      ).catch(() => {});
    }

    for (const widget of record.extensionUiState.widgets.values()) {
      void Promise.resolve(
        listener({
          type: "hostUiRequest",
          sessionRef: record.ref,
          timestamp,
          request: {
            kind: "widget",
            requestId: `replay:widget:${widget.key}`,
            key: widget.key,
            ...(widget.lines ? { lines: widget.lines } : {}),
            placement: widget.placement,
          },
        }),
      ).catch(() => {});
    }

    if (record.extensionUiState.title) {
      void Promise.resolve(
        listener({
          type: "hostUiRequest",
          sessionRef: record.ref,
          timestamp,
          request: {
            kind: "title",
            requestId: "replay:title",
            title: record.extensionUiState.title,
          },
        }),
      ).catch(() => {});
    }

    if (record.extensionUiState.editorText) {
      void Promise.resolve(
        listener({
          type: "hostUiRequest",
          sessionRef: record.ref,
          timestamp,
          request: {
            kind: "editorText",
            requestId: "replay:editorText",
            text: record.extensionUiState.editorText,
          },
        }),
      ).catch(() => {});
    }
  }

  private async syncRecordAfterSessionMutation(
    record: ManagedSessionRecord,
    options: { emitUpdate?: boolean } = {},
  ): Promise<void> {
    const session = this.requireSession(record);
    const previousKey = sessionKey(record.ref);
    const nextRef = {
      workspaceId: record.workspace.workspaceId,
      sessionId: session.sessionId,
    } satisfies SessionRef;
    const nextKey = sessionKey(nextRef);

    if (previousKey !== nextKey) {
      this.registry.rebind(record, session);
    }

    record.sessionFile = session.sessionFile ?? session.sessionManager.getSessionFile();
    record.title = session.sessionName?.trim() || record.title || deriveWorkspaceTitle(record.workspace);
    record.status = session.isStreaming ? "running" : "idle";
    record.runningRunId = session.isStreaming ? record.runningRunId ?? crypto.randomUUID() : undefined;
    record.config = deriveSessionConfig(session.sessionManager);
    record.preview =
      session.messages.length > 0 ? extractPreview(session.messages[session.messages.length - 1]) : undefined;
    record.sessionCommands = this.collectSessionCommands(session);
    await this.persistSnapshot(record);
    if (options.emitUpdate) {
      await this.emit(record, sessionUpdatedEvent(record, this.registry));
    }
  }

  private queueDriverEvents(
    record: ManagedSessionRecord,
    events: readonly SessionDriverEvent[],
    options?: {
      readonly persistSnapshot?: boolean;
    },
  ): void {
    if (events.length === 0) {
      return;
    }

    record.eventQueue = record.eventQueue.then(async () => {
      if (options?.persistSnapshot !== false) {
        await this.persistSnapshot(record);
      }
      for (const event of events) {
        await this.emit(record, event);
      }
    });
    record.eventQueue.catch(() => {});
  }

  private async cleanupRecord(sessionRef: SessionRef): Promise<void> {
    const record = this.registry.getRecord(sessionRef);
    if (!record) {
      return;
    }

    record.unsubscribeAgent?.();
    record.unsubscribeAgent = undefined;
    record.listeners.clear();
    await this.registry.disposeRuntime(record);
    this.registry.getRecord(sessionRef); // ensure still tracked
    // Remove from registry by creating a new record lookup and deleting
    // The registry doesn't expose delete, so we clear the session to mark as closed
    record.closed = true;
  }

  private async handleAgentEvent(record: ManagedSessionRecord, event: AgentSessionEvent): Promise<void> {
    const mapped = this.mapAgentEvent(record, event);
    if (mapped.length === 0) {
      return;
    }

    this.queueDriverEvents(record, mapped);
  }

  private mapAgentEvent(record: ManagedSessionRecord, event: AgentSessionEvent): SessionDriverEvent[] {
    const timestamp = nowIso();

    switch (event.type) {
      case "agent_start":
      case "turn_start":
        record.status = "running";
        return [sessionUpdatedEvent(record, this.registry)];
      case "message_start":
      case "message_end":
        if (event.message.role === "user") {
          const queuedMessage = reconcileQueuedMessagesForStartedUserMessage(record, event.message, timestamp);
          if (queuedMessage) {
            this.updatePreviewFromMessage(record, event.message);
            return [{
              type: "queuedMessageStarted" as const,
              sessionRef: record.ref,
              timestamp,
              message: queuedMessage,
            }, sessionUpdatedEvent(record, this.registry)];
          }
        }
        this.updatePreviewFromMessage(record, event.message);
        return [sessionUpdatedEvent(record, this.registry)];
      case "message_update":
        this.updatePreviewFromMessage(record, event.message);
        if (event.message.role === "assistant" && event.assistantMessageEvent.type === "text_delta") {
          return toDriverEvents({
            type: "assistantDelta" as const,
            sessionRef: record.ref,
            timestamp,
            text: event.assistantMessageEvent.delta ?? "",
          }, record, undefined, this.registry);
        }
        if (event.message.role === "assistant" && event.assistantMessageEvent.type === "thinking_delta") {
          return toDriverEvents({
            type: "reasoningDelta" as const,
            sessionRef: record.ref,
            timestamp,
            text: event.assistantMessageEvent.delta ?? "",
          }, record, undefined, this.registry);
        }
        return [sessionUpdatedEvent(record, this.registry)];
      case "tool_execution_start":
        record.status = "running";
        return toDriverEvents({
          type: "toolStarted" as const,
          sessionRef: record.ref,
          timestamp,
          toolName: event.toolName,
          callId: event.toolCallId,
          input: event.args,
        }, record, undefined, this.registry);
      case "tool_execution_update":
        return toDriverEvents({
          type: "toolUpdated" as const,
          sessionRef: record.ref,
          timestamp,
          callId: event.toolCallId,
          ...(typeof event.partialResult === "string" ? { text: event.partialResult } : {}),
          ...(typeof event.partialResult === "number" ? { progress: event.partialResult } : {}),
        }, record, undefined, this.registry);
      case "tool_execution_end":
        return toDriverEvents({
          type: "toolFinished" as const,
          sessionRef: record.ref,
          timestamp,
          callId: event.toolCallId,
          success: !event.isError,
          output: event.result,
        }, record, undefined, this.registry);
      case "turn_end":
        return [sessionUpdatedEvent(record, this.registry)];
      case "agent_end": {
        const outcome = determineRunOutcome(event.messages);
        const runId = record.runningRunId;
        record.runningRunId = undefined;
        record.status = outcome.success ? "idle" : "failed";
        record.updatedAt = timestamp;
        if (!outcome.success && outcome.error) {
          record.preview = outcome.error.message;
        }
        if (record.session) {
          record.sessionCommands = this.collectSessionCommands(record.session);
        }

        return toDriverEvents(
          outcome.success
            ? {
                type: "runCompleted" as const,
                sessionRef: record.ref,
                timestamp,
                snapshot: this.registry.snapshotForRecord(record),
              }
            : {
                type: "runFailed" as const,
                sessionRef: record.ref,
                timestamp,
                error: outcome.error ?? toSessionErrorInfo(undefined, "RUN_FAILED"),
              },
          record,
          runId,
          this.registry,
        );
      }
      case "auto_retry_start":
        record.status = "running";
        return toDriverEvents({
          type: "runRetrying" as const,
          sessionRef: record.ref,
          timestamp,
          attempt: event.attempt,
          maxAttempts: event.maxAttempts,
          delayMs: event.delayMs,
          message: event.errorMessage,
        }, record, undefined, this.registry);
      case "auto_retry_end":
        if (event.success) {
          // The retried attempt is now streaming; just refresh state. The
          // transient retry line clears when the next transcript event lands.
          record.status = "running";
          return [sessionUpdatedEvent(record, this.registry)];
        }
        record.status = "failed";
        record.runningRunId = undefined;
        record.updatedAt = timestamp;
        if (event.finalError) {
          record.preview = event.finalError;
        }
        return toDriverEvents({
          type: "runFailed" as const,
          sessionRef: record.ref,
          timestamp,
          error: { message: event.finalError ?? "Connection failed after retries", code: "RETRY_EXHAUSTED" },
        }, record, undefined, this.registry);
      default:
        return [];
    }
  }

  private updatePreviewFromMessage(record: ManagedSessionRecord, message: unknown): void {
    const preview = extractPreview(message);
    if (preview) {
      record.preview = preview;
    }
  }

  private async emit(record: ManagedSessionRecord, event: SessionDriverEvent): Promise<void> {
    for (const listener of record.listeners) {
      await listener(event);
    }
  }

  private async persistSnapshot(record: ManagedSessionRecord): Promise<void> {
    const snapshot = this.registry.snapshotForRecord(record);
    await this.catalogs.sessions.upsertSession({
      sessionRef: snapshot.ref,
      workspaceId: snapshot.ref.workspaceId,
      title: snapshot.title,
      updatedAt: snapshot.updatedAt,
      status: snapshot.status,
      ...(snapshot.archivedAt !== undefined ? { archivedAt: snapshot.archivedAt } : {}),
      ...(snapshot.preview !== undefined ? { previewSnippet: snapshot.preview } : {}),
      ...(record.sessionFile ? { sessionFilePath: record.sessionFile } : {}),
    });
    if (record.sessionFile) {
      await this.catalogs.setSessionFile(record.ref, record.sessionFile);
    }
  }

  private collectSessionCommands(session: AgentSession): RuntimeCommandRecord[] {
    const commands: RuntimeCommandRecord[] = [];

    for (const command of getRegisteredCommands(session)) {
      commands.push({
        name: normalizeRuntimeCommandName(command.invocationName ?? command.name),
        ...(command.description ? { description: command.description } : {}),
        source: "extension",
        sourceInfo: runtimeSourceInfoFromLoose(command.sourceInfo, {
          path: command.extensionPath ?? `<extension:${command.name}>`,
          source: "extension",
        }),
      });
    }

    for (const template of getPromptTemplates(session)) {
      commands.push({
        name: normalizeRuntimeCommandName(template.name),
        ...(template.description ? { description: template.description } : {}),
        source: "prompt",
        sourceInfo: runtimeSourceInfoFromLoose(template.sourceInfo, {
          path: template.filePath ?? `<prompt:${template.name}>`,
          source: "prompt",
        }),
      });
    }

    for (const skill of getSkills(session)) {
      commands.push({
        name: skillCommandName(skill.name),
        description: skill.description,
        source: "skill",
        sourceInfo: runtimeSourceInfoFromLoose(skill.sourceInfo, {
          path: skill.filePath ?? `<skill:${skill.name}>`,
          source: skill.source ?? "skill",
        }),
      });
    }

    return commands;
  }

  private async deriveWorkspaceSortOrder(workspaceId: string): Promise<number> {
    const current = await this.catalogs.workspaces.getWorkspace(workspaceId);
    if (current) {
      return current.sortOrder;
    }
    const listing = await this.catalogs.workspaces.listWorkspaces();
    return listing.workspaces.length;
  }

  private async touchWorkspace(workspace: WorkspaceRef): Promise<void> {
    await this.catalogs.workspaces.upsertWorkspace({
      workspaceId: workspace.workspaceId,
      path: workspace.path,
      displayName: workspace.displayName ?? deriveWorkspaceTitle(workspace),
      lastOpenedAt: nowIso(),
      sortOrder: await this.deriveWorkspaceSortOrder(workspace.workspaceId),
      pinned: false,
    });
  }

  private sessionEntryFromInfo(
    workspace: WorkspaceRef,
    info: SessionInfo,
    runtimeRecord?: ManagedSessionRecord,
    existingEntry?: SessionCatalogSnapshot["sessions"][number],
  ): SessionCatalogSnapshot["sessions"][number] {
    const runtimeSnapshot =
      runtimeRecord && runtimeRecord.session && !runtimeRecord.closed ? buildSnapshot(runtimeRecord) : undefined;
    const previewSnippet = runtimeSnapshot?.preview ?? previewFromSessionInfo(info);
    const archivedAt = runtimeSnapshot?.archivedAt ?? existingEntry?.archivedAt;
    const titleFromInfo = titleFromSessionInfo(info);
    const entry: SessionCatalogSnapshot["sessions"][number] = {
      sessionRef: {
        workspaceId: workspace.workspaceId,
        sessionId: info.id,
      },
      workspaceId: workspace.workspaceId,
      title: runtimeSnapshot?.title ?? resolvedCatalogSessionTitle(existingEntry?.title, titleFromInfo),
      updatedAt: runtimeSnapshot?.updatedAt ?? info.modified.toISOString(),
      status: runtimeSnapshot?.status ?? "idle",
      sessionFilePath: info.path,
    };
    if (archivedAt) {
      entry.archivedAt = archivedAt;
    }
    if (previewSnippet !== undefined) {
      entry.previewSnippet = previewSnippet;
    }
    return entry;
  }

  private async updateArchivedState(sessionRef: SessionRef, archivedAt: string | undefined): Promise<void> {
    const key = sessionKey(sessionRef);
    const record = this.registry.getRecord(sessionRef);
    if (record) {
      if (record.archivedAt === archivedAt) {
        return;
      }
      record.archivedAt = archivedAt;
      await this.persistSnapshot(record);
      await this.emit(record, sessionUpdatedEvent(record, this.registry));
      return;
    }

    const sessionEntry = await this.catalogs.sessions.getSession(sessionRef);
    if (!sessionEntry) {
      throw new Error(`Session ${key} is not in the catalog.`);
    }
    if (sessionEntry.archivedAt === archivedAt) {
      return;
    }

    const nextEntry =
      archivedAt !== undefined
        ? { ...sessionEntry, archivedAt }
        : {
            sessionRef: sessionEntry.sessionRef,
            workspaceId: sessionEntry.workspaceId,
            title: sessionEntry.title,
            updatedAt: sessionEntry.updatedAt,
            ...(sessionEntry.previewSnippet !== undefined ? { previewSnippet: sessionEntry.previewSnippet } : {}),
            ...(sessionEntry.sessionFilePath !== undefined ? { sessionFilePath: sessionEntry.sessionFilePath } : {}),
            status: sessionEntry.status,
          };

    await this.catalogs.sessions.upsertSession(nextEntry);
  }
}

async function isSubagentChildSession(sessionFilePath: string): Promise<boolean> {
  try {
    const raw = await readFile(sessionFilePath, "utf8");
    return raw.includes('"customType":"pi-subagents_launch_metadata"') ||
      raw.includes('"customType": "pi-subagents_launch_metadata"');
  } catch {
    return false;
  }
}

function resolvedCatalogSessionTitle(existingTitle: string | undefined, infoTitle: string): string {
  const trimmedExisting = existingTitle?.trim();
  if (!trimmedExisting) {
    return infoTitle;
  }
  if (trimmedExisting === NEW_THREAD_PLACEHOLDER_TITLE && infoTitle !== NEW_THREAD_PLACEHOLDER_TITLE) {
    return infoTitle;
  }
  return trimmedExisting;
}

const DEFAULT_SESSION_THINKING_LEVEL = "medium";
const THINKING_LEVEL_ORDER = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;
type SessionTreeNodeRecord = ReturnType<SessionManager["getTree"]>[number];

// Exported for unit testing.
export function clampThinkingLevel(level: string, availableLevels: readonly string[]): string {
  const available = new Set(availableLevels);
  const requestedIndex = THINKING_LEVEL_ORDER.indexOf(level as (typeof THINKING_LEVEL_ORDER)[number]);
  if (requestedIndex === -1) {
    return availableLevels[0] ?? "off";
  }
  for (let index = requestedIndex; index < THINKING_LEVEL_ORDER.length; index += 1) {
    const candidate = THINKING_LEVEL_ORDER[index];
    if (candidate && available.has(candidate)) {
      return candidate;
    }
  }
  for (let index = requestedIndex - 1; index >= 0; index -= 1) {
    const candidate = THINKING_LEVEL_ORDER[index];
    if (candidate && available.has(candidate)) {
      return candidate;
    }
  }
  return availableLevels[0] ?? "off";
}

async function createCanonicalWorkspaceRef(path: string, displayName?: string): Promise<WorkspaceRef> {
  const canonicalPath = await canonicalizePath(path);
  return createWorkspaceRef(canonicalPath, displayName);
}

async function canonicalizePath(path: string): Promise<string> {
  const resolvedPath = resolve(path);
  try {
    return await realpath(resolvedPath);
  } catch {
    return resolvedPath;
  }
}

function runtimeSourceInfoFromLoose(
  sourceInfo: RuntimeCommandRecord["sourceInfo"] | undefined,
  fallback: { path: string; source: string },
): RuntimeCommandRecord["sourceInfo"] {
  if (sourceInfo) {
    return sourceInfo;
  }

  return {
    path: fallback.path,
    source: fallback.source,
    scope: "temporary",
    origin: "top-level",
  };
}

function getRegisteredCommands(session: AgentSession): readonly RegisteredCommandAdapter[] {
  return (session.extensionRunner?.getRegisteredCommands() ?? []) as readonly RegisteredCommandAdapter[];
}

function getPromptTemplates(session: AgentSession): readonly PromptTemplateAdapter[] {
  return session.promptTemplates as readonly PromptTemplateAdapter[];
}

function getSkills(session: AgentSession): readonly SkillAdapter[] {
  return session.resourceLoader.getSkills().skills as readonly SkillAdapter[];
}

interface TreeToolCallRecord {
  readonly name: string;
  readonly arguments: Readonly<Record<string, unknown>>;
}

function toSessionTreeNodeSnapshot(
  node: SessionTreeNodeRecord,
  toolCalls: ReadonlyMap<string, TreeToolCallRecord> = new Map(),
): SessionTreeNodeSnapshot {
  const role = treeNodeRole(node.entry);
  const customType = treeNodeCustomType(node.entry);
  const preview = treeNodePreview(node.entry, toolCalls);
  const childToolCalls = extendTreeToolCalls(toolCalls, node.entry);
  return {
    id: node.entry.id,
    parentId: node.entry.parentId,
    kind: node.entry.type,
    timestamp: node.entry.timestamp,
    ...(node.label ? { label: node.label } : {}),
    ...(role ? { role } : {}),
    ...(customType ? { customType } : {}),
    title: treeNodeTitle(node.entry),
    ...(preview ? { preview } : {}),
    children: node.children.map((child) => toSessionTreeNodeSnapshot(child, childToolCalls)),
  };
}

function extendTreeToolCalls(
  toolCalls: ReadonlyMap<string, TreeToolCallRecord>,
  entry: SessionTreeNodeRecord["entry"],
): ReadonlyMap<string, TreeToolCallRecord> {
  if (entry.type !== "message" || entry.message.role !== "assistant") {
    return toolCalls;
  }

  const content = entry.message.content;
  if (!Array.isArray(content)) {
    return toolCalls;
  }

  let nextToolCalls: Map<string, TreeToolCallRecord> | undefined;
  for (const block of content) {
    if (
      typeof block !== "object" ||
      block === null ||
      !("type" in block) ||
      block.type !== "toolCall" ||
      !("id" in block) ||
      typeof block.id !== "string" ||
      !("name" in block) ||
      typeof block.name !== "string"
    ) {
      continue;
    }
    nextToolCalls ??= new Map(toolCalls);
    nextToolCalls.set(block.id, {
      name: block.name,
      arguments:
        "arguments" in block && typeof block.arguments === "object" && block.arguments !== null
          ? (block.arguments as Record<string, unknown>)
          : {},
    });
  }

  return nextToolCalls ?? toolCalls;
}

function treeNodeRole(entry: SessionTreeNodeRecord["entry"]): string | undefined {
  if (entry.type !== "message") {
    return undefined;
  }
  return entry.message.role;
}

function treeNodeCustomType(entry: SessionTreeNodeRecord["entry"]): string | undefined {
  if (entry.type === "custom" || entry.type === "custom_message") {
    return entry.customType;
  }
  return undefined;
}

function treeNodeTitle(entry: SessionTreeNodeRecord["entry"]): string {
  switch (entry.type) {
    case "message":
      switch (entry.message.role) {
        case "user":
          return "User";
        case "assistant":
          return "Assistant";
        case "toolResult":
          return "Tool result";
        case "bashExecution":
          return "Shell";
        case "branchSummary":
          return "Branch summary";
        case "compactionSummary":
          return "Compaction";
        default:
          return entry.message.role;
      }
    case "custom_message":
      return entry.customType;
    case "compaction":
      return "Compaction";
    case "branch_summary":
      return "Branch summary";
    case "model_change":
      return "Model";
    case "thinking_level_change":
      return "Thinking";
    case "custom":
      return "Custom";
    case "label":
      return "Label";
    case "session_info":
      return "Title";
  }
  return "Entry";
}

function treeNodePreview(
  entry: SessionTreeNodeRecord["entry"],
  toolCalls: ReadonlyMap<string, TreeToolCallRecord>,
): string | undefined {
  switch (entry.type) {
    case "message":
      return previewForTreeMessage(entry.message as unknown as Record<string, unknown>, toolCalls);
    case "custom_message":
      return previewForTreeContent(entry.content);
    case "compaction":
      return `${Math.max(1, Math.round(entry.tokensBefore / 1000))}k token summary`;
    case "branch_summary":
      return truncate(entry.summary);
    case "model_change":
      return `${entry.provider}:${entry.modelId}`;
    case "thinking_level_change":
      return entry.thinkingLevel;
    case "custom":
      return entry.customType;
    case "label":
      return entry.label ?? "(cleared)";
    case "session_info":
      return entry.name || "(empty)";
    default:
      return undefined;
  }
}

function previewForTreeMessage(
  message: Record<string, unknown>,
  toolCalls: ReadonlyMap<string, TreeToolCallRecord>,
): string | undefined {
  if (message.role === "toolResult") {
    return previewForTreeToolResult(message, toolCalls);
  }
  const content = message.content;
  if (typeof content === "string") {
    return truncate(content.trim()) || undefined;
  }
  if (Array.isArray(content)) {
    const preview = truncate(
      content
        .flatMap((part) =>
          typeof part === "object" && part !== null && "type" in part && part.type === "text" && "text" in part && typeof part.text === "string"
            ? [part.text]
            : [],
        )
        .join(" ")
        .replace(/\s+/g, " ")
        .trim(),
    );
    if (preview) {
      return preview;
    }
  }
  if (message.role === "bashExecution" && typeof message.command === "string") {
    return truncate(message.command);
  }
  return undefined;
}

function previewForTreeToolResult(
  message: Record<string, unknown>,
  toolCalls: ReadonlyMap<string, TreeToolCallRecord>,
): string | undefined {
  const toolCallId = typeof message.toolCallId === "string" ? message.toolCallId : undefined;
  const toolName = typeof message.toolName === "string" ? message.toolName : undefined;
  const toolCall = toolCallId ? toolCalls.get(toolCallId) : undefined;

  if (toolCall) {
    return formatTreeToolCall(toolCall.name, toolCall.arguments);
  }

  if (toolName) {
    return `[${toolName}]`;
  }

  return "[tool]";
}

function formatTreeToolCall(name: string, args: Readonly<Record<string, unknown>>): string {
  switch (name) {
    case "read": {
      const path = shortenHomePath(String(args.path ?? args.file_path ?? ""));
      const offset = typeof args.offset === "number" ? args.offset : undefined;
      const limit = typeof args.limit === "number" ? args.limit : undefined;
      let display = path;
      if (offset !== undefined || limit !== undefined) {
        const start = offset ?? 1;
        const end = limit !== undefined ? start + limit - 1 : undefined;
        display += `:${start}${end !== undefined ? `-${end}` : ""}`;
      }
      return `[read: ${display}]`;
    }
    case "write":
      return `[write: ${shortenHomePath(String(args.path ?? args.file_path ?? ""))}]`;
    case "edit":
      return `[edit: ${shortenHomePath(String(args.path ?? args.file_path ?? ""))}]`;
    case "bash": {
      const rawCommand = String(args.command ?? "")
        .replace(/[\n\t]/g, " ")
        .trim();
      return `[bash: ${truncate(rawCommand, 50)}]`;
    }
    case "grep":
      return `[grep: /${String(args.pattern ?? "")}/ in ${shortenHomePath(String(args.path ?? "."))}]`;
    case "find":
      return `[find: ${String(args.pattern ?? "")} in ${shortenHomePath(String(args.path ?? "."))}]`;
    case "ls":
      return `[ls: ${shortenHomePath(String(args.path ?? "."))}]`;
    default: {
      const json = JSON.stringify(args);
      return truncate(`[${name}: ${json}]`, 80);
    }
  }
}

function shortenHomePath(path: string): string {
  const homePath = process.env.HOME ?? process.env.USERPROFILE ?? "";
  if (homePath && path.startsWith(homePath)) {
    return `~${path.slice(homePath.length)}`;
  }
  return path;
}

function previewForTreeContent(content: unknown): string | undefined {
  if (typeof content === "string") {
    return truncate(content.trim()) || undefined;
  }
  if (!Array.isArray(content)) {
    return undefined;
  }
  return (
    truncate(
      content
        .flatMap((part) =>
          typeof part === "object" && part !== null && "type" in part && part.type === "text" && "text" in part && typeof part.text === "string"
            ? [part.text]
            : [],
        )
        .join(" ")
        .replace(/\s+/g, " ")
        .trim(),
    ) || undefined
  );
}

const extensionUiThemeStub = new Proxy(
  {},
  {
    get: () => (...args: unknown[]) => {
      const last = args.at(-1);
      return typeof last === "string" ? last : "";
    },
  },
) as ExtensionUIContext["theme"];

function reconcileQueuedMessagesForStartedUserMessage(
  record: ManagedSessionRecord,
  message: unknown,
  timestamp: string,
): SessionQueuedMessage | undefined {
  const result = reconcileQueuedMessagesForStartedUserMessageCore(record.queuedMessages, message);
  record.queuedMessages = result.queuedMessages;
  if (result.started) {
    record.updatedAt = timestamp;
  }
  return result.started;
}

function sessionUpdatedEvent(record: ManagedSessionRecord, registry?: SessionRuntimeRegistry): SessionDriverEvent {
  return {
    type: "sessionUpdated",
    sessionRef: record.ref,
    timestamp: record.updatedAt,
    snapshot: registry ? registry.snapshotForRecord(record) : buildSnapshot(record),
  };
}

function toDriverEvents(
  base: SessionDriverEvent,
  record: ManagedSessionRecord,
  runId?: string,
  registry?: SessionRuntimeRegistry,
): SessionDriverEvent[] {
  const id = runId ?? record.runningRunId;
  const event = id ? { ...base, runId: id } : base;
  return [event, sessionUpdatedEvent(record, registry)];
}

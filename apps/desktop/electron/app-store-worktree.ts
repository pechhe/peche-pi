import { randomUUID } from "node:crypto";
import { sessionKey } from "@pi-gui/pi-sdk-driver";
import type { WorktreeCatalogEntry } from "@pi-gui/catalogs";
import type { WorkspaceRef } from "@pi-gui/session-driver";
import type { CreateWorktreeInput, DesktopAppState, RemoveWorktreeInput, StartAutomationThreadInput, StartChatInput, StartThreadInput } from "../src/desktop-state";
import { sendMessageToSession } from "./app-store-composer";
import { reduce } from "./app-state-reducer";
import type { CreateWorktreeOptions } from "./worktree-manager";
import type { ComposerOps, Infrastructure, PersistenceOps, SessionLifecycle, StateAccess, StoreHelpers } from "./app-store-internals";

type WorktreeStore = StateAccess & Infrastructure & StoreHelpers & SessionLifecycle & PersistenceOps & ComposerOps;
import { NEW_THREAD_PLACEHOLDER_TITLE } from "./thread-title-constants";

/* ── Public methods ─────────────────────────────────────── */

export async function createWorktree(store: WorktreeStore, input: CreateWorktreeInput): Promise<DesktopAppState> {
  await store.initialize();
  const rootWorkspace = store.workspaceRefFromState(input.workspaceId);
  if (!rootWorkspace) {
    return store.withError(`Unknown workspace: ${input.workspaceId}`);
  }

  return store.withErrorHandling(async () => {
    const createOptions = buildWorktreeOptions(
      store,
      rootWorkspace,
      input.fromSessionWorkspaceId,
      input.fromSessionId,
    );
    const created = await store.worktreeManager.createWorktree(rootWorkspace, createOptions);
    const synced = await store.driver.syncWorkspace(created.path, created.displayName);
    if (input.fromSessionId) {
      await store.driver.createSession(
        synced.workspace,
        { title: sessionTitleForWorktree(store, input.fromSessionWorkspaceId ?? input.workspaceId, input.fromSessionId) },
      );
    }

    return store.refreshState({
      selectedWorkspaceId: created.path,
      selectedSessionId: "",
      composerDraft: "",
      clearLastError: true,
      refreshWorktrees: false,
    });
  });
}

export async function removeWorktree(store: WorktreeStore, input: RemoveWorktreeInput): Promise<DesktopAppState> {
  await store.initialize();
  const rootWorkspace = store.workspaceRefFromState(input.workspaceId);
  if (!rootWorkspace) {
    return store.withError(`Unknown workspace: ${input.workspaceId}`);
  }

  return store.withErrorHandling(async () => {
    const worktree = await store.catalogStore.worktrees.getWorktree(input.worktreeId);
    await store.worktreeManager.removeWorktree(rootWorkspace, input.worktreeId, { force: input.force });
    if (worktree?.path) {
      await store.driver.removeWorkspace(worktree.path).catch(() => undefined);
    }

    const selectedWorkspaceId =
      store.state.selectedWorkspaceId === input.worktreeId ? input.workspaceId : store.state.selectedWorkspaceId;
    const selectedSessionId =
      store.state.selectedWorkspaceId === input.worktreeId ? "" : store.state.selectedSessionId;
    return store.refreshState({
      selectedWorkspaceId,
      selectedSessionId,
      composerDraft: "",
      clearLastError: true,
      refreshWorktrees: false,
    });
  });
}

export async function startThread(store: WorktreeStore, input: StartThreadInput): Promise<DesktopAppState> {
  const __dbg = (step: string) => {
    try { require("node:fs").appendFileSync("/tmp/pi-startthread.log", `[${new Date().toISOString()}] ${step}\n`); } catch { /* ignore */ }
  };
  __dbg("enter " + JSON.stringify({ env: input.environment, provider: input.provider, modelId: input.modelId }));
  await store.initialize();
  __dbg("after initialize");
  const rootWorkspace = store.workspaceRefFromState(input.rootWorkspaceId);
  if (!rootWorkspace) {
    return store.withError(`Unknown workspace: ${input.rootWorkspaceId}`);
  }

  return store.withErrorHandling(async () => {
    let targetWorkspace = rootWorkspace;
    if (input.environment === "local" && input.startBranch) {
      // Local mode: checkout the selected branch in the repo before starting.
      // Only switch when the target differs from the current branch. If the
      // working tree is dirty, refuse (throw) so the renderer surfaces a toast
      // instead of silently hanging the new-thread placeholder.
      const { execGit } = await import("./git-runner.js");
      const current = await execGit(["rev-parse", "--abbrev-ref", "HEAD"], rootWorkspace.path);
      const currentBranch = current.code === 0 ? current.stdout.trim() : "";
      const target = input.startBranch.replace(/^origin\//, "");
      if (target && target !== currentBranch) {
        const status = await execGit(["status", "--porcelain"], rootWorkspace.path);
        if (status.code === 0 && status.stdout.trim().length > 0) {
          throw new Error(
            `Can't switch to "${target}": you have uncommitted local changes. Commit or stash them first, or pick "${currentBranch || "current"}" to keep working on the current branch.`,
          );
        }
        const checkout = await execGit(["checkout", target], rootWorkspace.path);
        if (checkout.code !== 0) {
          throw new Error(`Failed to checkout branch ${target}: ${checkout.stderr.trim()}`);
        }
      }
    }
    if (input.environment === "worktree") {
      if (input.existingWorktreeId) {
        // Reuse an existing worktree
        const existingWt = store.state.worktreesByWorkspace[input.rootWorkspaceId]?.find(
          (wt) => wt.id === input.existingWorktreeId,
        );
        if (existingWt?.linkedWorkspaceId) {
          const synced = await store.driver.syncWorkspace(existingWt.path, existingWt.name);
          targetWorkspace = synced.workspace;
        } else {
          return store.withError(`Worktree not found: ${input.existingWorktreeId}`);
        }
      } else {
        // Create new worktree — detached HEAD at the selected branch (or current HEAD)
        const baseOptions = buildWorktreeOptions(store, rootWorkspace, undefined, undefined, input.prompt);
        // If user selected a branch, use it as the detached start point.
        const worktreeOptions = input.startBranch
          ? { ...baseOptions, startPoint: input.startBranch }
          : baseOptions;
        const created = await store.worktreeManager.createWorktree(rootWorkspace, worktreeOptions);
        const synced = await store.driver.syncWorkspace(created.path, created.displayName);
        targetWorkspace = synced.workspace;
      }
    }

    const prompt = input.prompt?.trim() ?? "";
    const attachments = input.attachments ?? [];
    __dbg("before buildCreateSessionOptions");
    const createOptions = (await store.buildCreateSessionOptions(targetWorkspace.workspaceId)) ?? {};
    __dbg("after buildCreateSessionOptions; before createSession");
    const initialModel =
      input.provider && input.modelId
        ? { provider: input.provider, modelId: input.modelId }
        : createOptions.initialModel;
    const initialThinkingLevel = input.thinkingLevel ?? createOptions.initialThinkingLevel;
    const session = await store.driver.createSession(targetWorkspace, {
      ...createOptions,
      title: NEW_THREAD_PLACEHOLDER_TITLE,
      ...(initialModel ? { initialModel } : {}),
      ...(initialThinkingLevel ? { initialThinkingLevel } : {}),
    });
    const key = sessionKey(session.ref);
    store.sessionState.transcriptCache.set(key, []);
    store.sessionState.loadedTranscriptKeys.add(key);
    store.updateSessionConfig(session.ref, session.config);
    const autoTitleAbortController = new AbortController();
    const pendingAutoTitle = {
      requestToken: randomUUID(),
      cancel: () => autoTitleAbortController.abort(),
    };
    store.setPendingAutoTitle(session.ref, pendingAutoTitle);
    __dbg("after createSession " + session.ref.sessionId);

    // Navigate to thread view immediately so streaming deltas render live.
    // Set selection eagerly so that any subscription replay events
    // (fired by ensureSessionReady inside refreshState) read the new
    // session ID instead of the stale one.
    store.state = {
      ...store.state,
      selectedWorkspaceId: session.ref.workspaceId,
      selectedSessionId: session.ref.sessionId,
    };
    __dbg("before refreshState");
    const state = await store.refreshState({
      selectedWorkspaceId: session.ref.workspaceId,
      selectedSessionId: session.ref.sessionId,
      composerDraft: "",
      clearLastError: true,
      refreshWorktrees: input.environment === "worktree",
      activeView: "threads",
    });
    __dbg("after refreshState");

    // Fire message in background — assistantDelta events flow through
    // handleSessionEvent → emit() and update React while on the thread view
    if (prompt || attachments.length > 0) {
      void sendMessageToSession(store, session.ref, prompt, attachments, {
        rollbackOptimisticMessageOnError: false,
      }).catch((error) => {
        void store.withError(error);
      });
    }
    if (prompt) {
      void generateAndApplyAutoTitle(store, session.ref, targetWorkspace, {
        prompt,
        requestToken: pendingAutoTitle.requestToken,
        signal: autoTitleAbortController.signal,
        ...(initialModel ? { model: initialModel } : {}),
        ...(initialThinkingLevel ? { thinkingLevel: initialThinkingLevel } : {}),
      });
    } else {
      store.clearPendingAutoTitle(session.ref);
    }

    __dbg("returning state");
    return state;
  });
}

/**
 * Fire a scheduled automation as a new background thread.
 *
 * Mirrors `startThread` (worktree creation, model/thinking, auto-title) but
 * does NOT change selection or navigate — a scheduled fire must not hijack the
 * user's current view. Returns the created session id.
 */
export async function startAutomationThread(
  store: WorktreeStore,
  input: StartAutomationThreadInput,
): Promise<string | undefined> {
  await store.initialize();
  const rootWorkspace = store.workspaceRefFromState(input.rootWorkspaceId);
  if (!rootWorkspace) return undefined;

  let targetWorkspace = rootWorkspace;
  if (input.environment === "worktree") {
    const worktreeOptions = buildWorktreeOptions(store, rootWorkspace, undefined, undefined, input.prompt);
    const created = await store.worktreeManager.createWorktree(rootWorkspace, worktreeOptions);
    const synced = await store.driver.syncWorkspace(created.path, created.displayName);
    targetWorkspace = synced.workspace;
  }

  const prompt = input.prompt?.trim() ?? "";
  const createOptions = (await store.buildCreateSessionOptions(targetWorkspace.workspaceId)) ?? {};
  const initialModel =
    input.provider && input.modelId
      ? { provider: input.provider, modelId: input.modelId }
      : createOptions.initialModel;
  const initialThinkingLevel = input.thinkingLevel ?? createOptions.initialThinkingLevel;

  // A named automation pins its title (⚡ prefix). An unnamed one gets the
  // placeholder so the auto-title generator can name it like a normal thread.
  const name = input.name?.trim();
  const title = name ? `⚡ ${name}` : NEW_THREAD_PLACEHOLDER_TITLE;

  const session = await store.driver.createSession(targetWorkspace, {
    ...createOptions,
    title,
    ...(initialModel ? { initialModel } : {}),
    ...(initialThinkingLevel ? { initialThinkingLevel } : {}),
  });
  const key = sessionKey(session.ref);
  store.sessionState.transcriptCache.set(key, []);
  store.sessionState.loadedTranscriptKeys.add(key);
  store.updateSessionConfig(session.ref, session.config);

  let autoTitle: { requestToken: string; signal: AbortSignal } | undefined;
  if (!name && prompt) {
    const controller = new AbortController();
    const requestToken = randomUUID();
    store.setPendingAutoTitle(session.ref, { requestToken, cancel: () => controller.abort() });
    autoTitle = { requestToken, signal: controller.signal };
  }

  // Surface the new session. When `select` is true (manual fire from UI),
  // navigate to the new session so the user sees it immediately.
  if (input.select) {
    store.state = {
      ...store.state,
      selectedWorkspaceId: session.ref.workspaceId,
      selectedSessionId: session.ref.sessionId,
    };
    await store.refreshState({
      refreshWorktrees: input.environment === "worktree",
      selectedWorkspaceId: session.ref.workspaceId,
      selectedSessionId: session.ref.sessionId,
      activeView: "threads",
    });
  } else {
    await store.refreshState({ refreshWorktrees: input.environment === "worktree" });
  }

  if (prompt) {
    void sendMessageToSession(store, session.ref, prompt, [], {
      rollbackOptimisticMessageOnError: false,
    }).catch((error) => {
      void store.withError(error);
    });
  }
  if (autoTitle) {
    void generateAndApplyAutoTitle(store, session.ref, targetWorkspace, {
      prompt,
      requestToken: autoTitle.requestToken,
      signal: autoTitle.signal,
      ...(initialModel ? { model: initialModel } : {}),
      ...(initialThinkingLevel ? { thinkingLevel: initialThinkingLevel } : {}),
    });
  }

  return session.ref.sessionId;
}

export async function startChat(store: WorktreeStore, input: StartChatInput): Promise<DesktopAppState> {
  await store.initialize();

  return store.withErrorHandling(async () => {
    const id = randomUUID();
    const now = new Date().toISOString();
    const chat = {
      id,
      title: "New chat",
      createdAt: now,
      updatedAt: now,
      preview: "",
      status: "idle" as const,
      hasUnseenUpdate: false,
      isAwaitingAssistantText: false,
    };
    store.state = reduce(store.state, { type: "chats/add", chat });
    store.state = reduce(store.state, { type: "chats/select", chatId: id });

    const targetWorkspace = await store.ensureChatWorkspace(chat);

    const prompt = input.prompt?.trim() ?? "";
    const attachments = input.attachments ?? [];
    const createOptions = (await store.buildCreateSessionOptions(targetWorkspace.workspaceId)) ?? {};
    const initialModel =
      input.provider && input.modelId
        ? { provider: input.provider, modelId: input.modelId }
        : createOptions.initialModel;
    const initialThinkingLevel = input.thinkingLevel ?? createOptions.initialThinkingLevel;
    const session = await store.driver.createSession(targetWorkspace, {
      ...createOptions,
      title: NEW_THREAD_PLACEHOLDER_TITLE,
      ...(initialModel ? { initialModel } : {}),
      ...(initialThinkingLevel ? { initialThinkingLevel } : {}),
    });
    const key = sessionKey(session.ref);
    store.sessionState.transcriptCache.set(key, []);
    store.sessionState.loadedTranscriptKeys.add(key);
    store.updateSessionConfig(session.ref, session.config);
    const autoTitleAbortController = new AbortController();
    const pendingAutoTitle = {
      requestToken: randomUUID(),
      cancel: () => autoTitleAbortController.abort(),
    };
    store.setPendingAutoTitle(session.ref, pendingAutoTitle);

    store.state = {
      ...store.state,
      selectedWorkspaceId: session.ref.workspaceId,
      selectedSessionId: session.ref.sessionId,
    };
    const state = await store.refreshState({
      selectedWorkspaceId: session.ref.workspaceId,
      selectedSessionId: session.ref.sessionId,
      composerDraft: "",
      clearLastError: true,
      activeView: "threads",
    });

    if (prompt || attachments.length > 0) {
      void sendMessageToSession(store, session.ref, prompt, attachments, {
        rollbackOptimisticMessageOnError: false,
      }).catch((error) => {
        void store.withError(error);
      });
    }
    if (prompt) {
      void generateAndApplyAutoTitle(store, session.ref, targetWorkspace, {
        prompt,
        requestToken: pendingAutoTitle.requestToken,
        signal: autoTitleAbortController.signal,
        ...(initialModel ? { model: initialModel } : {}),
        ...(initialThinkingLevel ? { thinkingLevel: initialThinkingLevel } : {}),
        onTitleApplied: (title) => {
          // Don't clobber a manual rename the user made before the title resolved.
          const current = store.state.chats.find((c) => c.id === id);
          if (current && current.title !== "New chat") {
            return;
          }
          store.state = reduce(store.state, { type: "chats/rename", chatId: id, title });
          void store.persistUiState();
          store.emit();
        },
      });
    } else {
      store.clearPendingAutoTitle(session.ref);
    }

    return state;
  });
}

export async function syncAndListWorktrees(
  store: WorktreeStore,
  workspaces: readonly {
    workspaceId: string;
    path: string;
    displayName: string;
    sortOrder: number;
    lastOpenedAt: string;
  }[],
): Promise<readonly WorktreeCatalogEntry[]> {
  const existing = await store.catalogStore.worktrees.listWorktrees();
  const existingPrimaryByWorkspaceId = new Set(
    existing.worktrees.filter((worktree) => worktree.kind === "primary").map((worktree) => worktree.workspaceId),
  );
  const inspected = await Promise.all(
    workspaces.map(async (workspace) => {
      try {
        const inspection = await store.worktreeManager.inspectWorkspace(workspace);
        return {
          workspace,
          ...inspection,
        };
      } catch {
        return {
          workspace,
          canonicalPath: workspace.path,
          commonDir: `workspace:${workspace.workspaceId}`,
        };
      }
    }),
  );
  const groups = new Map<string, typeof inspected>();

  for (const entry of inspected) {
    const group = groups.get(entry.commonDir);
    if (group) {
      group.push(entry);
    } else {
      groups.set(entry.commonDir, [entry]);
    }
  }

  const syncRoots = [...groups.values()]
    .map((group) =>
      [...group].sort((left, right) => {
        const leftIsExistingPrimary = existingPrimaryByWorkspaceId.has(left.workspace.workspaceId);
        const rightIsExistingPrimary = existingPrimaryByWorkspaceId.has(right.workspace.workspaceId);
        if (leftIsExistingPrimary !== rightIsExistingPrimary) {
          return leftIsExistingPrimary ? -1 : 1;
        }
        if (left.workspace.sortOrder !== right.workspace.sortOrder) {
          return left.workspace.sortOrder - right.workspace.sortOrder;
        }
        if (left.workspace.lastOpenedAt !== right.workspace.lastOpenedAt) {
          return left.workspace.lastOpenedAt.localeCompare(right.workspace.lastOpenedAt);
        }
        if (left.canonicalPath.length !== right.canonicalPath.length) {
          return left.canonicalPath.length - right.canonicalPath.length;
        }
        return left.workspace.displayName.localeCompare(right.workspace.displayName);
      })[0],
    )
    .filter((entry): entry is (typeof inspected)[number] => Boolean(entry));
  const syncRootWorkspaceIds = new Set(syncRoots.map((entry) => entry.workspace.workspaceId));
  const staleWorkspaceIds = inspected
    .map((entry) => entry.workspace.workspaceId)
    .filter((workspaceId) => !syncRootWorkspaceIds.has(workspaceId));

  await Promise.all(
    syncRoots.map((entry) =>
      store.worktreeManager
        .refreshWorktrees({
          workspaceId: entry.workspace.workspaceId,
          path: entry.workspace.path,
          displayName: entry.workspace.displayName,
        })
        .catch(() => undefined),
    ),
  );
  await Promise.all(
    staleWorkspaceIds.map((workspaceId) =>
      store.catalogStore.worktrees.replaceWorkspaceWorktrees(workspaceId, []).catch(() => undefined),
    ),
  );

  return (await store.catalogStore.worktrees.listWorktrees()).worktrees;
}

/**
 * Build default worktree options — used both by `createWorktree` and `startThread`
 * (which lives in the main store).
 */
function buildWorktreeOptions(
  store: WorktreeStore,
  workspace: WorkspaceRef,
  fromSessionWorkspaceId?: string,
  fromSessionId?: string,
  titleHint?: string,
): CreateWorktreeOptions {
  const sessionTitle =
    fromSessionId && fromSessionWorkspaceId
      ? sessionTitleForWorktree(store, fromSessionWorkspaceId, fromSessionId)
      : undefined;
  const preferredTitle = shortDisplayTitle(titleHint?.trim() || sessionTitle);
  const suffix = shortUniqueSuffix();
  const displayName = preferredTitle || `Worktree ${suffix}`;
  // Detached-first (ADR 0003): no path (the manager places it in the managed
  // dir) and no branchName (created lazily on first commit/Ship).
  return {
    displayName,
    startPoint: "HEAD",
  };
}

/* ── Private helpers ─────────────────────────────────────── */

async function generateAndApplyAutoTitle(
  store: WorktreeStore,
  sessionRef: { workspaceId: string; sessionId: string },
  workspace: WorkspaceRef,
  options: {
    readonly prompt: string;
    readonly requestToken: string;
    readonly signal: AbortSignal;
    readonly model?: { provider: string; modelId: string };
    readonly thinkingLevel?: string;
    readonly onTitleApplied?: (title: string) => void;
  },
): Promise<void> {
  const clearMatchingPendingTitle = () => {
    const pendingAutoTitle = store.getPendingAutoTitle(sessionRef);
    if (pendingAutoTitle?.requestToken === options.requestToken) {
      store.clearPendingAutoTitle(sessionRef);
    }
  };

  try {
    const result = await store.driver.generateThreadTitle(workspace, {
      prompt: options.prompt,
      signal: options.signal,
      ...(options.model ? { model: options.model } : {}),
      ...(options.thinkingLevel ? { thinkingLevel: options.thinkingLevel } : {}),
    });
    console.log("[autoTitle] generateThreadTitle result:", JSON.stringify(result));
    if (!result) {
      clearMatchingPendingTitle();
      return;
    }
    const pendingAutoTitle = store.getPendingAutoTitle(sessionRef);
    const currentSession = store.sessionFromState(sessionRef);
    if (
      !pendingAutoTitle ||
      pendingAutoTitle.requestToken !== options.requestToken ||
      currentSession?.title !== NEW_THREAD_PLACEHOLDER_TITLE
    ) {
      return;
    }

    store.clearPendingAutoTitle(sessionRef);
    // result may be a plain string (legacy override) or { type, title }.
    const title = typeof result === "string" ? result : result.title;
    const threadType = typeof result === "string" ? "other" : result.type;
    console.log("[autoTitle] about to rename + setThreadType", { title, threadType, sessionId: sessionRef.sessionId });
    await store.driver.renameSession(sessionRef, title);
    store.setThreadType(sessionRef.sessionId, threadType);
    options.onTitleApplied?.(title);
  } catch {
    clearMatchingPendingTitle();
  }
}

function sessionTitleForWorktree(store: WorktreeStore, workspaceId: string, sessionId: string): string | undefined {
  return store.state.workspaces
    .find((workspace) => workspace.id === workspaceId)
    ?.sessions.find((session) => session.id === sessionId)
    ?.title.trim();
}

function shortUniqueSuffix(): string {
  return randomUUID().slice(0, 6);
}

function shortDisplayTitle(value: string | undefined, limit = 44): string | undefined {
  const trimmed = value?.replace(/\s+/g, " ").trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.length > limit ? `${trimmed.slice(0, limit - 3).trimEnd()}...` : trimmed;
}

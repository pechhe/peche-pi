import type { DesktopAppState, SessionRecord, WorkspaceRecord } from "./desktop-state";

/**
 * Sentinel session id for the optimistic sidebar row shown while a new thread
 * is still being created on the main process (before the real session id
 * exists). Special-cased as active in the sidebar and ignored by selection.
 */
export const PENDING_THREAD_SESSION_ID = "__pending_thread__";

export interface ThreadEnvironmentMeta {
  readonly kind: "local" | "worktree";
  readonly label: string;
  readonly branchName?: string;
  readonly detached?: boolean;
}

export interface ThreadListEntry {
  readonly workspaceId: string;
  readonly session: SessionRecord;
  readonly environment: ThreadEnvironmentMeta;
}

export interface WorktreeThreadSubgroup {
  readonly worktreeId: string;
  readonly worktreeName: string;
  readonly branchName?: string;
  readonly threads: readonly ThreadListEntry[];
}

export interface ThreadGroup {
  readonly rootWorkspace: WorkspaceRecord;
  readonly threads: readonly ThreadListEntry[];
  readonly worktreeSubgroups: readonly WorktreeThreadSubgroup[];
  readonly snoozedThreads: readonly ThreadListEntry[];
  readonly archivedThreads: readonly ThreadListEntry[];
}

export function buildThreadGroups(state: DesktopAppState): readonly ThreadGroup[] {
  const chatWorkspaceIds = new Set(
    state.chats.map((chat) => chat.chatWorkspaceId).filter((id): id is string => Boolean(id)),
  );
  // Chat workspaces are sessions rooted under a "/chats/" directory in app
  // support. They surface in the dedicated Chats section, never the Threads
  // list — exclude them here so they don't leak in as primary workspaces.
  const isChatWorkspace = (workspace: WorkspaceRecord): boolean =>
    chatWorkspaceIds.has(workspace.id) || /[/\\]chats[/\\][^/\\]+[/\\]?$/.test(workspace.path);
  const workspacesById = new Map(state.workspaces.map((workspace) => [workspace.id, workspace] as const));
  const rootWorkspaces = state.workspaces.filter(
    (workspace) => workspace.kind === "primary" && !isChatWorkspace(workspace),
  );
  const orphanWorktrees = state.workspaces.filter(
    (workspace) => workspace.kind === "worktree" && !workspacesById.has(workspace.rootWorkspaceId ?? ""),
  );

  const order = state.workspaceOrder;
  const sortedRoots = [...rootWorkspaces].sort((a, b) => {
    const ai = order.indexOf(a.id);
    const bi = order.indexOf(b.id);
    // Workspaces not in the order list come first (newly added)
    if (ai === -1 && bi === -1) return 0;
    if (ai === -1) return -1;
    if (bi === -1) return 1;
    return ai - bi;
  });

  return [
    ...sortedRoots.map((workspace) => buildRootGroup(state, workspacesById, workspace)),
    ...orphanWorktrees.map(buildOrphanGroup),
  ];
}

function buildRootGroup(
  state: DesktopAppState,
  workspacesById: ReadonlyMap<string, WorkspaceRecord>,
  rootWorkspace: WorkspaceRecord,
): ThreadGroup {
  const linkedWorkspaces = (state.worktreesByWorkspace[rootWorkspace.id] ?? [])
    .map((worktree) => ({
      worktree,
      workspace: worktree.linkedWorkspaceId ? workspacesById.get(worktree.linkedWorkspaceId) : undefined,
    }))
    .filter((entry): entry is { worktree: NonNullable<(typeof state.worktreesByWorkspace)[string][number]>; workspace: WorkspaceRecord } =>
      Boolean(entry.workspace),
    );

  const threads: ThreadListEntry[] = [
    ...rootWorkspace.sessions.map((session) => ({
      workspaceId: rootWorkspace.id,
      session,
      environment: {
        kind: "local" as const,
        label: "Local",
      },
    })),
    ...linkedWorkspaces.flatMap(({ workspace, worktree }) =>
      workspace.sessions.map((session) => ({
        workspaceId: workspace.id,
        session,
        environment: {
          kind: "worktree" as const,
          label: worktree.name,
          branchName: worktree.branchName,
          detached: !worktree.branchName,
        },
      })),
    ),
  ];

  threads.sort((left, right) => {
    if (left.session.updatedAt !== right.session.updatedAt) {
      return right.session.updatedAt.localeCompare(left.session.updatedAt);
    }
    return left.session.title.localeCompare(right.session.title);
  });

  const partitioned = partitionThreads(rootWorkspace, threads);
  return { ...partitioned, worktreeSubgroups: buildWorktreeSubgroups(partitioned.threads) };
}

function buildOrphanGroup(workspace: WorkspaceRecord): ThreadGroup {
  const entries = workspace.sessions.map((session) => ({
    workspaceId: workspace.id,
    session,
    environment: {
      kind: "worktree" as const,
      label: workspace.name,
      branchName: workspace.branchName,
      detached: !workspace.branchName,
    },
  }));
  const partitioned = partitionThreads(workspace, entries);
  return { ...partitioned, worktreeSubgroups: buildWorktreeSubgroups(partitioned.threads) };
}

function partitionThreads(rootWorkspace: WorkspaceRecord, entries: readonly ThreadListEntry[]): ThreadGroup {
  const now = Date.now();
  return {
    rootWorkspace,
    threads: entries.filter((entry) => !entry.session.archivedAt && (!entry.session.snoozedUntil || new Date(entry.session.snoozedUntil).getTime() <= now)),
    worktreeSubgroups: [],
    snoozedThreads: entries.filter((entry) => !entry.session.archivedAt && entry.session.snoozedUntil && new Date(entry.session.snoozedUntil).getTime() > now),
    archivedThreads: entries.filter((entry) => Boolean(entry.session.archivedAt)),
  };
}

function buildWorktreeSubgroups(threads: readonly ThreadListEntry[]): readonly WorktreeThreadSubgroup[] {
  const byWorktree = new Map<string, { name: string; branchName?: string; threads: ThreadListEntry[] }>();
  for (const thread of threads) {
    if (thread.environment.kind !== "worktree") continue;
    const key = thread.environment.label;
    let group = byWorktree.get(key);
    if (!group) {
      group = { name: key, branchName: thread.environment.branchName, threads: [] };
      byWorktree.set(key, group);
    }
    group.threads.push(thread);
  }
  return [...byWorktree.entries()].map(([key, group]) => ({
    worktreeId: key,
    worktreeName: group.name,
    branchName: group.branchName,
    threads: group.threads,
  }));
}

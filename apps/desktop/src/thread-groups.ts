import type { DesktopAppState, PlanRecord, SessionRecord, WorkspaceRecord } from "./desktop-state";

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

export interface ThreadGroup {
  readonly rootWorkspace: WorkspaceRecord;
  readonly threads: readonly ThreadListEntry[];
  readonly archivedThreads: readonly ThreadListEntry[];
  /** When present, this group represents a plan with nested issue sessions. */
  readonly plan?: PlanRecord;
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

  const planGroups = buildPlanGroups(state, workspacesById);

  return [
    ...planGroups,
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

  return partitionThreads(rootWorkspace, threads);
}

function buildOrphanGroup(workspace: WorkspaceRecord): ThreadGroup {
  return partitionThreads(
    workspace,
    workspace.sessions.map((session) => ({
      workspaceId: workspace.id,
      session,
      environment: {
        kind: "worktree",
        label: workspace.name,
        branchName: workspace.branchName,
        detached: !workspace.branchName,
      },
    })),
  );
}

/**
 * Build ThreadGroups for plans. Each plan becomes an expandable group
 * with its issue sessions nested inside.
 */
function buildPlanGroups(
  state: DesktopAppState,
  workspacesById: ReadonlyMap<string, WorkspaceRecord>,
): ThreadGroup[] {
  const plans = state.plans ?? [];
  const planIdBySession = state.planIdBySession ?? {};

  return plans.map((plan) => {
    const workspace = workspacesById.get(plan.workspaceId);
    if (!workspace) {
      // Fallback: create a minimal workspace record
      return {
        rootWorkspace: {
          id: plan.workspaceId,
          name: plan.title,
          path: plan.directoryPath,
          lastOpenedAt: plan.updatedAt,
          kind: "primary" as const,
          sessions: [],
        },
        threads: [],
        archivedThreads: [],
        plan,
      };
    }

    // Find sessions belonging to this plan
    const planSessionIds = new Set(
      Object.entries(planIdBySession)
        .filter(([, pid]) => pid === plan.id)
        .map(([sid]) => sid),
    );

    const allSessions = workspace.sessions.filter(
      (session) => planSessionIds.has(session.id),
    );

    // Also include sessions referenced by plan issues directly
    const issueSessionIds = new Set(
      plan.issues.map((issue) => issue.sessionId).filter((id): id is string => Boolean(id)),
    );
    for (const session of workspace.sessions) {
      if (issueSessionIds.has(session.id) && !planSessionIds.has(session.id)) {
        allSessions.push(session);
      }
    }

    const entries: ThreadListEntry[] = allSessions.map((session) => ({
      workspaceId: plan.workspaceId,
      session,
      environment: {
        kind: "local" as const,
        label: "Issue",
      },
    }));

    entries.sort((left, right) => {
      // Sort by plan issue order
      const leftIssue = plan.issues.find((i) => i.sessionId === left.session.id);
      const rightIssue = plan.issues.find((i) => i.sessionId === right.session.id);
      if (leftIssue && rightIssue) return leftIssue.order - rightIssue.order;
      if (leftIssue) return -1;
      if (rightIssue) return 1;
      return right.session.updatedAt.localeCompare(left.session.updatedAt);
    });

    return {
      rootWorkspace: workspace,
      threads: entries.filter((entry) => !entry.session.archivedAt),
      archivedThreads: entries.filter((entry) => Boolean(entry.session.archivedAt)),
      plan,
    };
  });
}

function partitionThreads(rootWorkspace: WorkspaceRecord, entries: readonly ThreadListEntry[]): ThreadGroup {
  return {
    rootWorkspace,
    threads: entries.filter((entry) => !entry.session.archivedAt),
    archivedThreads: entries.filter((entry) => Boolean(entry.session.archivedAt)),
  };
}

import type { ChatRecord } from "../desktop-state";
import type { ThreadGroup } from "../thread-groups";

export interface SidebarNavEntry {
  readonly kind: "thread" | "chat";
  readonly workspaceId: string;
  readonly sessionId: string;
}

/**
 * Flatten thread groups + chats into one ordered navigation list.
 * Threads come first (in sidebar order across all workspaces), then chats.
 */
export function buildSidebarNavList(
  threadGroups: readonly ThreadGroup[],
  chats: readonly ChatRecord[],
): readonly SidebarNavEntry[] {
  const entries: SidebarNavEntry[] = [];
  for (const group of threadGroups) {
    for (const thread of group.threads) {
      entries.push({
        kind: "thread",
        workspaceId: thread.workspaceId,
        sessionId: thread.session.id,
      });
    }
  }
  for (const chat of chats) {
    if (!chat.archivedAt) {
      entries.push({
        kind: "chat",
        workspaceId: chat.chatWorkspaceId ?? "",
        sessionId: chat.id,
      });
    }
  }
  return entries;
}

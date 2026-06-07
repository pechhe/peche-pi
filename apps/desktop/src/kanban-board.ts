import type { ThreadGroup, ThreadListEntry } from "./thread-groups";

export type KanbanColumnId = "running" | "attention" | "idle" | "done";

export interface KanbanColumn {
  readonly id: KanbanColumnId;
  readonly title: string;
  readonly description: string;
  readonly threads: readonly ThreadListEntry[];
}

export function buildKanbanColumns(threadGroups: readonly ThreadGroup[]): readonly KanbanColumn[] {
  const columns: Record<KanbanColumnId, ThreadListEntry[]> = {
    running: [],
    attention: [],
    idle: [],
    done: [],
  };

  for (const group of threadGroups) {
    for (const thread of group.threads) {
      columns[columnIdForThread(thread)].push(thread);
    }
    for (const thread of group.archivedThreads) {
      columns.done.push(thread);
    }
  }

  return [
    {
      id: "running",
      title: "Running",
      description: "Threads in flight now",
      threads: columns.running,
    },
    {
      id: "attention",
      title: "Needs review",
      description: "Finished updates or prompts waiting",
      threads: columns.attention,
    },
    {
      id: "idle",
      title: "Idle",
      description: "Ready to continue",
      threads: columns.idle,
    },
    {
      id: "done",
      title: "Done",
      description: "Archived threads",
      threads: columns.done,
    },
  ];
}

function columnIdForThread(thread: ThreadListEntry): KanbanColumnId {
  if (thread.session.archivedAt) {
    return "done";
  }
  if (thread.session.status === "running") {
    return "running";
  }
  if (thread.session.hasUnseenUpdate || thread.session.isAwaitingAssistantText) {
    return "attention";
  }
  return "idle";
}

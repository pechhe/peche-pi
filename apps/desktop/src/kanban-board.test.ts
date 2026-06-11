import assert from "node:assert/strict";
import test from "node:test";

import { buildKanbanColumns } from "./kanban-board.ts";
import type { SessionRecord, WorkspaceRecord } from "./desktop-state.ts";
import type { ThreadGroup, ThreadListEntry } from "./thread-groups.ts";

const workspace: WorkspaceRecord = {
  id: "ws-1",
  name: "Project",
  path: "/tmp/project",
  lastOpenedAt: "2026-01-01T00:00:00.000Z",
  kind: "primary",
  sessions: [],
};

function session(id: string, overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id,
    title: id,
    updatedAt: "2026-01-01T00:00:00.000Z",
    preview: "",
    status: "idle",
    hasUnseenUpdate: false,
    isAwaitingAssistantText: false,
    ...overrides,
  };
}

function thread(record: SessionRecord): ThreadListEntry {
  return {
    workspaceId: workspace.id,
    session: record,
    environment: { kind: "local", label: "Local" },
  };
}

test("buildKanbanColumns groups threads by existing session state", () => {
  const group: ThreadGroup = {
    rootWorkspace: workspace,
    threads: [
      thread(session("running", { status: "running" })),
      thread(session("unseen", { hasUnseenUpdate: true })),
      thread(session("awaiting", { isAwaitingAssistantText: true })),
      thread(session("idle")),
    ],
    worktreeSubgroups: [],
    archivedThreads: [thread(session("done", { archivedAt: "2026-01-02T00:00:00.000Z" }))],
    snoozedThreads: [],
  };

  const columns = buildKanbanColumns([group]);

  assert.deepEqual(columns.map((column) => column.id), ["running", "attention", "idle", "done"]);
  assert.deepEqual(columns[0]?.threads.map((entry) => entry.session.id), ["running"]);
  assert.deepEqual(columns[1]?.threads.map((entry) => entry.session.id), ["unseen", "awaiting"]);
  assert.deepEqual(columns[2]?.threads.map((entry) => entry.session.id), ["idle"]);
  assert.deepEqual(columns[3]?.threads.map((entry) => entry.session.id), ["done"]);
});

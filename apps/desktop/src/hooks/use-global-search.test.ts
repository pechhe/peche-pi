import test from "node:test";
import assert from "node:assert/strict";
import type { DesktopAppState, SessionRecord, WorkspaceRecord } from "../desktop-state";
import { buildGlobalSearchResults } from "./use-global-search.ts";

const activeSession: SessionRecord = {
  id: "s-active",
  title: "Fix billing search",
  updatedAt: "2026-06-05T10:00:00.000Z",
  preview: "needle active preview",
  status: "idle",
  hasUnseenUpdate: false,
  isAwaitingAssistantText: false,
};

const pastSession: SessionRecord = {
  id: "s-past",
  title: "Past billing thread",
  updatedAt: "2026-06-04T10:00:00.000Z",
  archivedAt: "2026-06-04T11:00:00.000Z",
  preview: "needle past preview",
  status: "idle",
  hasUnseenUpdate: false,
  isAwaitingAssistantText: false,
};

const otherSession: SessionRecord = {
  id: "s-other",
  title: "Other needle project",
  updatedAt: "2026-06-03T10:00:00.000Z",
  preview: "other project",
  status: "idle",
  hasUnseenUpdate: false,
  isAwaitingAssistantText: false,
};

const selectedWorkspace: WorkspaceRecord = {
  id: "w-root",
  name: "Root",
  path: "/root",
  lastOpenedAt: "2026-06-05T09:00:00.000Z",
  kind: "primary",
  sessions: [activeSession, pastSession],
};

const otherWorkspace: WorkspaceRecord = {
  id: "w-other",
  name: "Other",
  path: "/other",
  lastOpenedAt: "2026-06-05T09:00:00.000Z",
  kind: "primary",
  sessions: [otherSession],
};

const state = {
  workspaces: [selectedWorkspace, otherWorkspace],
  chats: [
    {
      id: "chat-active",
      title: "needle chat",
      createdAt: "2026-06-05T08:00:00.000Z",
      updatedAt: "2026-06-05T12:00:00.000Z",
      preview: "chat preview",
      status: "idle",
      hasUnseenUpdate: false,
      isAwaitingAssistantText: false,
      chatWorkspaceId: "w-root",
    },
  ],
  selectedChatId: "",
} as unknown as DesktopAppState;

test("global search filters by current project and active/past state", () => {
  const active = buildGlobalSearchResults({
    state,
    selectedWorkspace,
    selectedSession: activeSession,
    query: "needle",
    scope: "project",
    archiveFilter: "active",
  });

  assert.deepEqual(active.results.map((result) => result.id), ["chat:chat-active", "thread:w-root:s-active"]);

  // "past" filter removed; "all" includes both active and past
  const all = buildGlobalSearchResults({
    state,
    selectedWorkspace,
    selectedSession: activeSession,
    query: "needle",
    scope: "project",
    archiveFilter: "all",
  });

  assert.deepEqual(all.results.map((result) => result.id), [
    "chat:chat-active",
    "thread:w-root:s-active",
    "thread:w-root:s-past",
  ]);
});

test("global search can expand to all projects with current project sorted first", () => {
  const search = buildGlobalSearchResults({
    state,
    selectedWorkspace,
    selectedSession: activeSession,
    query: "needle",
    scope: "all",
    archiveFilter: "all",
  });

  assert.deepEqual(search.results.map((result) => result.id), [
    "chat:chat-active",
    "thread:w-root:s-active",
    "thread:w-root:s-past",
    "thread:w-other:s-other",
  ]);

  // Current project items are flagged
  assert.ok(search.currentProjectIds.has("chat:chat-active"));
  assert.ok(search.currentProjectIds.has("thread:w-root:s-active"));
  assert.ok(search.currentProjectIds.has("thread:w-root:s-past"));
  assert.ok(!search.currentProjectIds.has("thread:w-other:s-other"));
});

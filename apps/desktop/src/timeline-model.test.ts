import { test } from "node:test";
import assert from "node:assert/strict";
import type { SessionDriverEvent, SessionQueuedMessage, SessionRef, SessionSnapshot } from "@pi-gui/session-driver";
import {
  appendAssistantDeltaToTimeline,
  appendQueuedUserMessageToTimeline,
  appendReasoningDeltaToTimeline,
  applySessionEventToTimeline,
  createTimelineViewModel,
  summariseToolBurst,
  type SessionTimelineRuntimeState,
  type TimelineItemFactory,
  type TranscriptMessage,
} from "./timeline-model.ts";

const sessionRef: SessionRef = { workspaceId: "workspace-1", sessionId: "session-1" };

const factory: TimelineItemFactory = {
  message: (role, text) => ({
    kind: "message",
    id: `${role}-${text}`,
    role,
    text,
    createdAt: "2026-01-01T00:00:00.000Z",
  }),
  messageWithAttachments: (role, text, attachments) => ({
    kind: "message",
    id: `${role}-${text}`,
    role,
    text,
    createdAt: "2026-01-01T00:00:00.000Z",
    attachments: attachments.map((attachment) => ({ ...attachment })),
  }),
  activity: (label, options = {}) => ({
    kind: "activity",
    id: `activity-${label}`,
    label,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...options,
  }),
  summary: (label, options = {}) => ({
    kind: "summary",
    id: `summary-${label}`,
    label,
    createdAt: "2026-01-01T00:00:00.000Z",
    presentation: options.presentation ?? "inline",
    ...(options.metadata ? { metadata: options.metadata } : {}),
  }),
  tool: (callId, toolName, status, label, options = {}) => ({
    kind: "tool",
    id: callId,
    callId,
    toolName,
    status,
    label,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...options,
  }),
  reasoning: (text) => ({
    kind: "reasoning",
    id: `reasoning-${text.slice(0, 8)}`,
    text,
    createdAt: "2026-01-01T00:00:00.000Z",
  }),
};

function snapshot(partial: Partial<SessionSnapshot> = {}): SessionSnapshot {
  return {
    ref: sessionRef,
    workspace: { workspaceId: sessionRef.workspaceId, path: "/tmp/workspace" },
    title: "Session",
    status: "idle",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

function event(event: Partial<SessionDriverEvent> & Pick<SessionDriverEvent, "type"> & { timestamp?: string }): SessionDriverEvent {
  return {
    sessionRef,
    timestamp: "2026-01-01T00:00:00.000Z",
    ...event,
  } as SessionDriverEvent;
}

test("timeline model accumulates reasoning deltas into a single row until something else happens", () => {
  const runtime: SessionTimelineRuntimeState = {};
  const first = appendReasoningDeltaToTimeline([], runtime, "Let me think", factory);
  const second = appendReasoningDeltaToTimeline(first, runtime, " about this.", factory);

  assert.equal(second.length, 1);
  assert.equal(second[0]!.kind, "reasoning");
  assert.equal(second[0]!.kind === "reasoning" ? second[0]!.text : undefined, "Let me think about this.");

  // An assistant delta should close the reasoning block, so the next reasoning
  // chunk opens a fresh row.
  const third = appendAssistantDeltaToTimeline(second, runtime, "Here is the answer.", factory);
  assert.equal(runtime.activeReasoningMessageId, undefined);
  const fourth = appendReasoningDeltaToTimeline(third, runtime, "Second pass.", factory);
  const reasoningRows = fourth.filter((item) => item.kind === "reasoning");
  assert.equal(reasoningRows.length, 2);
});

test("timeline model appends assistant deltas to the active assistant row", () => {
  const runtime: SessionTimelineRuntimeState = {};
  const first = appendAssistantDeltaToTimeline([], runtime, "Hello", factory);
  const second = appendAssistantDeltaToTimeline(first, runtime, " world", factory);

  assert.equal(second.length, 1);
  assert.equal(second[0]!.kind, "message");
  assert.equal(second[0]!.kind === "message" ? second[0]!.role : undefined, "assistant");
  assert.equal(second[0]!.kind === "message" ? second[0]!.text : undefined, "Hello world");
  assert.equal(runtime.activeAssistantMessageId, second[0]!.id);
});

test("timeline model upserts queued user messages with attachments", () => {
  const queued: SessionQueuedMessage = {
    id: "queued-1",
    mode: "followUp",
    text: "updated text",
    attachments: [{ kind: "file", name: "a.ts", mimeType: "text/typescript", fsPath: "/tmp/a.ts" }],
    createdAt: "2026-01-01T00:00:01.000Z",
    updatedAt: "2026-01-01T00:00:02.000Z",
  };
  const existing: TranscriptMessage[] = [{ kind: "message", id: "queued-1", role: "user", text: "old", createdAt: queued.createdAt }];

  const next = appendQueuedUserMessageToTimeline(existing, queued);

  assert.equal(next.length, 1);
  assert.equal(next[0]!.kind === "message" ? next[0]!.text : undefined, "updated text");
  assert.equal(next[0]!.kind === "message" ? next[0]!.attachments?.[0]?.kind : undefined, "file");
});

test("timeline model creates tool lifecycle rows and run summaries", () => {
  const runtime: SessionTimelineRuntimeState = {};
  let transcript: readonly TranscriptMessage[] = [];

  transcript = applySessionEventToTimeline(
    transcript,
    event({ type: "sessionUpdated", snapshot: snapshot({ status: "running", runningRunId: "run-1" }) }),
    runtime,
    factory,
  );
  transcript = applySessionEventToTimeline(
    transcript,
    event({ type: "toolStarted", callId: "call-1", toolName: "read", input: { path: "src/file.ts" } }),
    runtime,
    factory,
  );
  assert.equal(transcript[0]!.kind === "tool" ? transcript[0]!.label : undefined, "Reading src/file.ts");

  transcript = applySessionEventToTimeline(
    transcript,
    event({ type: "toolUpdated", callId: "call-1", text: "Halfway" }),
    runtime,
    factory,
  );
  transcript = applySessionEventToTimeline(
    transcript,
    event({ type: "toolFinished", callId: "call-1", success: true, output: "done" }),
    runtime,
    factory,
  );
  transcript = applySessionEventToTimeline(
    transcript,
    event({ type: "runCompleted", snapshot: snapshot({ status: "idle" }), timestamp: "2026-01-01T00:00:05.000Z" }),
    runtime,
    factory,
  );

  assert.equal(transcript[0]!.kind, "tool");
  const tool = transcript[0]!;
  assert.equal(tool.kind === "tool" ? tool.toolName : undefined, "read");
  assert.equal(tool.kind === "tool" ? tool.status : undefined, "success");
  assert.equal(tool.kind === "tool" ? tool.label : undefined, "Read src/file.ts");
  assert.equal(tool.kind === "tool" ? tool.detail : undefined, "done");
  assert.deepEqual(
    transcript.filter((item) => item.kind === "summary").map((item) => item.label),
    ["Worked for 5s"],
  );
  assert.equal(runtime.runMetrics, undefined);
  assert.equal(runtime.runningSince, undefined);
});

test("timeline model surfaces run failures as error activity", () => {
  const runtime: SessionTimelineRuntimeState = {
    runMetrics: { startedAt: "2026-01-01T00:00:00.000Z", toolCount: 0, searchCount: 0, fileCount: 0 },
    runningSince: "2026-01-01T00:00:00.000Z",
  };

  const transcript = applySessionEventToTimeline(
    [],
    event({ type: "runFailed", error: { message: "Boom", code: "E_FAIL" }, timestamp: "2026-01-01T00:01:00.000Z" }),
    runtime,
    factory,
  );

  assert.equal(transcript[0]!.kind, "activity");
  assert.equal(transcript[0]!.kind === "activity" ? transcript[0]!.tone : undefined, "error");
  assert.equal(transcript[0]!.kind === "activity" ? transcript[0]!.metadata : undefined, "Worked for 1m");
  assert.equal(runtime.runMetrics, undefined);
});

test("timeline model extracts reopened transcript meta activity and groups non-trailing tool bursts", () => {
  const transcript: TranscriptMessage[] = [
    { kind: "message", id: "user-1", role: "user", text: "Hi", createdAt: "2026-01-01T00:00:00.000Z" },
    { kind: "activity", id: "resume-1", label: "Resumed session", metadata: "9:00 AM", createdAt: "2026-01-01T00:00:01.000Z" },
    { kind: "tool", id: "read-1", callId: "read-1", toolName: "read", status: "success", label: "Read a.ts", createdAt: "2026-01-01T00:00:02.000Z" },
    { kind: "tool", id: "bash-1", callId: "bash-1", toolName: "bash", status: "success", label: "Ran tests", createdAt: "2026-01-01T00:00:03.000Z" },
    { kind: "message", id: "assistant-1", role: "assistant", text: "Done", createdAt: "2026-01-01T00:00:04.000Z" },
  ];

  const model = createTimelineViewModel(transcript);

  assert.deepEqual(model.metaEvents.map((item) => item.label), ["Resumed session"]);
  assert.equal(model.rows[1]!.kind, "toolBurst");
  assert.equal(model.rows[1]!.kind === "toolBurst" ? model.rows[1]!.tools.length : undefined, 2);
  assert.equal(model.rows[1]!.kind === "toolBurst" ? summariseToolBurst(model.rows[1]!) : undefined, "2 tool calls (read×1, bash×1)");
});

test("timeline model wraps reasoning and its tools into a thinking section", () => {
  const transcript: TranscriptMessage[] = [
    { kind: "message", id: "user-1", role: "user", text: "Hi", createdAt: "2026-01-01T00:00:00.000Z" },
    { kind: "reasoning", id: "r-1", text: "Let me look.", createdAt: "2026-01-01T00:00:01.000Z" },
    { kind: "tool", id: "read-1", callId: "read-1", toolName: "read", status: "success", label: "Read a.ts", createdAt: "2026-01-01T00:00:03.000Z" },
    { kind: "reasoning", id: "r-2", text: "Got it.", createdAt: "2026-01-01T00:00:05.000Z" },
    { kind: "message", id: "assistant-1", role: "assistant", text: "Done", createdAt: "2026-01-01T00:00:06.000Z" },
  ];

  const model = createTimelineViewModel(transcript);

  assert.deepEqual(model.rows.map((item) => item.kind), ["message", "thinkingSection", "message"]);
  const section = model.rows[1]!;
  assert.equal(section.kind === "thinkingSection" ? section.children.length : undefined, 3);
  // Not trailing: an assistant answer follows, so it collapses.
  assert.equal(section.kind === "thinkingSection" ? section.trailing : undefined, false);
});

test("timeline model keeps an active thinking section trailing until the answer arrives", () => {
  const transcript: TranscriptMessage[] = [
    { kind: "message", id: "user-1", role: "user", text: "Hi", createdAt: "2026-01-01T00:00:00.000Z" },
    { kind: "reasoning", id: "r-1", text: "Thinking\u2026", createdAt: "2026-01-01T00:00:01.000Z" },
    { kind: "tool", id: "read-1", callId: "read-1", toolName: "read", status: "running", label: "Read a.ts", createdAt: "2026-01-01T00:00:03.000Z" },
  ];

  const model = createTimelineViewModel(transcript);

  assert.deepEqual(model.rows.map((item) => item.kind), ["message", "thinkingSection"]);
  assert.equal(model.rows[1]!.kind === "thinkingSection" ? model.rows[1]!.trailing : undefined, true);
});

test("timeline model keeps inline edits and appends an edited-files box after the assistant reply", () => {
  const transcript: TranscriptMessage[] = [
    { kind: "message", id: "user-1", role: "user", text: "Fix", createdAt: "2026-01-01T00:00:00.000Z" },
    { kind: "tool", id: "edit-1", callId: "edit-1", toolName: "edit", status: "success", label: "Edited a.ts", input: { file_path: "a.ts" }, createdAt: "2026-01-01T00:00:02.000Z" },
    { kind: "message", id: "assistant-1", role: "assistant", text: "Done", createdAt: "2026-01-01T00:00:04.000Z" },
  ];

  const model = createTimelineViewModel(transcript);

  // The edit stays inline as a quiet tool line, and the prominent edited-files
  // box is appended after the assistant reply.
  assert.deepEqual(model.rows.map((item) => item.kind), ["message", "tool", "message", "editedFiles"]);
  const box = model.rows[3]!;
  assert.equal(box.kind === "editedFiles" ? box.tools.length : undefined, 1);
  assert.equal(box.kind === "editedFiles" ? box.tools[0]!.callId : undefined, "edit-1");
});

test("timeline model does not show the edited-files box while the run is still working", () => {
  const transcript: TranscriptMessage[] = [
    { kind: "message", id: "user-1", role: "user", text: "Fix", createdAt: "2026-01-01T00:00:00.000Z" },
    { kind: "reasoning", id: "r-1", text: "Editing now.", createdAt: "2026-01-01T00:00:01.000Z" },
    { kind: "tool", id: "edit-1", callId: "edit-1", toolName: "edit", status: "success", label: "Edited a.ts", input: { file_path: "a.ts" }, createdAt: "2026-01-01T00:00:02.000Z" },
  ];

  const model = createTimelineViewModel(transcript);

  // Tail is a live thinking section, so no box yet — it appears once the answer lands.
  assert.deepEqual(model.rows.map((item) => item.kind), ["message", "thinkingSection"]);
});

test("timeline model summarises completed file bursts semantically", () => {
  const transcript: TranscriptMessage[] = [
    { kind: "tool", id: "read-1", callId: "read-1", toolName: "read", status: "success", label: "Read a.ts", input: { path: "a.ts" }, createdAt: "2026-01-01T00:00:02.000Z" },
    { kind: "tool", id: "read-2", callId: "read-2", toolName: "read", status: "success", label: "Read b.ts", input: { path: "b.ts" }, createdAt: "2026-01-01T00:00:03.000Z" },
    { kind: "message", id: "assistant-1", role: "assistant", text: "Done", createdAt: "2026-01-01T00:00:04.000Z" },
  ];

  const model = createTimelineViewModel(transcript);

  assert.equal(model.rows[0]!.kind === "toolBurst" ? summariseToolBurst(model.rows[0]!) : undefined, "Explored 2 files");
});

test("timeline model keeps trailing tool calls visible for active runs", () => {
  const transcript: TranscriptMessage[] = [
    { kind: "message", id: "user-1", role: "user", text: "Hi", createdAt: "2026-01-01T00:00:00.000Z" },
    { kind: "tool", id: "read-1", callId: "read-1", toolName: "read", status: "running", label: "Read a.ts", createdAt: "2026-01-01T00:00:02.000Z" },
    { kind: "tool", id: "bash-1", callId: "bash-1", toolName: "bash", status: "running", label: "Ran tests", createdAt: "2026-01-01T00:00:03.000Z" },
  ];

  const model = createTimelineViewModel(transcript);

  assert.deepEqual(model.rows.map((item) => item.kind), ["message", "tool", "tool"]);
});

import type { SessionDriverEvent, SessionQueuedMessage } from "@pi-gui/session-driver";
import type { TranscriptMessage } from "./timeline-types";
export type { TranscriptMessage } from "./timeline-types";

// Tools that produce a lot of low-signal calls; rolled into a "×N" count when
// a burst is collapsed.
const QUIET_TOOL_PATTERNS: readonly RegExp[] = [
  /^bash$/i,
  /^shell$/i,
  /^read$/i,
  /^grep$/i,
  /^glob$/i,
  /^ls$/i,
  /^find$/i,
  /^cymbal[_-]?/i,
];

// Activity labels we treat as infra/meta chatter and hide from the inline
// transcript. They're surfaced in the context-indicator hover instead. Errors
// and unknown labels stay inline.
const META_ACTIVITY_LABELS: ReadonlySet<string> = new Set(["Resumed session", "Stopped"]);

export interface RunMetrics {
  readonly startedAt: string;
  toolCount: number;
  searchCount: number;
  fileCount: number;
}

export interface SessionTimelineRuntimeState {
  runMetrics?: RunMetrics;
  runningSince?: string;
  activeAssistantMessageId?: string;
  activeReasoningMessageId?: string;
}

export interface TimelineItemFactory {
  readonly message: (role: "user" | "assistant", text: string) => TranscriptMessage;
  readonly messageWithAttachments: (
    role: "user" | "assistant",
    text: string,
    attachments: NonNullable<Extract<TranscriptMessage, { kind: "message" }>["attachments"]>,
  ) => TranscriptMessage;
  readonly activity: (
    label: string,
    options?: Pick<Extract<TranscriptMessage, { kind: "activity" }>, "detail" | "metadata" | "tone" | "noise" | "retry">,
  ) => TranscriptMessage;
  readonly summary: (
    label: string,
    options?: Partial<Pick<Extract<TranscriptMessage, { kind: "summary" }>, "metadata" | "presentation">>,
  ) => TranscriptMessage;
  readonly tool: (
    callId: string,
    toolName: string,
    status: "running" | "success" | "error",
    label: string,
    options?: Pick<Extract<TranscriptMessage, { kind: "tool" }>, "detail" | "metadata" | "input" | "output">,
  ) => TranscriptMessage;
  readonly reasoning: (text: string) => TranscriptMessage;
}

export function appendUserMessageToTimeline(
  transcript: readonly TranscriptMessage[],
  text: string,
  attachments: NonNullable<Extract<TranscriptMessage, { kind: "message" }>["attachments"]> = [],
  factory: TimelineItemFactory,
): TranscriptMessage[] {
  const next = [...transcript];
  next.push(attachments.length > 0 ? factory.messageWithAttachments("user", text, attachments) : factory.message("user", text));
  return next;
}

export function appendQueuedUserMessageToTimeline(
  transcript: readonly TranscriptMessage[],
  message: SessionQueuedMessage,
): TranscriptMessage[] {
  const next = [...transcript];
  const existingIndex = next.findIndex((item) => item.kind === "message" && item.id === message.id);
  const nextMessage = {
    kind: "message" as const,
    id: message.id,
    role: "user" as const,
    text: message.text,
    createdAt: message.createdAt,
    ...(message.attachments?.length
      ? {
          attachments: message.attachments.map((attachment) => ({ ...attachment })),
        }
      : {}),
  };

  if (existingIndex >= 0) {
    next[existingIndex] = nextMessage;
  } else {
    next.push(nextMessage);
  }
  return next;
}

/**
 * Drop a trailing transient auto-retry activity row, if present. Retry rows are
 * never persisted and only exist between an `auto_retry_start` and the next
 * transcript event, so any subsequent mutation removes them.
 */
function stripTrailingRetry(transcript: readonly TranscriptMessage[]): TranscriptMessage[] {
  const last = transcript[transcript.length - 1];
  if (last && last.kind === "activity" && last.retry) {
    return transcript.slice(0, -1);
  }
  return [...transcript];
}

export function appendAssistantDeltaToTimeline(
  transcript: readonly TranscriptMessage[],
  runtime: SessionTimelineRuntimeState,
  text: string,
  factory: TimelineItemFactory,
): TranscriptMessage[] {
  const next = stripTrailingRetry(transcript);
  // Any assistant text closes out a streaming reasoning block; the next
  // reasoning chunk should open a fresh row.
  clearActiveReasoningMessage(runtime);
  const activeId = runtime.activeAssistantMessageId;

  if (activeId) {
    const index = next.findIndex((message) => message.id === activeId);
    const current = index >= 0 ? next[index] : undefined;
    if (current?.kind === "message") {
      next[index] = {
        ...current,
        text: `${current.text}${text}`,
      };
    } else {
      const message = factory.message("assistant", text);
      next.push(message);
      runtime.activeAssistantMessageId = message.id;
    }
  } else {
    const message = factory.message("assistant", text);
    next.push(message);
    runtime.activeAssistantMessageId = message.id;
  }

  return next;
}

export function appendReasoningDeltaToTimeline(
  transcript: readonly TranscriptMessage[],
  runtime: SessionTimelineRuntimeState,
  text: string,
  factory: TimelineItemFactory,
): TranscriptMessage[] {
  if (!text) {
    return transcript.slice();
  }
  // Assistant text and reasoning text live in separate rows; arriving
  // reasoning means the model paused any prior text reply.
  clearActiveAssistantMessage(runtime);

  const next = stripTrailingRetry(transcript);
  const activeId = runtime.activeReasoningMessageId;
  if (activeId) {
    const index = next.findIndex((item) => item.id === activeId);
    const current = index >= 0 ? next[index] : undefined;
    if (current?.kind === "reasoning") {
      next[index] = { ...current, text: `${current.text}${text}` };
      return next;
    }
  }

  const message = factory.reasoning(text);
  if (message.kind !== "reasoning") {
    return next;
  }
  next.push(message);
  runtime.activeReasoningMessageId = message.id;
  return next;
}

export function applySessionEventToTimeline(
  transcript: readonly TranscriptMessage[],
  event: SessionDriverEvent,
  runtime: SessionTimelineRuntimeState,
  factory: TimelineItemFactory,
): TranscriptMessage[] {
  if (event.type === "assistantDelta") {
    return transcript.slice();
  }
  if (event.type === "reasoningDelta") {
    return transcript.slice();
  }

  // Any non-retry event supersedes a transient auto-retry line: the run has
  // either resumed (tool/message/run events) or finished. Strip it first so a
  // stale "Connection error · retrying" row never lingers.
  const next = stripTrailingRetry(transcript);

  switch (event.type) {
    case "sessionOpened":
      next.push(factory.activity("Resumed session", { metadata: relativeDetail(event.timestamp) }));
      break;
    case "runRetrying": {
      // The failed attempt that triggered this retry was just pushed as an error
      // activity row (runtimes emit the run failure before the retry signal).
      // Absorb it so the user sees a single updating retry line instead of a
      // growing wall of per-attempt errors.
      const tail = next[next.length - 1];
      if (tail && tail.kind === "activity" && tail.tone === "error") {
        next.pop();
      }
      // Replace any prior retry row (handled by stripTrailingRetry above) with a
      // fresh one so the renderer remounts and restarts the live countdown.
      const deadline = new Date(new Date(event.timestamp).getTime() + event.delayMs).toISOString();
      next.push(
        factory.activity("Connection error", {
          tone: "error",
          retry: { attempt: event.attempt, maxAttempts: event.maxAttempts, deadline },
        }),
      );
      break;
    }
    case "sessionUpdated":
      if (event.snapshot.status === "running" && event.snapshot.runningRunId && !runtime.runningSince) {
        runtime.runningSince = event.timestamp;
        runtime.runMetrics = {
          startedAt: event.timestamp,
          toolCount: 0,
          searchCount: 0,
          fileCount: 0,
        };
      }
      break;
    case "queuedMessageStarted":
      clearActiveAssistantMessage(runtime);
      clearActiveReasoningMessage(runtime);
      return appendQueuedUserMessageToTimeline(next, event.message);
    case "toolStarted": {
      clearActiveAssistantMessage(runtime);
      clearActiveReasoningMessage(runtime);
      const metrics = runtime.runMetrics ?? {
        startedAt: event.timestamp,
        toolCount: 0,
        searchCount: 0,
        fileCount: 0,
      };
      metrics.toolCount += 1;
      if (looksLikeSearch(event.toolName, event.input)) {
        metrics.searchCount += 1;
      }
      if (looksLikeFileExplore(event.toolName, event.input)) {
        metrics.fileCount += 1;
      }
      runtime.runMetrics = metrics;
      upsertToolRow(next, event.callId, factory, event.toolName, "running", runningToolLabel(event.toolName, event.input), undefined, event.input);
      break;
    }
    case "toolUpdated":
      upsertToolRow(next, event.callId, factory, undefined, "running", undefined, event.text ?? progressLabel(event.progress));
      break;
    case "toolFinished":
      upsertToolRow(
        next,
        event.callId,
        factory,
        undefined,
        event.success ? "success" : "error",
        undefined,
        detailFromOutput(event.output),
        undefined,
        event.output,
      );
      break;
    case "runCompleted": {
      const metrics = runtime.runMetrics;
      clearRunState(runtime);
      // Suppress the "Worked for" divider when a subagent is still running —
      // the run ended because the main agent yielded to await the subagent,
      // not because the turn is actually done.
      if (!transcriptHasRunningSubagent(next)) {
        if (metrics) {
          next.push(factory.summary(workedForLabel(metrics.startedAt, event.timestamp), { presentation: "divider" }));
        } else {
          next.push(factory.summary("Completed", {
            presentation: "divider",
            metadata: relativeDetail(event.timestamp),
          }));
        }
      }
      break;
    }
    case "runFailed": {
      const metrics = runtime.runMetrics;
      clearRunState(runtime);
      // Provider retries (e.g. rate-limit 429s) fire one runFailed per attempt,
      // each carrying the same summarized message. Collapse consecutive
      // identical error activities so the transcript shows a single line
      // instead of a wall of repeated failures.
      const last = next[next.length - 1];
      if (last && last.kind === "activity" && last.tone === "error" && last.label === event.error.message) {
        break;
      }
      next.push(
        factory.activity(event.error.message, {
          tone: "error",
          metadata: metrics ? workedForLabel(metrics.startedAt, event.timestamp) : undefined,
          detail: event.error.code,
        }),
      );
      break;
    }
    case "sessionClosed":
      clearRunState(runtime);
      next.push(factory.activity("Stopped", { metadata: relativeDetail(event.timestamp) }));
      break;
    case "hostUiRequest":
      if (event.request.kind === "notify") {
        // info-level notify events are background extension chatter
        // (pi-blackhole OM progress, pi-cymbal nudges, etc.). Tag them as
        // noise so the renderer can hide them in clean mode while still
        // keeping warnings/errors visible.
        const level = event.request.level ?? "info";
        const noise = level === "info";
        next.push(
          factory.activity(event.request.message, {
            metadata: relativeDetail(event.timestamp),
            ...(level === "warning" ? { tone: "warning" as const } : {}),
            ...(level === "error" ? { tone: "error" as const } : {}),
            ...(noise ? { noise: true } : {}),
          }),
        );
      }
      break;
    default:
      break;
  }

  return next;
}

// A run can complete because the main agent *yielded* to await an async
// subagent (the `subagent` tool returns `status: "started"` immediately and the
// row is never updated), not because the turn is actually done. Detect that
// case so the "Worked for" divider isn't shown prematurely.
//
// We scan from the tail rather than the whole transcript: an async launch's
// result row persists as "started" forever, so a plain `.some()` would suppress
// the divider on every *later* run too. By only treating a subagent as pending
// when it's the trailing work (no assistant reply or other tool after it), the
// next run — which appends content after the launch row — gets its divider.
function transcriptHasRunningSubagent(transcript: readonly TranscriptMessage[]): boolean {
  for (let i = transcript.length - 1; i >= 0; i -= 1) {
    const item = transcript[i]!;
    if (item.kind === "reasoning" || item.kind === "activity" || item.kind === "summary") {
      continue;
    }
    if (item.kind === "tool" && isSubagentToolName(item.toolName)) {
      return isPendingSubagentLaunch(item);
    }
    // Any other significant row (assistant message, non-subagent tool) means the
    // run progressed past the launch, so it's no longer a yield-to-subagent.
    return false;
  }
  return false;
}

function isPendingSubagentLaunch(item: Extract<TranscriptMessage, { kind: "tool" }>): boolean {
  if (item.status === "running") {
    return true;
  }
  const details =
    typeof item.output === "object" && item.output !== null
      ? (item.output as { details?: { status?: unknown } }).details
      : undefined;
  const status = details?.status;
  // Async launches report "started" (or "batch"); blocking launches report a
  // terminal status ("completed"/"failed"/"cancelled") and are not pending.
  return status === "started" || status === "batch" || status === "running";
}

function clearActiveReasoningMessage(runtime: SessionTimelineRuntimeState): void {
  runtime.activeReasoningMessageId = undefined;
}

function clearActiveAssistantMessage(runtime: SessionTimelineRuntimeState): void {
  runtime.activeAssistantMessageId = undefined;
}

function clearRunState(runtime: SessionTimelineRuntimeState): void {
  clearActiveAssistantMessage(runtime);
  clearActiveReasoningMessage(runtime);
  runtime.runningSince = undefined;
  runtime.runMetrics = undefined;
}

function upsertToolRow(
  transcript: TranscriptMessage[],
  callId: string,
  factory: TimelineItemFactory,
  toolName?: string,
  status?: "running" | "success" | "error",
  label?: string,
  detail?: string,
  input?: unknown,
  output?: unknown,
): void {
  const index = transcript.findIndex((item) => item.kind === "tool" && item.callId === callId);
  const existing = index >= 0 ? transcript[index] : undefined;
  const existingTool = existing?.kind === "tool" ? existing : undefined;
  const next = factory.tool(
    callId,
    toolName ?? (existingTool?.toolName ?? "tool"),
    status ?? (existingTool?.status ?? "running"),
    label ?? (status === "success" || status === "error"
      ? completedToolLabel(toolName ?? (existingTool?.toolName ?? "tool"), input ?? existingTool?.input, status)
      : (existingTool?.label ?? "Working")),
    {
      detail: detail ?? existingTool?.detail,
      metadata: existingTool?.metadata,
      input: input ?? existingTool?.input,
      output: output ?? existingTool?.output,
    },
  );

  if (index >= 0) {
    transcript[index] = {
      ...next,
      createdAt: existing?.createdAt ?? next.createdAt,
    };
    return;
  }

  transcript.push(next);
}

export function runningToolLabel(toolName: string, input: unknown): string {
  const detail = inputLabel(input);
  if (looksLikeSearch(toolName, input)) {
    return detail ? `Searching ${detail}` : `Searching with ${toolName}`;
  }
  if (looksLikeFileExplore(toolName, input)) {
    if (toolName.toLowerCase() === "read") {
      return detail ? `Reading ${detail}` : "Reading a file";
    }
    return detail ? `Exploring ${detail}` : `Exploring files with ${toolName}`;
  }
  return detail ? `Running ${toolName}: ${detail}` : `Running ${toolName}`;
}

export function completedToolLabel(toolName: string, input: unknown, status: "success" | "error"): string {
  const detail = inputLabel(input);
  if (status === "error") {
    if (looksLikeSearch(toolName, input)) {
      return detail ? `Failed searching ${detail}` : `Failed searching with ${toolName}`;
    }
    if (looksLikeFileExplore(toolName, input)) {
      if (toolName.toLowerCase() === "read") {
        return detail ? `Failed reading ${detail}` : "Failed reading a file";
      }
      return detail ? `Failed exploring ${detail}` : `Failed exploring files with ${toolName}`;
    }
    return detail ? `Failed running ${toolName}: ${detail}` : `Failed running ${toolName}`;
  }

  if (looksLikeSearch(toolName, input)) {
    return detail ? `Searched ${detail}` : `Searched with ${toolName}`;
  }
  if (looksLikeFileExplore(toolName, input)) {
    if (toolName.toLowerCase() === "read") {
      return detail ? `Read ${detail}` : "Read a file";
    }
    return detail ? `Explored ${detail}` : `Explored files with ${toolName}`;
  }
  return detail ? `Ran ${toolName}: ${detail}` : `Ran ${toolName}`;
}

function progressLabel(progress: number | undefined): string | undefined {
  if (progress === undefined) {
    return undefined;
  }
  if (progress <= 1) {
    return `${Math.round(progress * 100)}%`;
  }
  return String(progress);
}

function detailFromOutput(output: unknown): string | undefined {
  if (isRecord(output) && Array.isArray(output.content)) {
    const text = output.content
      .map((part) => (isRecord(part) && part.type === "text" && typeof part.text === "string" ? part.text : ""))
      .join(" ")
      .trim();
    if (text) {
      return truncate(text);
    }
  }
  if (typeof output === "string") {
    return truncate(output);
  }
  if (output === undefined || output === null) {
    return undefined;
  }
  return truncate(JSON.stringify(output));
}

function looksLikeSearch(toolName: string, input: unknown): boolean {
  if (toolName.toLowerCase().includes("search")) {
    return true;
  }
  return typeof input === "string" && /https?:\/\/|site:|query|search/i.test(input);
}

function looksLikeFileExplore(toolName: string, input: unknown): boolean {
  if (/(read|glob|ls|list|open)/i.test(toolName)) {
    return true;
  }
  return typeof input === "string" && /\/|\.md|\.ts|file/i.test(input);
}

function workedForLabel(startedAt: string, endedAt: string): string {
  return `Worked for ${formatElapsedDuration(startedAt, endedAt)}`;
}

function formatElapsedDuration(startedAt: string, endedAt: string): string {
  const diffMs = Math.max(0, Date.parse(endedAt) - Date.parse(startedAt));
  const seconds = Math.max(1, Math.round(diffMs / 1000));
  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return remaining === 0 ? `${minutes}m` : `${minutes}m ${remaining}s`;
}

function relativeDetail(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function truncate(value: string, limit = 160): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, limit - 1)}…`;
}

function inputLabel(input: unknown): string | undefined {
  if (typeof input === "string") {
    return truncate(input, 80);
  }
  if (!isRecord(input)) {
    return undefined;
  }

  const candidates = ["path", "filePath", "query", "q", "url", "command", "text", "title"];
  for (const key of candidates) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) {
      return truncate(value, 80);
    }
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isQuietTool(toolName: string): boolean {
  return QUIET_TOOL_PATTERNS.some((pattern) => pattern.test(toolName));
}

// Subagent launches are first-class events and must never be folded into a
// collapsed tool burst or thinking section; they render as standalone cards.
function isSubagentToolName(toolName: string): boolean {
  return toolName === "subagent" || toolName === "subagent_resume";
}

export interface TimelineMetaEvent {
  readonly id: string;
  readonly label: string;
  readonly detail?: string;
  readonly metadata?: string;
  readonly createdAt: string;
  readonly tone?: "neutral" | "success" | "warning" | "error";
}

export function isMetaActivity(item: TranscriptMessage): boolean {
  if (item.kind !== "activity") return false;
  if (item.tone === "error") return false;
  return META_ACTIVITY_LABELS.has(item.label);
}

export type ToolItem = Extract<TranscriptMessage, { kind: "tool" }>;
export type ReasoningItem = Extract<TranscriptMessage, { kind: "reasoning" }>;

export interface TimelineToolBurst {
  readonly kind: "toolBurst";
  readonly id: string;
  readonly tools: readonly ToolItem[];
  readonly trailing: boolean;
}

/**
 * A Codex-style "thinking" block: a contiguous run of reasoning deltas and the
 * tool calls the model made while working, before it produced its answer.
 * While the run is active and this is the tail of the timeline it renders
 * expanded with live-streaming reasoning; once the assistant answer follows it
 * collapses into a single "Thought for Ns" disclosure.
 */
export interface TimelineThinkingSection {
  readonly kind: "thinkingSection";
  readonly id: string;
  readonly children: readonly (ReasoningItem | ToolItem)[];
  readonly trailing: boolean;
}

/**
 * A prominent, turn-level summary of the files an assistant turn changed,
 * surfaced as a box after the assistant reply (Codex-style). The individual
 * edit tool calls still appear as quiet single lines inside the thought chain;
 * this row brings the net changes out as the actionable artifact.
 */
export interface TimelineEditedFiles {
  readonly kind: "editedFiles";
  readonly id: string;
  readonly tools: readonly ToolItem[];
}

export type TimelineRow = TranscriptMessage | TimelineToolBurst | TimelineThinkingSection | TimelineEditedFiles;

export interface TimelineViewModel {
  readonly rows: TimelineRow[];
  readonly metaEvents: TimelineMetaEvent[];
}

/**
 * Build product-visible timeline rows from persisted transcript messages and
 * runtime-created activity/tool/summary rows. This Module owns grouping and
 * meta extraction so renderer callers consume one timeline Interface.
 */
export function createTimelineViewModel(transcript: readonly TranscriptMessage[]): TimelineViewModel {
  const rows: TimelineRow[] = [];
  const metaEvents: TimelineMetaEvent[] = [];

  const filtered: TranscriptMessage[] = [];
  for (const item of transcript) {
    if (isMetaActivity(item) && item.kind === "activity") {
      metaEvents.push({
        id: item.id,
        label: item.label,
        ...(item.detail ? { detail: item.detail } : {}),
        ...(item.metadata ? { metadata: item.metadata } : {}),
        createdAt: item.createdAt,
        ...(item.tone ? { tone: item.tone } : {}),
      });
      continue;
    }
    filtered.push(item);
  }

  const displayItems = filtered;

  let i = 0;
  while (i < displayItems.length) {
    const item = displayItems[i]!;
    const isWork = item.kind === "tool" || item.kind === "reasoning";
    if (!isWork) {
      rows.push(item);
      i += 1;
      continue;
    }

    // Collect a contiguous block of "work": reasoning deltas and tool calls the
    // model produced between answers.
    const block: (ReasoningItem | ToolItem)[] = [];
    let hasReasoning = false;
    while (i < displayItems.length) {
      const next = displayItems[i]!;
      if (next.kind === "tool") {
        // A subagent tool breaks the block so it renders as its own card. If it
        // is the first item, emit a singleton block; otherwise stop and let the
        // next outer iteration handle it standalone.
        if (isSubagentToolName((next as ToolItem).toolName)) {
          if (block.length === 0) {
            block.push(next as ToolItem);
            i += 1;
          }
          break;
        }
        block.push(next as ToolItem);
        i += 1;
        continue;
      }
      if (next.kind === "reasoning") {
        hasReasoning = true;
        block.push(next as ReasoningItem);
        i += 1;
        continue;
      }
      break;
    }
    const trailing = i >= displayItems.length;

    if (hasReasoning) {
      // Codex-style thinking section: reasoning + the tools used while thinking.
      rows.push({
        kind: "thinkingSection",
        id: `think:${block[0]!.id}:${block[block.length - 1]!.id}`,
        children: block,
        trailing,
      });
      continue;
    }

    // Tool-only block: preserve the existing burst grouping behaviour.
    const tools = block as ToolItem[];
    if (tools.length === 1 || trailing) {
      for (const tool of tools) {
        rows.push(tool);
      }
    } else {
      rows.push({
        kind: "toolBurst",
        id: `burst:${tools[0]!.callId}:${tools[tools.length - 1]!.callId}`,
        tools,
        trailing: false,
      });
    }
  }

  return { rows: appendEditedFilesSummaries(rows), metaEvents };
}

/**
 * Backward-compatible name for renderer callers. New code should use
 * createTimelineViewModel to make the Interface owner explicit.
 */
export function groupTranscript(transcript: readonly TranscriptMessage[]): TimelineViewModel {
  return createTimelineViewModel(transcript);
}

/**
 * Codex-style edited-files boxes: completed edits stay inline as quiet lines,
 * but the net changes for a turn are also surfaced as a prominent box right
 * after the assistant reply that ends the turn. Edits are aggregated (not
 * moved), so the thought chain keeps its single-line trace.
 */
function appendEditedFilesSummaries(rows: readonly TimelineRow[]): TimelineRow[] {
  const result: TimelineRow[] = [];
  let pending: ToolItem[] = [];

  const flush = (anchorId: string) => {
    if (pending.length === 0) {
      return;
    }
    result.push({ kind: "editedFiles", id: `edits:${anchorId}`, tools: pending });
    pending = [];
  };

  for (const row of rows) {
    collectCompletedEdits(row, pending);
    result.push(row);
    if (row.kind === "message" && row.role === "assistant") {
      flush(row.id);
    }
  }

  // Flush any trailing edits unless the run is still working (the tail is a
  // live thinking section), so the box doesn't appear before the turn ends.
  const last = rows[rows.length - 1];
  if (!(last?.kind === "thinkingSection" && last.trailing)) {
    flush(last?.id ?? "end");
  }
  return result;
}

function collectCompletedEdits(row: TimelineRow, into: ToolItem[]): void {
  if (row.kind === "tool") {
    if (isCompletedWriteTool(row)) into.push(row);
    return;
  }
  if (row.kind === "toolBurst") {
    for (const tool of row.tools) {
      if (isCompletedWriteTool(tool)) into.push(tool);
    }
    return;
  }
  if (row.kind === "thinkingSection") {
    for (const child of row.children) {
      if (child.kind === "tool" && isCompletedWriteTool(child)) into.push(child);
    }
  }
}

function isTimelineTool(item: TranscriptMessage): item is ToolItem {
  return item.kind === "tool";
}

function isCompletedWriteTool(item: TranscriptMessage): item is ToolItem {
  return isTimelineTool(item) && item.status !== "running" && isWriteToolName(item.toolName);
}

function isWriteToolName(toolName: string): boolean {
  return /write|edit|patch|apply/i.test(toolName);
}

/**
 * Summarise a tool burst for the collapsed pill: "6 tool calls (write: foo.ts, bash×4, cymbal×1)".
 * Quiet tools are rolled into a "×N" count grouped by tool name; loud tools
 * are listed individually by name (with file path when easily available).
 */
export function summariseToolBurst(burst: TimelineToolBurst): string {
  const total = burst.tools.length;
  const editTools = burst.tools.filter((tool) => isWriteToolName(tool.toolName));
  if (editTools.length === total) {
    return `Edited ${total} file${total === 1 ? "" : "s"}`;
  }

  const fileTools = burst.tools.filter((tool) => looksLikeFileExplore(tool.toolName, tool.input));
  if (fileTools.length === total) {
    return `Explored ${total} file${total === 1 ? "" : "s"}`;
  }

  const searchTools = burst.tools.filter((tool) => looksLikeSearch(tool.toolName, tool.input));
  if (searchTools.length === total) {
    return `${total} search${total === 1 ? "" : "es"}`;
  }

  const loud: string[] = [];
  const quietCounts = new Map<string, number>();
  for (const tool of burst.tools) {
    if (isQuietTool(tool.toolName)) {
      quietCounts.set(tool.toolName, (quietCounts.get(tool.toolName) ?? 0) + 1);
    } else {
      loud.push(tool.toolName);
    }
  }
  const parts: string[] = [];
  for (const name of loud) {
    parts.push(name);
  }
  for (const [name, count] of quietCounts) {
    parts.push(`${name}×${count}`);
  }
  return `${total} tool call${total === 1 ? "" : "s"} (${parts.join(", ")})`;
}

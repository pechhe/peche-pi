import type { SessionDriverEvent, SessionQueuedMessage } from "@pi-gui/session-driver";
import type { TranscriptMessage } from "./timeline-types";

export type {
  SessionRole,
  TimelineActivity,
  TimelineSummary,
  TimelineSummaryPresentation,
  TimelineTone,
  TimelineToolCall,
  TimelineToolStatus,
  TranscriptMessage,
} from "./timeline-types";

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
    options?: Pick<Extract<TranscriptMessage, { kind: "activity" }>, "detail" | "metadata" | "tone" | "noise">,
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

export function appendAssistantDeltaToTimeline(
  transcript: readonly TranscriptMessage[],
  runtime: SessionTimelineRuntimeState,
  text: string,
  factory: TimelineItemFactory,
): TranscriptMessage[] {
  const next = [...transcript];
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

export function applySessionEventToTimeline(
  transcript: readonly TranscriptMessage[],
  event: SessionDriverEvent,
  runtime: SessionTimelineRuntimeState,
  factory: TimelineItemFactory,
): TranscriptMessage[] {
  if (event.type === "assistantDelta") {
    return transcript.slice();
  }

  let next = [...transcript];

  switch (event.type) {
    case "sessionOpened":
      next.push(factory.activity("Resumed session", { metadata: relativeDetail(event.timestamp) }));
      break;
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
      return appendQueuedUserMessageToTimeline(next, event.message);
    case "toolStarted": {
      clearActiveAssistantMessage(runtime);
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
      upsertToolRow(next, event.callId, factory, event.toolName, "running", toolLabel(event.toolName, event.input), undefined, event.input);
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
      if (metrics) {
        const label = summaryLabel(metrics);
        if (label) {
          next.push(factory.summary(label, { presentation: "inline" }));
        }
        next.push(factory.summary(workedForLabel(metrics.startedAt, event.timestamp), { presentation: "divider" }));
      } else {
        next.push(factory.summary("Completed", {
          presentation: "divider",
          metadata: relativeDetail(event.timestamp),
        }));
      }
      break;
    }
    case "runFailed": {
      const metrics = runtime.runMetrics;
      clearRunState(runtime);
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

function clearActiveAssistantMessage(runtime: SessionTimelineRuntimeState): void {
  runtime.activeAssistantMessageId = undefined;
}

function clearRunState(runtime: SessionTimelineRuntimeState): void {
  clearActiveAssistantMessage(runtime);
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
    label ?? (existingTool?.label ?? "Working"),
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

function toolLabel(toolName: string, input: unknown): string {
  const detail = inputLabel(input);
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

function summaryLabel(metrics: RunMetrics): string | undefined {
  const parts: string[] = [];
  if (metrics.fileCount > 0) {
    parts.push(`Explored ${metrics.fileCount} file${metrics.fileCount === 1 ? "" : "s"}`);
  }
  if (metrics.searchCount > 0) {
    parts.push(`${metrics.searchCount} search${metrics.searchCount === 1 ? "" : "es"}`);
  }
  if (parts.length === 0 && metrics.toolCount > 0) {
    parts.push(`Used ${metrics.toolCount} tool${metrics.toolCount === 1 ? "" : "s"}`);
  }
  return parts.length > 0 ? parts.join(", ") : undefined;
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

export function isQuietTool(toolName: string): boolean {
  return QUIET_TOOL_PATTERNS.some((pattern) => pattern.test(toolName));
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

export interface TimelineToolBurst {
  readonly kind: "toolBurst";
  readonly id: string;
  readonly tools: readonly ToolItem[];
  readonly trailing: boolean;
}

export type TimelineRow = TranscriptMessage | TimelineToolBurst;

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

  let i = 0;
  while (i < filtered.length) {
    const item = filtered[i]!;
    if (item.kind !== "tool") {
      rows.push(item);
      i += 1;
      continue;
    }

    const tools: ToolItem[] = [];
    while (i < filtered.length && filtered[i]!.kind === "tool") {
      tools.push(filtered[i] as ToolItem);
      i += 1;
    }
    const trailing = i >= filtered.length;
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

  return { rows, metaEvents };
}

/**
 * Backward-compatible name for renderer callers. New code should use
 * createTimelineViewModel to make the Interface owner explicit.
 */
export function groupTranscript(transcript: readonly TranscriptMessage[]): TimelineViewModel {
  return createTimelineViewModel(transcript);
}

/**
 * Summarise a tool burst for the collapsed pill: "6 tool calls (write: foo.ts, bash×4, cymbal×1)".
 * Quiet tools are rolled into a "×N" count grouped by tool name; loud tools
 * are listed individually by name (with file path when easily available).
 */
export function summariseToolBurst(burst: TimelineToolBurst): string {
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
  const total = burst.tools.length;
  return `${total} tool call${total === 1 ? "" : "s"} (${parts.join(", ")})`;
}

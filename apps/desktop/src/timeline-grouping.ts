import type { TranscriptMessage } from "./timeline-types";

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

/**
 * Group consecutive tool calls into bursts so we can collapse multi-tool
 * bursts that are no longer the most recent activity. Single-tool bursts and
 * the trailing burst keep their original shape.
 *
 * Also extracts meta activity events (session lifecycle) so they can be shown
 * in the context-indicator hover instead of cluttering the transcript.
 */
export function groupTranscript(transcript: readonly TranscriptMessage[]): {
  rows: TimelineRow[];
  metaEvents: TimelineMetaEvent[];
} {
  const rows: TimelineRow[] = [];
  const metaEvents: TimelineMetaEvent[] = [];

  // First pass: filter meta activities out.
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

  // Walk filtered transcript, collecting consecutive tool items into bursts.
  // A burst is "trailing" if nothing non-tool follows it.
  let i = 0;
  while (i < filtered.length) {
    const item = filtered[i]!;
    if (item.kind !== "tool") {
      rows.push(item);
      i += 1;
      continue;
    }
    // Collect contiguous tool items.
    const start = i;
    const tools: ToolItem[] = [];
    while (i < filtered.length && filtered[i]!.kind === "tool") {
      tools.push(filtered[i] as ToolItem);
      i += 1;
    }
    const trailing = i >= filtered.length;
    if (tools.length === 1 || trailing) {
      // Render as individual tool rows (preserves current behavior for the
      // active/most-recent burst and for single-call bursts).
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
    void start;
  }

  return { rows, metaEvents };
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
